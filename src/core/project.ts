import { loadBentoShell } from "../render/shell.ts";
import { IMAGE_CODEC_VERSION } from "../source/image.ts";
import {
  preserveRescuedKpiGeometry,
  retainedKpiAppearances,
} from "./kpi-appearance.ts";
import { retainedComponentFrames } from "./component-frames.ts";
import { kpiReadabilityDiagnostics } from "../render/kpi.ts";
import { refreshOverflowDiagnostics } from "../render/diagnostics.ts";
import { textOverflowDiagnostics } from "../render/text-overflow.ts";
import {
  outputOverflowDiagnostics,
  outputOverflowTargets,
} from "../render/output-overflow.ts";
import { attachOutputOverflow } from "../render/output-overflow-html.ts";
import { assertGraphTypography } from "../render/graphs.ts";
import { prepareRichTables } from "../rich/project.ts";
import { missingDesignDiagnostics } from "./design-diagnostics.ts";
import {
  preparedInlineWidgets,
  prepareWidgets,
  projectPresenter,
  stageWidgets,
} from "./widgets.ts";
import { INLINE_WIDGET_CSP, inlineWidgetBootstrap } from "../widgets/inline.ts";
import {
  pruneWidgetCameras,
  reconcileCapturedPlotlyCameras,
} from "./widget-camera.ts";
import {
  assertDesignRegistryUnchanged,
  loadDesignRegistry,
} from "../render/registry.ts";
import { assertReusableDesignSource } from "../render/theme-styles.ts";
import { LIST_CODEC_VERSION } from "../render/lists.ts";
import { INLINE_CODEC_VERSION } from "../render/inline.ts";
import { readSourceInline } from "../render/source-inline.ts";
import { MATH_CODEC_VERSION } from "../render/math.ts";
import { basename, dirname, resolve } from "node:path";
import { executeQuarto } from "../render/quarto.ts";
import {
  assertSupportedExecutionSource,
  projectAst,
  validateProjectionOrigins,
} from "../render/project.ts";
import { spliceDocument } from "../render/html.ts";
import {
  consumeCapture,
  preparePublication,
  recordPublication,
  verifyCapture,
} from "./capture.ts";
import { hashSource, scanSource } from "../source/mod.ts";
import { NOTES_CODEC_VERSION, sourceNotes } from "../source/notes.ts";
import { sourceDesignAttribute } from "../source/attributes.ts";
import { validateDesignValue } from "../render/design.ts";
import {
  assertOutputUnchanged,
  type BentoDoc,
  captureEdits,
  compose,
  createState,
  equal,
  type JsonObject,
  markEmitted,
  type OwnershipMap,
  type ProjectState,
  type ProvenanceMap,
  sha256,
  StateError,
  StateStore,
  targetKey,
} from "../state/mod.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../bridge/isolation.ts";
import type {
  Ast,
  BentoDoc as RenderDoc,
  Diagnostic,
} from "../render/types.ts";
import { syncDirectory, writeDurable } from "./io.ts";
import { assertProjectDocument } from "../render/validate.ts";

