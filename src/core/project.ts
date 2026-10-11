import { INLINE_CODEC_VERSION } from "../render/inline.ts";
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
import type { Ast, BentoDoc as RenderDoc } from "../render/types.ts";
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
export async function withProject<T>(
  source: string,
  action: (
    paths: ReturnType<typeof projectPaths>,
    store: StateStore,
  ) => Promise<T>,
): Promise<T> {
  const paths = projectPaths(source);
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
    const identity = resolve(paths.stateDir, "project.json");
    if (await exists(identity)) {
      const meta = JSON.parse(await Deno.readTextFile(identity));
      if (meta.version !== 1 || meta.source !== basename(paths.source)) {
        throw new Error(
          "PROJECT_SOURCE_MISMATCH: .qbento belongs to a different source",
        );
      }
    } else {await Deno.writeTextFile(
        identity,
        JSON.stringify(
          { version: 1, source: basename(paths.source) },
          null,
          2,
        ) + "\n",
        { createNew: true },
      );}
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
  expectedRevision?: number | null;
}
export async function renderProjectFromAst(
  source: string,
  executed: ExecutedRender,
) {
  return await render(source, executed);
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
  if (executed && mapping.hash !== executed.sourceHash) {
    throw new Error(
      "SOURCE_CHANGED: QMD differs from the executed source snapshot",
    );
  }
  const build = resolve(paths.stateDir, "build");
  const ast = executed?.ast ?? await executeQuarto(paths.source, build);
  if (hashSource(await Deno.readTextFile(paths.source)) !== mapping.hash) {
    throw new Error(
      "SOURCE_CHANGED: QMD changed during execution; render aborted",
    );
  }
  const projected = validateProjectionOrigins(
    mapping,
    await projectAst(
      ast,
      state?.docId ?? crypto.randomUUID(),
      executed?.assetDirectories ?? [build, paths.directory],
    ),
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
        ownership[targetKey({ slideId, elementId })] = declaration.ownedPaths;
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
        origin: block?.origin === "computed" ? "computed" : origin.origin,
        ...(origin.sourceId ? { semanticId: origin.sourceId } : {}),
        ...(origin.producer ? { producer: origin.producer } : {}),
        source: {
          hash: mapping.hash,
          ...(declaration ? { design } : {}),
          ...(block
            ? {
              inlineCodec: INLINE_CODEC_VERSION,
              blockId: block.id,
              content: block.content,
              kind: block.kind,
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
  return {
    document: generated,
    provenance,
    ownership,
    sourceHash: mapping.hash,
    diagnostics: projected.diagnostics,
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
      );
    }
    if (state) {
      assertProjectionIdentity(state, provenance, projected.sourceHash);
    }
    if (!state) state = createState(generated, provenance, projected.ownership);
    const composed = compose(state, generated, provenance, projected.ownership);
    state = composed.state;
    const shell = await Deno.readTextFile(
      new URL("../../vendor/bento/shell.html", import.meta.url),
    );
    const assembled = spliceDocument(
      shell,
      composed.document as unknown as RenderDoc,
      ISOLATION_BOOTSTRAP,
      OFFLINE_CSP,
    );
    const { html, receipt } = await preparePublication(
      composed.document,
      assembled,
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
    state = await store.save(
      await recordPublication(
        state,
        composed.document,
        paths.output,
        html,
        receipt,
      ),
    );
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
    return { output: paths.output, state, diagnostics: projected.diagnostics };
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
    const doc = await verifyCapture(state, html);
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
) {
  assertProjectDocument(doc);
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
    if (equal(state.emitted, doc)) return state;
    return await store.save(captureEdits(state, doc));
  });
}
export async function readProject(source: string): Promise<ProjectState> {
  const state = await new StateStore(projectPaths(source).stateDir).load();
  if (!state) throw new Error("NO_BASELINE: render this project first");
  return state;
}
