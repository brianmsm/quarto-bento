import { basename, dirname, resolve } from "node:path";
import { executeQuarto } from "../render/quarto.ts";
import { projectAst } from "../render/project.ts";
import { extractDocument, spliceDocument } from "../render/html.ts";
import { hashSource, scanSource } from "../source/mod.ts";
import {
  assertOutputUnchanged,
  type BentoDoc,
  captureEdits,
  compose,
  createState,
  markEmitted,
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
import type { BentoDoc as RenderDoc } from "../render/types.ts";

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
  return await withProject(source, async (paths, store) => {
    let state = await store.load();
    await assertOutputUnchanged(state, paths.output);
    const text = await Deno.readTextFile(paths.source),
      mapping = scanSource(text);
    const build = resolve(paths.stateDir, "build");
    const ast = await executeQuarto(paths.source, build);
    if (hashSource(await Deno.readTextFile(paths.source)) !== mapping.hash) {
      throw new Error(
        "SOURCE_CHANGED: QMD changed during execution; render aborted",
      );
    }
    const projected = await projectAst(
      ast,
      state?.docId ?? crypto.randomUUID(),
      [build, paths.directory],
    );
    const generated = prepareIsolatedDocument(
      projected.document,
    ) as unknown as BentoDoc;
    const provenance: ProvenanceMap = {};
    for (const [slideId, els] of Object.entries(projected.origins)) {
      for (const [elementId, origin] of Object.entries(els)) {
        const block = mapping.blocks.find((b) => b.id === origin.sourceId);
        provenance[targetKey({ slideId, elementId })] = {
          origin: block?.origin === "computed" ? "computed" : origin.origin,
          ...(origin.sourceId ? { semanticId: origin.sourceId } : {}),
          ...(origin.producer ? { producer: origin.producer } : {}),
          source: {
            hash: mapping.hash,
            ...(block
              ? {
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
    if (state) {
      for (const [key, old] of Object.entries(state.provenance)) {
        const fresh = provenance[key];
        if (old.source?.hash !== mapping.hash && old.origin !== "computed") {
          const safeExplicit = old.source?.stable === true &&
            fresh?.semanticId === old.semanticId;
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
    if (!state) state = createState(generated, provenance);
    const composed = compose(state, generated, provenance);
    state = composed.state;
    const shell = await Deno.readTextFile(
      new URL("../../vendor/bento/shell.html", import.meta.url),
    );
    const html = spliceDocument(
      shell,
      composed.document as unknown as RenderDoc,
      ISOLATION_BOOTSTRAP,
      OFFLINE_CSP,
    );
    // Recheck immediately before publishing: edits during execution must also survive.
    await assertOutputUnchanged(state, paths.output);
    const staging = paths.output + ".pending-" + crypto.randomUUID();
    const file = await Deno.open(staging, { createNew: true, write: true });
    try {
      const bytes = new TextEncoder().encode(html);
      let n = 0;
      while (n < bytes.length) n += await file.write(bytes.subarray(n));
      await file.sync();
    } finally {
      file.close();
    }
    const journal = resolve(paths.stateDir, "render-transaction.json");
    const history = resolve(paths.stateDir, "history");
    await Deno.mkdir(history, { recursive: true });
    const backup = resolve(history, `output-${crypto.randomUUID()}.html`);
    await Deno.writeTextFile(
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
        },
        null,
        2,
      ),
      { createNew: true },
    );
    if (await exists(paths.output)) {
      // Rename preserves even a native save arriving after the last hash check.
      // Keep this recoverable copy; never discard it as part of publication.
      await Deno.rename(paths.output, backup);
      if (await sha256(await Deno.readFile(backup)) !== state.output?.sha256) {
        try {
          await Deno.link(backup, paths.output);
        } catch (e) {
          if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
        }
        throw new Error(
          "UNCAPTURED_HTML_EDITS: concurrent native save preserved in history; recover before render",
        );
      }
    }
    state = await store.save(
      await markEmitted(state, composed.document, paths.output, html),
    );
    // Atomic no-clobber publication refuses an output recreated by a native save.
    await Deno.link(staging, paths.output);
    await Deno.remove(staging);
    await Deno.remove(journal);
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
    const doc = extractDocument(html) as unknown as BentoDoc;
    state = captureEdits(state, doc);
    if (target === paths.output) {
      state = await markEmitted(state, doc, paths.output, html);
    }
    state = await store.save(state);
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
    return await store.save(captureEdits(state, doc));
  });
}
export async function readProject(source: string): Promise<ProjectState> {
  const state = await new StateStore(projectPaths(source).stateDir).load();
  if (!state) throw new Error("NO_BASELINE: render this project first");
  return state;
}