export function projectPaths(source: string) {
  source = resolve(source);
  if (!source.endsWith(".qmd")) {
    throw new Error("SOURCE_TYPE: expected a single .qmd source");
  }
  return {
    source,
    directory: dirname(source),
    stateDir: resolve(dirname(source), ".qbento"),
    output: source.replace(/\.qmd$/, ".bento.html"),
  };
}
async function exists(path: string) {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
/** Check persisted source identity without creating state, locks or recovery files. */
async function readProjectBinding(
  paths: ReturnType<typeof projectPaths>,
): Promise<boolean> {
  let stateInfo;
  try {
    stateInfo = await Deno.lstat(paths.stateDir);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
  if (stateInfo.isSymlink || !stateInfo.isDirectory) {
    throw new StateError(
      "UNSAFE_STATE_PATH",
      ".qbento must be a real directory.",
    );
  }
  const identity = resolve(paths.stateDir, "project.json");
  let info;
  try {
    info = await Deno.lstat(identity);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // Missing identity is not a new project when durable or recoverable state
      // remains. In particular, `edit` must never adopt it for another QMD.
      for (
        const file of [
          "state.json",
          "state.previous.json",
          "render-transaction.json",
          "sync-transaction.json",
          "sync-approved.json",
        ]
      ) {
        if (await exists(resolve(paths.stateDir, file))) {
          throw new StateError(
            "PROJECT_BINDING_MISSING",
            "Saved project state has no source binding. Restore .qbento/project.json from the matching project backup before continuing.",
          );
        }
      }
      return false;
    }
    throw error;
  }
  if (info.isSymlink || !info.isFile) {
    throw new StateError(
      "UNSAFE_STATE_PATH",
      ".qbento/project.json must be a regular file.",
    );
  }
  let binding;
  try {
    binding = JSON.parse(await Deno.readTextFile(identity));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new StateError(
      "PROJECT_SOURCE_MISMATCH",
      "Cannot verify .qbento source identity: project.json is invalid JSON.",
    );
  }
  if (binding?.version !== 1 || binding.source !== basename(paths.source)) {
    throw new StateError(
      "PROJECT_SOURCE_MISMATCH",
      ".qbento belongs to a different QMD source.",
    );
  }
  return true;
}

/** Require a verified binding before exposing an existing saved project. */
export async function assertProjectBinding(source: string) {
  const paths = projectPaths(source);
  if (!await readProjectBinding(paths)) {
    throw new StateError(
      "NO_BASELINE",
      "Render this QMD before reading its project.",
    );
  }
  return paths;
}

export async function withProject<T>(
  source: string,
  action: (
    paths: ReturnType<typeof projectPaths>,
    store: StateStore,
  ) => Promise<T>,
): Promise<T> {
  const paths = projectPaths(source);
  // Fail closed before creating even a lock when identity was lost. Recheck
  // under the operation lock below to retain protection against concurrent edits.
  await readProjectBinding(paths);
  await Deno.mkdir(paths.stateDir, { recursive: true });
  const stateInfo = await Deno.lstat(paths.stateDir);
  if (stateInfo.isSymlink || !stateInfo.isDirectory) {
    throw new Error("UNSAFE_STATE_PATH: .qbento must be a real directory");
  }
  const lock = resolve(paths.stateDir, "operation.lock");
  try {
    await Deno.mkdir(lock);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      throw new Error(
        "PROJECT_BUSY: another operation or interrupted transaction owns .qbento/operation.lock",
      );
    }
    throw e;
  }
  try {
    await Deno.writeTextFile(
      resolve(lock, "owner.json"),
      JSON.stringify({
        pid: Deno.pid,
        source: paths.source,
        started: new Date().toISOString(),
      }),
    );
    if (!await readProjectBinding(paths)) {
      await Deno.writeTextFile(
        resolve(paths.stateDir, "project.json"),
        JSON.stringify(
          { version: 1, source: basename(paths.source) },
          null,
          2,
        ) + "\n",
        { createNew: true },
      );
    }
    if (await exists(resolve(paths.stateDir, "render-transaction.json"))) {
      throw new Error(
        "RECOVERY_REQUIRED: inspect the interrupted render transaction before continuing",
      );
    }
    if (await exists(resolve(paths.stateDir, "sync-transaction.json"))) {
      throw new Error(
        "RECOVERY_REQUIRED: inspect the interrupted source synchronization before continuing",
      );
    }
    return await action(paths, new StateStore(paths.stateDir));
  } finally {
    await Deno.remove(lock, { recursive: true });
  }
}
export async function renderProject(source: string) {
  return await render(source);
}
export interface ExecutedRender {
  ast: Ast;
  sourceHash: string;
  assetDirectories: string[];
  expectedImageAssets?: Record<string, string>;
  expectedRevision?: number | null;
  designHash?: string | null;
}
export async function renderProjectFromAst(
  source: string,
  executed: ExecutedRender,
) {
  return await render(source, executed);
}
/** Palette references are derivations, and must never bypass source ownership. */
export function assertSourceThemeReferences(
  document: BentoDoc,
  ownership: OwnershipMap,
  allowOwned = false,
): void {
  const semantic = new Set([
    "id",
    "type",
    "html",
    "text",
    "content",
    "src",
    "svg",
    "data",
    "option",
    "preset",
    "source",
    "rows",
    "header",
    "columns",
    "cells",
    "code",
    "language",
    "grammarName",
    "latex",
    "notes",
    "title",
    "url",
  ]);
  for (
    const resource of [
      "poster",
      "asset",
      "grammarAssetId",
      "themeAssetId",
      "view",
      "doc",
      "elements",
      "layouts",
      "themeRefs",
    ]
  ) semantic.add(resource);
  function check(holder: JsonObject, key: string) {
    const refs = holder.themeRefs;
    if (!refs || typeof refs !== "object" || Array.isArray(refs)) return;
    const owned = ownership[key] ?? [];
    for (const path of Object.keys(refs)) {
      const root = path.split(".")[0];
      if (semantic.has(root)) {
        throw new Error(
          "UNSUPPORTED_THEME_REFERENCE: palette references cannot derive semantic content, identity or resources.",
        );
      }
      if (!allowOwned && owned.includes("themeRefs")) {
        throw new Error(
          "UNMAPPED_DESIGN: a native palette reference on a source-owned object is retained pending; remove the reference or resolve it explicitly before recomputing.",
        );
      }
    }
  }
  for (const slide of document.slides) {
    check(slide, targetKey({ slideId: slide.id }));
    for (const element of slide.elements) {
      check(element, targetKey({ slideId: slide.id, elementId: element.id }));
    }
  }
  // Pinned Bento also derives references on native reusable slide templates.
  for (const layout of (document.layouts ?? []) as JsonObject[]) {
    check(layout, "");
    for (const element of (layout.elements ?? []) as JsonObject[]) {
      check(element, "");
    }
  }
}
/** Execute and project one source snapshot; callers hold the project operation lock. */
export async function projectProjection(
  source: string,
  state: ProjectState | null | undefined,
  executed?: ExecutedRender,
) {
  const paths = projectPaths(source);
  const text = await Deno.readTextFile(paths.source),
    mapping = scanSource(text);
  assertSupportedExecutionSource(mapping);
  const registry = await loadDesignRegistry(paths.directory);
  assertReusableDesignSource(mapping, registry.defaults);
  if (state) assertSourceThemeReferences(state.emitted, state.ownership);
  if (executed?.designHash !== undefined) {
    await assertDesignRegistryUnchanged(paths.directory, executed.designHash);
  }
  if (executed && mapping.hash !== executed.sourceHash) {
    throw new Error(
      "SOURCE_CHANGED: QMD differs from the executed source snapshot",
    );
  }
  if (
    mapping.blocks.some((block) =>
      block.kind === "image" && block.origin === "computed"
    )
  ) {
    throw new Error(
      "UNSUPPORTED_AUTHORED_IMAGE: computed image captions/paths require a verified producer adapter",
    );
  }
  const imageProofs = await readSourceInline(mapping, paths.directory);
  if (executed?.expectedImageAssets) {
    const actual = Object.fromEntries(
      [...imageProofs].filter(([, proof]) => proof.kind === "image").map((
        [id, proof],
      ) => [id, hashSource(proof.image!.data!)]),
    );
    if (!equal(actual, executed.expectedImageAssets)) {
      throw new Error(
        "AUTHORED_IMAGE_ASSET_CHANGED: original source asset changed during Quarto execution; preserve the project and render from a stable asset",
      );
    }
  }
  const build = resolve(paths.stateDir, "build");
  const ast = executed?.ast ?? await executeQuarto(paths.source, build);
  if (hashSource(await Deno.readTextFile(paths.source)) !== mapping.hash) {
    throw new Error(
      "SOURCE_CHANGED: QMD changed during execution; render aborted",
    );
  }
  await assertDesignRegistryUnchanged(paths.directory, registry.hash);
  const widgets = await prepareWidgets(ast, mapping, paths.directory, state);
  const richTables = await prepareRichTables(ast, mapping);
  const kpiAppearances = retainedKpiAppearances(state, mapping);
  const projected = validateProjectionOrigins(
    mapping,
    await projectAst(
      ast,
      state?.docId ?? crypto.randomUUID(),
      executed?.assetDirectories ?? [build, paths.directory],
      mapping,
      widgets.projections,
      registry.defaults,
      richTables,
      retainedComponentFrames(state, mapping),
      kpiAppearances,
      imageProofs,
      paths.directory,
    ),
    imageProofs,
    registry.defaults,
  );
  const generated = prepareIsolatedDocument(
    projected.document,
  ) as unknown as BentoDoc;
  const provenance: ProvenanceMap = {}, ownership: OwnershipMap = {};
  for (const [slideId, els] of Object.entries(projected.origins)) {
    for (const [elementId, origin] of Object.entries(els)) {
      const block = mapping.blocks.find((b) => b.id === origin.sourceId);
      const declaration = projected.design?.[slideId]?.[elementId];
      const design: JsonObject = {};
      if (declaration) {
        ownership[targetKey({ slideId, elementId })] = [
          ...declaration.ownedPaths,
          ...(declaration.ownedPaths.length ? ["themeRefs"] : []),
        ];
        const element = generated.slides.find((s) => s.id === slideId)!.elements
          .find((e) => e.id === elementId)!;
        for (const [field, binding] of Object.entries(declaration.bindings)) {
          const value = sourceDesignAttribute(
            mapping,
            binding.sourceId,
            binding.attribute,
          );
          if (
            !equal(
              validateDesignValue(binding.attribute, value),
              element[field],
            )
          ) {
            throw new Error(
              "UNMAPPED_DESIGN: executed visual attribute differs from its original source declaration",
            );
          }
          design[field] = {
            blockId: binding.sourceId,
            attribute: binding.attribute,
            value,
          };
        }
      }
      provenance[targetKey({ slideId, elementId })] = {
        origin: origin.designOnly
          ? "authored"
          : block?.origin === "computed"
          ? "computed"
          : origin.origin,
        ...(origin.sourceId ? { semanticId: origin.sourceId } : {}),
        ...(origin.producer ? { producer: origin.producer } : {}),
        source: {
          hash: mapping.hash,
          ...(origin.graph ? { graph: origin.graph } : {}),
          ...(origin.image ? { image: origin.image } : {}),
          ...(origin.widget ? { widget: origin.widget } : {}),
          ...(origin.richTable ? { richTable: origin.richTable } : {}),
          ...(declaration ? { design } : {}),
          ...(block
            ? {
              inlineCodec: INLINE_CODEC_VERSION,
              ...(block.kind === "image"
                ? { imageCodec: IMAGE_CODEC_VERSION }
                : {}),
              ...(block.kind === "list"
                ? { listCodec: LIST_CODEC_VERSION }
                : {}),
              ...(block.kind === "math"
                ? { mathCodec: MATH_CODEC_VERSION }
                : {}),
              blockId: block.id,
              content: block.content,
              kind: origin.designOnly &&
                  elementId.startsWith(slideId + "/qb-theme/")
                ? "design-only"
                : block.kind,
              stable: block.stable,
              ...(block.parentId
                ? {
                  parentId: block.parentId,
                  siblings: mapping.blocks.filter((b) =>
                    b.parentId === block.parentId && b.kind === block.kind
                  ).length,
                }
                : {}),
            }
            : {}),
        },
      };
    }
  }
  for (const [slideId, binding] of Object.entries(projected.notes ?? {})) {
    const { block } = sourceNotes(mapping, binding.sourceId, slideId);
    provenance[targetKey({ slideId })] = {
      origin: "authored",
      semanticId: block.id,
      source: {
        hash: mapping.hash,
        blockId: block.id,
        content: block.content,
        kind: "notes",
        stable: true,
        notesCodec: NOTES_CODEC_VERSION,
      },
    };
  }
  if (state) assertSourceThemeReferences(state.emitted, ownership);
  return {
    document: generated,
    provenance,
    ownership,
    sourceHash: mapping.hash,
    designHash: registry.hash,
    diagnostics: [
      ...projected.diagnostics,
      ...missingDesignDiagnostics(mapping, state, registry),
    ],
    widgets,
    mapping,
    kpiAppearances,
    kpiAppearanceRescues: projected.kpiAppearanceRescues ?? [],
  };
}
export function assertProjectionIdentity(
  state: ProjectState,
  provenance: ProvenanceMap,
  sourceHash: string,
) {
  if (state) {
    for (const [key, old] of Object.entries(state.provenance)) {
      const fresh = provenance[key];
      if (old.source?.hash !== sourceHash && old.origin !== "computed") {
        const safeExplicit = old.source?.stable === true &&
          (!fresh || fresh.semanticId === old.semanticId);
        const safeSingleton = old.source?.parentId &&
          old.source?.siblings === 1 && fresh?.source?.siblings === 1 &&
          fresh?.source?.parentId === old.source.parentId;
        if (!safeExplicit && !safeSingleton) {
          throw new Error(
            "AMBIGUOUS_IDENTITY: source changed around an unpinned element; explicitly pin identities before regenerating retained design",
          );
        }
      }
    }
  }
}

