/** Approved bounded text synchronization with a durable, recoverable QMD transaction. */
import { basename, resolve } from "node:path";
import { projectPaths, withProject } from "./project.ts";
import { canonical, StateError, StateStore, targetKey } from "../state/mod.ts";
import type { Change, ProjectState } from "../state/mod.ts";
import {
  applyPatches,
  hashSource,
  previewPatches,
  scanSource,
} from "../source/mod.ts";
import type { PatchPreview, SourceBlock } from "../source/mod.ts";
export interface SyncItem {
  changeId: string;
  target: Change["target"];
  blockId: string;
  kind: string;
  before: string;
  after: string;
  html: string;
}
export interface SyncPlan {
  version: 1;
  source: string;
  sourceHash: string;
  stateRevision: number;
  stateHash: string;
  selectedChangeIds: string[];
  excludedChangeIds: string[];
  changes: SyncItem[];
  patch: PatchPreview;
  planHash: string;
}
export interface SyncReceipt {
  version: 1;
  transactionId: string;
  source: string;
  planHash: string;
  previousSourceHash: string;
  sourceHash: string;
  previousRevision: number;
  revision: number;
  appliedChangeIds: string[];
  sourceBackup: string;
  stateBackup: string;
  receiptPath: string;
  renderNeeded: true;
  pendingRetained: true;
}
function fail(code: string, message: string): never {
  throw new StateError(code, message);
}
async function present(path: string) {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
async function regular(path: string) {
  const stat = await Deno.lstat(path);
  if (!stat.isFile || stat.isSymlink) {
    fail("UNSAFE_SOURCE_PATH", `Expected a real regular file: ${path}.`);
  }
  return stat;
}
async function safeDirectory(path: string) {
  const stat = await Deno.lstat(path);
  if (!stat.isDirectory || stat.isSymlink) {
    fail("UNSAFE_STATE_PATH", `Expected a real directory: ${path}.`);
  }
}
async function fsyncDirectory(path: string) {
  if (Deno.build.os === "windows") return;
  const dir = await Deno.open(path, { read: true });
  try {
    await dir.sync();
  } finally {
    dir.close();
  }
}
async function durableWrite(path: string, text: string, mode = 0o600) {
  const file = await Deno.open(path, { write: true, createNew: true, mode });
  try {
    const bytes = new TextEncoder().encode(text);
    let n = 0;
    while (n < bytes.length) n += await file.write(bytes.subarray(n));
    await file.sync();
  } finally {
    file.close();
  }
}
function decodeEntities(value: string): string {
  return value.replace(/&([^;\s]+);/g, (_whole, name: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: "\u00a0",
    };
    if (name in named) return named[name];
    if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) {
      const point = name[1].toLowerCase() === "x"
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
      if (
        point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ) return String.fromCodePoint(point);
    }
    return fail(
      "UNSUPPORTED_HTML",
      `Unsupported or invalid HTML entity &${name};.`,
    );
  });
}
/** Small explicit inline subset, never a whole-document Markdown writer. */
export function inlineHtmlToMarkdown(html: string): string {
  if (html.length > 1_000_000 || html.includes("\u0000")) {
    fail("UNSUPPORTED_HTML", "Invalid or excessive text fragment.");
  }
  let input = html.trim();
  // A single editor paragraph wrapper does not change the source paragraph boundary.
  const wrapper = input.match(/^<(p|div)>((?:[\s\S])*)<\/\1>$/i);
  if (wrapper && !new RegExp(`<\\/?${wrapper[1]}\\b`, "i").test(wrapper[2])) {
    input = wrapper[2];
  }
  const tokens = input.match(/<[^>]*>|[^<]+|</g) ?? [],
    stack: { tag: string; close: string; start: number }[] = [];
  let result = "";
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = decodeEntities(token).replace(/[\r\n\t ]+/g, " ");
      result += text.replace(/[\\`*_[\]{}<>!#$|~^@]/g, "\\$&");
      continue;
    }
    if (/^<br\s*\/?\s*>$/i.test(token)) {
      result += "  \n";
      continue;
    }
    const end = token.match(/^<\/([a-z]+)\s*>$/i);
    if (end) {
      const open = stack.pop();
      if (!open || open.tag !== end[1].toLowerCase()) {
        fail("UNSUPPORTED_HTML", "HTML tags are unbalanced.");
      }
      const inner = result.slice(open.start);
      if (!inner || /^\s|\s$/.test(inner) || inner.includes("\n")) {
        fail(
          "UNSUPPORTED_HTML",
          "Emphasis containing empty text, boundary whitespace, or line breaks needs source review.",
        );
      }
      result += open.close;
      continue;
    }
    const open = token.match(/^<(b|strong|i|em)\s*>$/i);
    if (open) {
      const tag = open[1].toLowerCase(),
        delimiter = ["b", "strong"].includes(tag) ? "**" : "*";
      if (stack.length || /(?:\*\*|\*|~~)$/.test(result)) {
        fail(
          "UNSUPPORTED_HTML",
          "Nested or adjacent emphasis needs source review.",
        );
      }
      result += delimiter;
      stack.push({ tag, close: delimiter, start: result.length });
      continue;
    }
    const strike = token.match(
      /^<span\s+style=(?:"text-decoration:\s*line-through;?"|'text-decoration:\s*line-through;?')\s*>$/i,
    );
    if (strike) {
      if (stack.length || /(?:\*\*|\*|~~)$/.test(result)) {
        fail(
          "UNSUPPORTED_HTML",
          "Nested or adjacent emphasis needs source review.",
        );
      }
      result += "~~";
      stack.push({ tag: "span", close: "~~", start: result.length });
      continue;
    }
    fail(
      "UNSUPPORTED_HTML",
      "Only plain text, b/strong, i/em, line-through spans, and br are supported for text sync; review other formatting in QMD.",
    );
  }
  if (stack.length) fail("UNSUPPORTED_HTML", "HTML tags are unclosed.");
  result = result.trim();
  // Escape Markdown list prefixes without changing displayed text.
  result = result.replace(/(^|\n)([-+] )/g, "$1\\$2");
  result = result.replace(/(^|\n)(\d+)([.)]) /g, "$1$2\\$3 ");
  if (!result) {
    fail(
      "UNSUPPORTED_HTML",
      "An empty text field requires explicit deletion, not text sync.",
    );
  }
  return result;
}
function chooseBlock(
  sourceText: string,
  state: ProjectState,
  change: Change,
): { block: SourceBlock; expected: string } {
  const source = state.provenance[targetKey(change.target)]?.source;
  if (
    !source || typeof source.blockId !== "string" ||
    typeof source.content !== "string" || typeof source.hash !== "string" ||
    typeof source.kind !== "string"
  ) {
    fail(
      "UNMAPPED_SOURCE",
      `Change ${change.id} has no verified original source fragment.`,
    );
  }
  const doc = scanSource(sourceText),
    matches = doc.blocks.filter((b) => b.id === source.blockId);
  if (matches.length !== 1) {
    fail(
      "AMBIGUOUS_IDENTITY",
      `Change ${change.id} does not identify exactly one current source block.`,
    );
  }
  const block = matches[0];
  if (
    !["heading", "paragraph"].includes(block.kind) || !block.editable ||
    block.origin !== "authored" || block.kind !== source.kind
  ) {
    fail(
      "UNSUPPORTED_SYNC",
      `Source kind for ${change.id} cannot be synchronized as authored text.`,
    );
  }
  if (block.content !== source.content) {
    fail(
      "SOURCE_CONFLICT",
      `QMD independently changed the same fragment for ${change.id}.`,
    );
  }
  if (doc.hash !== source.hash) {
    const stable = source.stable === true && block.stable;
    const singleton = typeof source.parentId === "string" &&
      source.siblings === 1 && block.parentId === source.parentId &&
      doc.blocks.filter((b) =>
          b.parentId === block.parentId && b.kind === block.kind
        ).length === 1 &&
      doc.blocks.some((b) => b.id === block.parentId && b.stable);
    if (!stable && !singleton) {
      fail(
        "AMBIGUOUS_IDENTITY",
        "Source changed around an unpinned element; pin its identity explicitly before synchronizing.",
      );
    }
  }
  return { block, expected: source.content };
}
function buildPlan(
  source: string,
  text: string,
  state: ProjectState,
  selectedChangeIds?: string[],
): SyncPlan {
  const ids = selectedChangeIds ?? state.pending.map((p) => p.id);
  if (!ids.length) fail("NO_PENDING_CHANGES", "No pending changes selected.");
  if (new Set(ids).size !== ids.length) {
    fail("INVALID_SELECTION", "Selected change IDs must be unique.");
  }
  const changes: SyncItem[] = ids.map((id) => {
    const found = state.pending.filter((p) => p.id === id);
    if (found.length !== 1) {
      fail(
        "INVALID_SELECTION",
        `Pending change ${id} is missing or ambiguous.`,
      );
    }
    const change = found[0],
      provenance = state.provenance[targetKey(change.target)];
    if (change.status === "conflict") {
      fail("SYNC_CONFLICT", `Resolve conflict ${id} before synchronizing.`);
    }
    if (
      change.kind !== "field" ||
      canonical(change.path) !== canonical(["html"]) || !change.after.present ||
      typeof change.after.value !== "string"
    ) {
      fail(
        "UNSUPPORTED_SYNC",
        `Change ${id} is not a supported authored html text edit. Select supported changes explicitly.`,
      );
    }
    if (change.origin !== "authored" || provenance?.origin !== "authored") {
      fail(
        "COMPUTED_SYNC_FORBIDDEN",
        `Change ${id} is not authored source text.`,
      );
    }
    const { block, expected } = chooseBlock(text, state, change);
    return {
      changeId: id,
      target: change.target,
      blockId: block.id,
      kind: block.kind,
      before: expected,
      after: inlineHtmlToMarkdown(change.after.value),
      html: change.after.value,
    };
  });
  const patch = previewPatches(
    scanSource(text),
    changes.map((c) => ({
      blockId: c.blockId,
      expected: c.before,
      replacement: c.after,
    })),
  );
  const unsigned = {
    version: 1 as const,
    source,
    sourceHash: hashSource(text),
    stateRevision: state.revision,
    stateHash: hashSource(canonical(state)),
    selectedChangeIds: [...ids],
    excludedChangeIds: state.pending.filter((p) => !ids.includes(p.id)).map(
      (p) => p.id,
    ),
    changes,
    patch,
  };
  return { ...unsigned, planHash: hashSource(canonical(unsigned)) };
}
async function readableSnapshot(source: string) {
  const paths = projectPaths(source);
  await safeDirectory(paths.stateDir);
  await regular(paths.source);
  for (
    const name of [
      "operation.lock",
      "sync-transaction.json",
      "render-transaction.json",
    ]
  ) {
    if (await present(resolve(paths.stateDir, name))) {
      fail(
        "RECOVERY_OR_BUSY",
        `Project has ${name}; finish or recover that operation first.`,
      );
    }
  }
  const identity = resolve(paths.stateDir, "project.json");
  if (await present(identity)) {
    await regular(identity);
    const value = JSON.parse(await Deno.readTextFile(identity));
    if (value.version !== 1 || value.source !== basename(paths.source)) {
      fail(
        "PROJECT_SOURCE_MISMATCH",
        "This .qbento state belongs to another source.",
      );
    }
  }
  const store = new StateStore(paths.stateDir), state = await store.load();
  if (!state) {
    fail("NO_BASELINE", "Render and save the project before synchronizing.");
  }
  const text = await Deno.readTextFile(paths.source),
    again = await store.load();
  if (
    !again || canonical(again) !== canonical(state) ||
    hashSource(await Deno.readTextFile(paths.source)) !== hashSource(text)
  ) {
    fail(
      "STALE_PREVIEW",
      "Project changed while reading; create a new preview.",
    );
  }
  return { paths, state, text };
}
/** Read-only: preview creates no files, locks, backups, or source annotations. */
export async function previewSync(
  source: string,
  selectedChangeIds?: string[],
): Promise<SyncPlan> {
  const { paths, state, text } = await readableSnapshot(source);
  return buildPlan(paths.source, text, state, selectedChangeIds);
}
/** Explicit approved action; leaves pending semantic edits until a future render confirms them. */
export async function applySync(
  source: string,
  plan: SyncPlan,
): Promise<SyncReceipt> {
  return await withProject(source, async (paths, store) => {
    const stat = await regular(paths.source), state = await store.load();
    if (!state) fail("NO_BASELINE", "Project baseline is missing.");
    if (plan.version !== 1 || plan.source !== paths.source) {
      fail("INVALID_PLAN", "Sync plan belongs to another source or version.");
    }
    if (
      state.revision !== plan.stateRevision ||
      hashSource(canonical(state)) !== plan.stateHash
    ) {
      fail(
        "STALE_REVISION",
        "State changed since preview; inspect a new plan.",
      );
    }
    const text = await Deno.readTextFile(paths.source);
    if (hashSource(text) !== plan.sourceHash) {
      fail("STALE_SOURCE", "QMD changed since preview; inspect a new plan.");
    }
    const verified = buildPlan(
      paths.source,
      text,
      state,
      plan.selectedChangeIds,
    );
    if (canonical(verified) !== canonical(plan)) {
      fail(
        "INVALID_PLAN",
        "Sync plan was altered or no longer reproduces the approved result.",
      );
    }
    const result = applyPatches(text, verified.patch);
    const transactionId = crypto.randomUUID(),
      history = resolve(paths.stateDir, "history");
    await Deno.mkdir(history, { recursive: true });
    await safeDirectory(history);
    const sourceBackup = resolve(history, `source-${transactionId}.qmd`),
      stateBackup = resolve(history, `state-${transactionId}.json`),
      receiptPath = resolve(history, `sync-${transactionId}.json`);
    const staging = resolve(
        paths.directory,
        `.${basename(paths.source)}.sync-${transactionId}`,
      ),
      journal = resolve(paths.stateDir, "sync-transaction.json");
    await durableWrite(
      staging,
      result,
      stat.mode === null ? 0o600 : stat.mode & 0o777,
    );
    await fsyncDirectory(paths.directory);
    await durableWrite(stateBackup, await Deno.readTextFile(store.path));
    await fsyncDirectory(history);
    await durableWrite(
      journal,
      JSON.stringify(
        {
          version: 1,
          transactionId,
          source: paths.source,
          sourceBackup,
          stateBackup,
          staging,
          receiptPath,
          sourceHash: plan.sourceHash,
          resultHash: plan.patch.resultHash,
          stateRevision: state.revision,
          planHash: plan.planHash,
          selectedChangeIds: plan.selectedChangeIds,
        },
        null,
        2,
      ) + "\n",
    );
    await fsyncDirectory(paths.stateDir);
    // Recheck after durable preparation; failed transactions deliberately retain recovery artifacts.
    if (hashSource(await Deno.readTextFile(paths.source)) !== plan.sourceHash) {
      fail(
        "STALE_SOURCE",
        "QMD changed during preparation; inspect the retained transaction.",
      );
    }
    const freshState = await store.load();
    if (!freshState || canonical(freshState) !== canonical(state)) {
      fail(
        "STALE_REVISION",
        "State changed during preparation; inspect the retained transaction.",
      );
    }
    await Deno.rename(paths.source, sourceBackup);
    await fsyncDirectory(paths.directory);
    await fsyncDirectory(history);
    // A concurrent editor save is preserved in backup or at the original path, never overwritten.
    if (hashSource(await Deno.readTextFile(sourceBackup)) !== plan.sourceHash) {
      try {
        await Deno.link(sourceBackup, paths.source);
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      }
      fail(
        "STALE_SOURCE",
        "Concurrent QMD save preserved in history; explicit recovery required.",
      );
    }
    try {
      await Deno.link(staging, paths.source);
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        fail(
          "CONCURRENT_SOURCE",
          "A concurrent editor recreated QMD; its file and the original backup are preserved. Recover the retained transaction.",
        );
      }
      throw error;
    }
    await fsyncDirectory(paths.directory);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !==
        verified.patch.resultHash
    ) {
      fail(
        "STALE_SOURCE",
        "Source changed during publication; recover the retained transaction.",
      );
    }
    // No baseline advancement and no pending removal before a later execution confirms the source.
    const saved = await store.save(state, plan.stateRevision);
    if (
      hashSource(await Deno.readTextFile(paths.source)) !==
        verified.patch.resultHash
    ) {
      fail(
        "STALE_SOURCE",
        "Source changed while recording sync; inspect the retained transaction.",
      );
    }
    const receipt: SyncReceipt = {
      version: 1,
      transactionId,
      source: paths.source,
      planHash: plan.planHash,
      previousSourceHash: plan.sourceHash,
      sourceHash: verified.patch.resultHash,
      previousRevision: state.revision,
      revision: saved.revision,
      appliedChangeIds: [...plan.selectedChangeIds],
      sourceBackup,
      stateBackup,
      receiptPath,
      renderNeeded: true,
      pendingRetained: true,
    };
    await durableWrite(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
    await fsyncDirectory(history);
    await Deno.remove(staging);
    await Deno.remove(journal);
    await fsyncDirectory(paths.directory);
    await fsyncDirectory(paths.stateDir);
    return receipt;
  });
}