async function render(source: string, executed?: ExecutedRender) {
  return await withProject(source, async (paths, store) => {
    let state = await store.load();
    if (
      executed?.expectedRevision !== undefined &&
      (state?.revision ?? null) !== executed.expectedRevision
    ) {
      throw new Error(
        "STALE_REVISION: project changed while Quarto was executing",
      );
    }
    await assertOutputUnchanged(state, paths.output);
    const projected = await projectProjection(source, state, executed);
    const generated = projected.document, provenance = projected.provenance;
    const approvalPath = resolve(paths.stateDir, "sync-approved.json");
    let approvalText: string | undefined;
    if (await exists(approvalPath)) {
      const info = await Deno.lstat(approvalPath);
      if (!info.isFile || info.isSymlink || !state) {
        throw new Error(
          "INVALID_APPROVAL: expected a saved project and regular approval file",
        );
      }
      approvalText = await Deno.readTextFile(approvalPath);
      const { prepareApprovedSync } = await import("./sync.ts");
      state = prepareApprovedSync(
        state,
        generated,
        projected.sourceHash,
        JSON.parse(approvalText),
        provenance,
      );
    }
    if (state) {
      assertProjectionIdentity(state, provenance, projected.sourceHash);
    }
    if (!state) state = createState(generated, provenance, projected.ownership);
    preserveRescuedKpiGeometry(
      state,
      projected.kpiAppearances,
      projected.kpiAppearanceRescues,
      projected.ownership,
    );
    const composed = compose(state, generated, provenance, projected.ownership);
    await assertGraphTypography(
      composed.document as unknown as RenderDoc,
      composed.state.provenance,
    );
    state = composed.state;
    pruneWidgetCameras(
      state,
      new Set(
        projected.widgets.bundles.map((bundle) =>
          bundle.candidate.source.sourceId
        ),
      ),
    );
    const kpiDiagnostics = await kpiReadabilityDiagnostics(
      projected.mapping,
      composed.document as unknown as RenderDoc,
    );
    const textDiagnostics = await textOverflowDiagnostics(
      composed.document as unknown as RenderDoc,
    );
    const shell = await loadBentoShell();
    const overflowTargets = outputOverflowTargets(
      projected.mapping,
      state.provenance,
      composed.document as unknown as RenderDoc,
    );
    const detachedWidgets = new Set([
      ...state.pending.filter((p) => p.origin === "detached").map((p) =>
        targetKey(p.target)
      ),
      ...Object.entries(state.provenance).filter(([, p]) =>
        p.origin === "detached"
      ).map(([key]) => key),
    ]);
    const inlineViews = await preparedInlineWidgets(
      projected.widgets,
      projected.mapping,
      composed.document,
      detachedWidgets,
    );
    const assembled = attachOutputOverflow(
      spliceDocument(
        shell,
        composed.document as unknown as RenderDoc,
        ISOLATION_BOOTSTRAP +
          inlineWidgetBootstrap(composed.document, inlineViews),
        inlineViews.length ? INLINE_WIDGET_CSP : OFFLINE_CSP,
      ),
      overflowTargets,
    );
    const { html, receipt } = await preparePublication(
      composed.document,
      assembled,
    );
    const widgetPublication = await stageWidgets(
      paths.stateDir,
      receipt.generation,
      state.docId,
      projected.mapping,
      projected.widgets,
      composed.document,
      detachedWidgets,
      overflowTargets,
    );
    // Recheck immediately before publishing: edits during execution must also survive.
    await assertOutputUnchanged(state, paths.output);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !== projected.sourceHash
    ) {
      throw new Error(
        "SOURCE_CHANGED: QMD changed during projection; publication aborted",
      );
    }
    await assertDesignRegistryUnchanged(paths.directory, projected.designHash);
    const staging = paths.output + ".pending-" + crypto.randomUUID();
    await writeDurable(staging, html);
    await syncDirectory(paths.directory);
    const journal = resolve(paths.stateDir, "render-transaction.json");
    const history = resolve(paths.stateDir, "history");
    await Deno.mkdir(history, { recursive: true });
    const historyInfo = await Deno.lstat(history);
    if (!historyInfo.isDirectory || historyInfo.isSymlink) {
      throw new Error("UNSAFE_STATE_PATH: history must be a real directory");
    }
    const backup = resolve(history, `output-${crypto.randomUUID()}.html`);
    const approval = approvalText === undefined ? undefined : {
      path: approvalPath,
      sha256: await sha256(approvalText),
      archive: resolve(history, `consumed-sync-${crypto.randomUUID()}.json`),
    };
    await writeDurable(
      journal,
      JSON.stringify(
        {
          version: 1,
          staging,
          backup,
          output: paths.output,
          oldRevision: state.revision,
          nextRevision: state.revision + 1,
          sha256: await sha256(html),
          previousOutput: state.output ?? null,
          ...(approval ? { approval } : {}),
        },
        null,
        2,
      ),
    );
    await syncDirectory(paths.stateDir);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !== projected.sourceHash
    ) {
      throw new Error(
        "SOURCE_CHANGED: QMD changed while preparing publication; recover the retained transaction",
      );
    }
    await assertDesignRegistryUnchanged(paths.directory, projected.designHash);
    if (await exists(paths.output)) {
      // Rename preserves even a native save arriving after the last hash check.
      // Keep this recoverable copy; never discard it as part of publication.
      await Deno.rename(paths.output, backup);
      await syncDirectory(paths.directory);
      await syncDirectory(history);
      if (await sha256(await Deno.readFile(backup)) !== state.output?.sha256) {
        try {
          await Deno.link(backup, paths.output);
          await syncDirectory(paths.directory);
        } catch (e) {
          if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
        }
        throw new Error(
          "UNCAPTURED_HTML_EDITS: concurrent native save preserved in history; recover before render",
        );
      }
    }
    state = await recordPublication(
      state,
      composed.document,
      paths.output,
      html,
      receipt,
    );
    if (widgetPublication) state.widgets = widgetPublication;
    else delete state.widgets;
    state = await store.save(state);
    // Atomic no-clobber publication refuses an output recreated by a native save.
    await Deno.link(staging, paths.output);
    await syncDirectory(paths.directory);
    await Deno.remove(staging);
    await syncDirectory(paths.directory);
    if (approval) {
      if (
        await sha256(await Deno.readFile(approval.path)) !== approval.sha256
      ) {
        throw new Error(
          "STALE_APPROVAL: approval changed during publication; recover the retained transaction",
        );
      }
      await Deno.link(approval.path, approval.archive);
      await syncDirectory(history);
      await Deno.remove(approval.path);
      await syncDirectory(paths.stateDir);
    }
    await Deno.remove(journal);
    await syncDirectory(paths.stateDir);
    return {
      output: paths.output,
      state,
      diagnostics: outputOverflowDiagnostics(
        refreshOverflowDiagnostics(
          composed.document as unknown as RenderDoc,
          [...projected.diagnostics, ...kpiDiagnostics, ...textDiagnostics],
        ),
        overflowTargets,
      ),
      ...(widgetPublication
        ? {
          presenter: resolve(
            paths.stateDir,
            "widgets",
            receipt.generation,
            "presenter.html",
          ),
        }
        : {}),
    };
  });
}
export async function captureProject(source: string, editedPath?: string) {
  return await withProject(source, async (paths, store) => {
    let state = await store.load();
    if (!state) {
      throw new Error(
        "NO_BASELINE: render this project before capturing local HTML",
      );
    }
    const target = resolve(editedPath || paths.output);
    if (target !== paths.output) {
      await assertOutputUnchanged(state, paths.output);
    }
    const html = await Deno.readTextFile(target);
    let doc = await verifyCapture(state, html);
    ({ state, document: doc } = await reconcileCapturedPlotlyCameras(
      paths.source,
      paths.stateDir,
      state,
      doc,
    ));
    assertSourceThemeReferences(doc, {}, true);
    state = captureEdits(state, doc);
    if (target === paths.output) {
      state = await markEmitted(state, doc, paths.output, html);
    }
    state = await store.save(consumeCapture(state));
    return {
      state,
      pending: state.pending.length,
      overrides: state.overrides.length,
    };
  });
}
export async function saveProject(
  source: string,
  doc: BentoDoc,
  revision: number,
  expectedSourceHash?: string,
) {
  assertProjectDocument(doc);
  assertSourceThemeReferences(doc, {}, true);
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) throw new Error("NO_BASELINE: render first");
    if (state.revision !== revision) {
      throw new StateError(
        "STALE_REVISION",
        "Reload the project before saving newer edits",
      );
    }
    await assertOutputUnchanged(state, paths.output);
    if (
      expectedSourceHash !== undefined &&
      hashSource(await Deno.readTextFile(paths.source)) !== expectedSourceHash
    ) {
      throw new StateError(
        "STALE_SOURCE",
        "QMD changed after checking new identities; reload before saving.",
      );
    }
    if (equal(state.emitted, doc)) return state;
    return await store.save(captureEdits(state, doc));
  });
}
export async function readProject(source: string): Promise<ProjectState> {
  const paths = await assertProjectBinding(source);
  const state = await new StateStore(paths.stateDir).load();
  if (!state) {
    throw new StateError(
      "NO_BASELINE",
      "Render this QMD before reading its project.",
    );
  }
  return state;
}

/** Read-only Studio diagnostics: no Quarto execution, state writes or source cleanup. */
export async function readProjectDiagnostics(
  source: string,
): Promise<Diagnostic[]> {
  const paths = projectPaths(source);
  const bound = await readProjectBinding(paths);
  const state = await new StateStore(paths.stateDir).load();
  if (state && !bound) {
    throw new StateError(
      "NO_BASELINE",
      "Restore the source binding before reading saved diagnostics.",
    );
  }
  const registry = await loadDesignRegistry(paths.directory);
  const mapping = scanSource(await Deno.readTextFile(paths.source));
  const designDiagnostics = missingDesignDiagnostics(mapping, state, registry);
  if (!state) return designDiagnostics;
  const { pendingComponentDiagnostics } = await import(
    "./component-actions.ts"
  );
  return outputOverflowDiagnostics(
    refreshOverflowDiagnostics(state.emitted as unknown as RenderDoc, [
      ...designDiagnostics,
      ...pendingComponentDiagnostics(state),
      ...await textOverflowDiagnostics(state.emitted as unknown as RenderDoc),
    ]),
    outputOverflowTargets(
      mapping,
      state.provenance,
      state.emitted as unknown as RenderDoc,
    ),
  );
}

export async function readProjectPresenter(
  source: string,
  revision: number,
): Promise<string> {
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) throw new Error("NO_BASELINE: render first");
    if (state.revision !== revision) {
      throw new StateError(
        "STALE_REVISION",
        "Reload before presenting a newer project snapshot.",
      );
    }
    await assertOutputUnchanged(state, paths.output);
    return await projectPresenter(paths.source, paths.stateDir, state);
  });
}
