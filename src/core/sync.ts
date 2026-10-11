import {
  canonicalInlineHtml,
  INLINE_CODEC_VERSION,
  inlineHtmlToMarkdown,
} from "../render/inline.ts";
export { canonicalInlineHtml, inlineHtmlToMarkdown } from "../render/inline.ts";
/** Approved bounded text synchronization with a durable, recoverable QMD transaction. */
import { basename, resolve } from "node:path";
import { projectPaths, withProject } from "./project.ts";
import {
  canonical,
  clone,
  promoteCreated,
  StateError,
  StateStore,
  targetKey,
} from "../state/mod.ts";
import type {
  BentoDoc,
  BentoSlide,
  Change,
  ProjectState,
  Value,
} from "../state/mod.ts";
import {
  applyPatches,
  hashSource,
  previewPatches,
  scanSource,
} from "../source/mod.ts";
import type { PatchPreview, SourceBlock } from "../source/mod.ts";
import {
  applyAttributePatches,
  previewAttributePatches,
  sourceDesignAttribute,
} from "../source/attributes.ts";
import type {
  AttributePreview,
  AttributeRequest,
} from "../source/attributes.ts";
import {
  applyNotes,
  normalizeNotesText,
  NOTES_CODEC_VERSION,
  type NotesPreview,
  type NotesRequest,
  previewNotes,
  sourceNotes,
} from "../source/notes.ts";
import { validateDesignValue } from "../render/design.ts";
import { applyStructure, previewStructure } from "../source/structure.ts";
import type {
  StructureOperation,
  StructurePreview,
} from "../source/structure.ts";
export interface SyncNormalization {
  changeId: string;
  expectedAfter: Value;
  after: Value;
}
export interface SyncApproval {
  version: 1;
  docId: string;
  sourceHash: string;
  stateRevision: number;
  planHash: string;
  expectedPending: Change[];
  creationChangeIds: string[];
  normalizations: SyncNormalization[];
}
export interface SyncApprovalEnvelope {
  format: "qbento-sync-approval/1";
  sha256: string;
  approval: SyncApproval;
}
export interface SyncOptions {
  confirmedDeleteIds?: string[];
}
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
  attributes?: AttributePreview;
  notes?: NotesPreview;
  structure?: StructurePreview;
  result: string;
  resultHash: string;
  confirmedDeleteIds: string[];
  creationChangeIds: string[];
  normalizations: SyncNormalization[];
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
export function validateSyncApproval(
  value: unknown,
): asserts value is SyncApprovalEnvelope {
  const e = value as SyncApprovalEnvelope;
  if (
    !e || e.format !== "qbento-sync-approval/1" || !e.approval ||
    e.sha256 !== hashSource(canonical(e.approval))
  ) fail("INVALID_APPROVAL", "Sync approval checksum or version is invalid.");
  const a = e.approval;
  if (
    a.version !== 1 || typeof a.docId !== "string" ||
    typeof a.sourceHash !== "string" || typeof a.planHash !== "string" ||
    !Number.isSafeInteger(a.stateRevision) || a.stateRevision < 1 ||
    !Array.isArray(a.expectedPending) || !Array.isArray(a.creationChangeIds) ||
    !Array.isArray(a.normalizations)
  ) fail("INVALID_APPROVAL", "Sync approval metadata is malformed.");
  const ids = a.expectedPending.map((p) => p?.id);
  if (
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length ||
    new Set(a.creationChangeIds).size !== a.creationChangeIds.length ||
    a.creationChangeIds.some((id) =>
      !a.expectedPending.some((p) =>
        p.id === id && ["create-slide", "create-element"].includes(p.kind)
      )
    ) ||
    new Set(a.normalizations.map((n) => n.changeId)).size !==
      a.normalizations.length ||
    a.normalizations.some((n) =>
      !ids.includes(n.changeId) ||
      canonical(n.expectedAfter) !== canonical(
          a.expectedPending.find((p) => p.id === n.changeId)!.after,
        )
    )
  ) {
    fail(
      "INVALID_APPROVAL",
      "Sync approval expectations do not identify exact pending edits.",
    );
  }
}
/** Called only with fresh executed source before compose; approval is never inferred from IDs. */
export function prepareApprovedSync(
  state: ProjectState,
  generated: BentoDoc,
  sourceHash: string,
  envelope: SyncApprovalEnvelope,
): ProjectState {
  validateSyncApproval(envelope);
  const a = envelope.approval;
  if (
    state.docId !== a.docId || generated.docId !== a.docId ||
    sourceHash !== a.sourceHash || state.revision < a.stateRevision
  ) {
    fail(
      "STALE_APPROVAL",
      "Approved sync differs from the current source, document or state revision; recover/review before rendering.",
    );
  }
  for (const expected of a.expectedPending) {
    if (
      canonical(state.pending.find((p) => p.id === expected.id)) !==
        canonical(expected)
    ) {
      fail(
        "STALE_APPROVAL",
        "A selected pending edit changed after source synchronization; preserve it and review the approval.",
      );
    }
  }
  const prepared = clone(state);
  for (const n of a.normalizations) {
    prepared.pending.find((p) => p.id === n.changeId)!.after = clone(n.after);
  }
  for (
    const change of a.expectedPending.filter((p) => p.kind === "delete-slide")
  ) {
    const slideId = change.target.slideId;
    if (!slideId || generated.slides.some((slide) => slide.id === slideId)) {
      fail(
        "STALE_APPROVAL",
        "Approved source deletion is not reflected by fresh execution.",
      );
    }
    delete prepared.provenance[targetKey({ slideId })];
    for (
      const element of prepared.generatedBaseline.slides.find((slide) =>
        slide.id === slideId
      )?.elements ?? []
    ) {
      delete prepared.provenance[targetKey({ slideId, elementId: element.id })];
    }
  }
  return promoteCreated(prepared, generated, a.creationChangeIds);
}
function chooseBlock(
  sourceText: string,
  state: ProjectState,
  change: Change,
  kinds: string[] = ["heading", "paragraph"],
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
  // Old saved projections flattened links/code. Require a fresh faithful baseline
  // before permitting rich original fragments to synchronize after an upgrade.
  if (
    ["heading", "paragraph"].includes(source.kind) &&
    source.inlineCodec !== INLINE_CODEC_VERSION &&
    /(?<!\\)(?:`|\[|<)|https?:\/\//i.test(source.content)
  ) {
    fail(
      "SOURCE_FORMAT_UNSUPPORTED",
      "This saved baseline predates faithful inline projection. Recalculate and review the source before syncing links or inline code.",
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
    !kinds.includes(block.kind) || !block.editable ||
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
  options: SyncOptions = {},
): SyncPlan {
  const ids = selectedChangeIds ?? state.pending.map((p) => p.id),
    confirmedDeleteIds = options.confirmedDeleteIds ?? [];
  if (!ids.length) fail("NO_PENDING_CHANGES", "No pending changes selected.");
  if (
    new Set(ids).size !== ids.length ||
    confirmedDeleteIds.some((id) => !ids.includes(id))
  ) {
    fail(
      "INVALID_SELECTION",
      "Selected changes must be unique and deletion confirmations must be selected.",
    );
  }
  const selected = ids.map((id) => {
    const p = state.pending.find((p) => p.id === id);
    if (!p) fail("INVALID_SELECTION", `Pending change ${id} is missing.`);
    if (p.status === "conflict") {
      fail("SYNC_CONFLICT", `Resolve conflict ${id} before synchronization.`);
    }
    return p;
  });
  const changes: SyncItem[] = [],
    normalizations: SyncNormalization[] = [],
    operations: StructureOperation[] = [],
    creationChangeIds: string[] = [];
  const attributeRequests: AttributeRequest[] = [];
  const notesRequests: NotesRequest[] = [];
  const textRequests: {
    blockId: string;
    expected: string;
    replacement: string;
  }[] = [];
  const addNormalization = (change: Change, after: Value) => {
    if (canonical(change.after) !== canonical(after)) {
      normalizations.push({
        changeId: change.id,
        expectedAfter: clone(change.after),
        after,
      });
    }
  };
  // Existing text edits first, then source creation/deletion, finally the requested final order.
  for (const change of selected) {
    if (change.kind === "field") {
      const key = targetKey(change.target);
      if (
        change.path.length === 1 &&
        state.ownership[key]?.includes(change.path[0])
      ) {
        const design = state.provenance[key]?.source?.design;
        const binding =
          design && !Array.isArray(design) && typeof design === "object"
            ? design[change.path[0]]
            : undefined;
        if (
          !binding || typeof binding !== "object" || Array.isArray(binding) ||
          typeof binding.blockId !== "string" ||
          typeof binding.attribute !== "string" ||
          typeof binding.value !== "string"
        ) {
          fail(
            "UNMAPPED_DESIGN",
            "This source-owned field has no independent inverse mapping. Edit its parent declaration in QMD or keep the source value.",
          );
        }
        if (
          !change.after.present ||
          !["string", "number"].includes(typeof change.after.value)
        ) {
          fail(
            "UNSUPPORTED_SYNC",
            "A declared visual attribute needs a supported explicit value.",
          );
        }
        const expected = sourceDesignAttribute(
          scanSource(text),
          binding.blockId,
          binding.attribute,
        );
        if (expected !== binding.value) {
          fail(
            "SOURCE_CONFLICT",
            "The same visual attribute changed in QMD; compare with QMD and resolve it before syncing.",
          );
        }
        const value = validateDesignValue(
          binding.attribute,
          change.after.value as string | number,
        );
        attributeRequests.push({
          blockId: binding.blockId,
          attribute: binding.attribute,
          expected,
          value,
        });
        changes.push({
          changeId: change.id,
          target: change.target,
          blockId: binding.blockId,
          kind: "visual-attribute",
          before: `${binding.attribute}=${expected}`,
          after: `${binding.attribute}=${value}`,
          html: "",
        });
        continue;
      }
      if (
        canonical(change.path) === canonical(["notes"]) &&
        !change.target.elementId && change.target.slideId
      ) {
        const provenance = state.provenance[key], baseline = provenance?.source;
        if (
          change.origin !== "authored" || provenance?.origin !== "authored" ||
          baseline?.kind !== "notes" ||
          baseline.notesCodec !== NOTES_CODEC_VERSION ||
          typeof baseline.blockId !== "string" ||
          typeof baseline.content !== "string"
        ) {
          fail(
            "UNMAPPED_NOTES",
            "These notes have no verified existing QMD notes block. Author an identified .notes div and recalculate before syncing.",
          );
        }
        if (!change.after.present || typeof change.after.value !== "string") {
          fail(
            "UNSUPPORTED_SYNC",
            "Clear notes with an empty string; removing the notes property is unsupported.",
          );
        }
        const { block } = sourceNotes(
          scanSource(text),
          baseline.blockId,
          change.target.slideId,
        );
        if (block.content !== baseline.content) {
          fail(
            "SOURCE_CONFLICT",
            "QMD independently changed the same speaker notes; compare and resolve before syncing.",
          );
        }
        const normalized = normalizeNotesText(change.after.value);
        notesRequests.push({
          blockId: block.id,
          slideId: change.target.slideId,
          expected: block.content,
          text: normalized,
        });
        changes.push({
          changeId: change.id,
          target: change.target,
          blockId: block.id,
          kind: "notes",
          before: block.content,
          after: normalized,
          html: "",
        });
        addNormalization(change, { present: true, value: normalized });
        continue;
      }
      const displayedCode = canonical(change.path) === canonical(["content"]);
      if (
        (!displayedCode && canonical(change.path) !== canonical(["html"])) ||
        !change.after.present || typeof change.after.value !== "string"
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          `Change ${change.id} is not a supported authored text or displayed-code edit.`,
        );
      }
      if (
        change.origin !== "authored" ||
        state.provenance[targetKey(change.target)]?.origin !== "authored"
      ) {
        fail(
          "COMPUTED_SYNC_FORBIDDEN",
          `Change ${change.id} is not authored source text.`,
        );
      }
      const { block, expected } = chooseBlock(
          text,
          state,
          change,
          displayedCode ? ["code"] : ["heading", "paragraph"],
        ),
        normalized = displayedCode
          ? change.after.value.replace(/\r\n|\r/g, "\n")
          : canonicalInlineHtml(change.after.value),
        after = displayedCode
          ? normalized + "\n"
          : inlineHtmlToMarkdown(change.after.value);
      textRequests.push({ blockId: block.id, expected, replacement: after });
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId: block.id,
        kind: block.kind,
        before: expected,
        after,
        html: change.after.value,
      });
      addNormalization(change, {
        present: true,
        value: normalized,
      });
    } else if (change.kind === "create-slide") {
      const slide = change.after.value as BentoSlide;
      if (
        !change.after.present || !slide || slide.id !== change.target.slideId ||
        !Array.isArray(slide.elements)
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          "New slide lacks a valid native document identity.",
        );
      }
      if (
        (slide.notes && slide.notes !== "") ||
        (slide.title && slide.title !== "")
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          "New-slide notes and separate title metadata need explicit source authoring.",
        );
      }
      if (
        slide.elements.some((e) =>
          !["text", "shape", "line", "arrow", "path"].includes(e.type)
        )
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          "New slides currently support authored text and pure visual decorations.",
        );
      }
      const texts = slide.elements.filter((e) => e.type === "text");
      if (!texts.length || texts.some((e) => typeof e.html !== "string")) {
        fail(
          "UNSUPPORTED_SYNC",
          "New slide requires a text title and supported text bodies.",
        );
      }
      const title = inlineHtmlToMarkdown(texts[0].html as string),
        body = texts.slice(1).map((e) =>
          inlineHtmlToMarkdown(e.html as string)
        );
      operations.push({
        type: "insert-slide",
        id: slide.id,
        title,
        body: body.join("\n\n"),
        titleElementId: texts[0].id,
        bodyElementIds: texts.slice(1).map((e) => e.id),
      });
      creationChangeIds.push(change.id);
      const normalized = clone(slide);
      for (const e of normalized.elements) {
        if (e.type === "text") e.html = canonicalInlineHtml(e.html as string);
      }
      addNormalization(change, { present: true, value: normalized });
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId: slide.id,
        kind: "create-slide",
        before: "",
        after: [title, ...body].join("\n\n"),
        html: canonical(slide),
      });
    } else if (change.kind === "slide-order") {
      if (
        !Array.isArray(change.after.value) ||
        change.after.value.some((id) => typeof id !== "string")
      ) fail("UNSUPPORTED_SYNC", "Pending slide order is malformed.");
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId: "slides",
        kind: "slide-order",
        before: canonical(change.before.value),
        after: canonical(change.after.value),
        html: "",
      });
    } else if (change.kind === "delete-slide") {
      if (!confirmedDeleteIds.includes(change.id) || !change.target.slideId) {
        fail(
          "CONFIRM_DELETE_REQUIRED",
          "Source deletion requires a separately explicit confirmedDeleteIds selection.",
        );
      }
      operations.push({
        type: "delete-slide",
        id: change.target.slideId,
        confirmed: true,
      });
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId: change.target.slideId,
        kind: "delete-slide",
        before: canonical(change.before.value),
        after: "",
        html: "",
      });
    } else {fail(
        "UNSUPPORTED_SYNC",
        `Change ${change.id} is not a supported source synchronization operation.`,
      );}
  }
  for (const change of selected.filter((p) => p.kind === "slide-order")) {
    operations.push({
      type: "reorder-slides",
      ids: change.after.value as string[],
    });
  }
  const patch = previewPatches(scanSource(text), textRequests);
  const notes = notesRequests.length
    ? previewNotes(scanSource(patch.result), notesRequests)
    : undefined;
  const notesResult = notes?.result ?? patch.result;
  const attributes = attributeRequests.length
    ? previewAttributePatches(scanSource(notesResult), attributeRequests)
    : undefined;
  const attributeResult = attributes?.result ?? notesResult;
  const structure = operations.length
    ? previewStructure(scanSource(attributeResult), operations)
    : undefined;
  const result = structure?.result ?? attributeResult;
  const unsigned = {
    version: 1 as const,
    source,
    sourceHash: hashSource(text),
    stateRevision: state.revision,
    stateHash: hashSource(canonical(state)),
    selectedChangeIds: [...ids],
    excludedChangeIds: state.pending.filter((p) => !ids.includes(p.id)).map((
      p,
    ) => p.id),
    changes,
    patch,
    ...(attributes ? { attributes } : {}),
    ...(notes ? { notes } : {}),
    ...(structure ? { structure } : {}),
    result,
    resultHash: hashSource(result),
    confirmedDeleteIds: [...confirmedDeleteIds],
    creationChangeIds,
    normalizations,
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
      "sync-approved.json",
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
  options: SyncOptions = {},
): Promise<SyncPlan> {
  const { paths, state, text } = await readableSnapshot(source);
  return buildPlan(paths.source, text, state, selectedChangeIds, options);
}
/** Explicit approved action; leaves pending semantic edits until a future render confirms them. */
export async function applySync(
  source: string,
  plan: SyncPlan,
): Promise<SyncReceipt> {
  return await withProject(source, async (paths, store) => {
    if (await present(resolve(paths.stateDir, "sync-approved.json"))) {
      fail(
        "APPROVAL_PENDING",
        "Render or explicitly recover the previous approved sync before applying another.",
      );
    }
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
      { confirmedDeleteIds: plan.confirmedDeleteIds },
    );
    if (canonical(verified) !== canonical(plan)) {
      fail(
        "INVALID_PLAN",
        "Sync plan was altered or no longer reproduces the approved result.",
      );
    }
    const textResult = applyPatches(text, verified.patch);
    const notesResult = verified.notes
      ? applyNotes(textResult, verified.notes)
      : textResult;
    const attributeResult = verified.attributes
      ? applyAttributePatches(notesResult, verified.attributes)
      : notesResult;
    const result = verified.structure
      ? applyStructure(attributeResult, verified.structure)
      : attributeResult;
    if (
      result !== verified.result || hashSource(result) !== verified.resultHash
    ) {
      fail(
        "INVALID_PLAN",
        "Combined text and structure result differs from approved source.",
      );
    }
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
    const needsApproval = verified.creationChangeIds.length > 0 ||
      verified.normalizations.length > 0 ||
      verified.confirmedDeleteIds.length > 0;
    const approvalPath = resolve(paths.stateDir, "sync-approved.json"),
      approvalStaging = resolve(history, `sync-approval-${transactionId}.json`);
    if (needsApproval) {
      const approval: SyncApproval = {
        version: 1,
        docId: state.docId,
        sourceHash: verified.resultHash,
        stateRevision: state.revision + 1,
        planHash: verified.planHash,
        expectedPending: verified.selectedChangeIds.map((id) =>
          clone(state.pending.find((p) => p.id === id)!)
        ),
        creationChangeIds: verified.creationChangeIds,
        normalizations: verified.normalizations,
      };
      const envelope: SyncApprovalEnvelope = {
        format: "qbento-sync-approval/1",
        sha256: hashSource(canonical(approval)),
        approval,
      };
      await durableWrite(
        approvalStaging,
        JSON.stringify(envelope, null, 2) + "\n",
      );
      await fsyncDirectory(history);
    }
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
          resultHash: plan.resultHash,
          stateRevision: state.revision,
          planHash: plan.planHash,
          selectedChangeIds: plan.selectedChangeIds,
          ...(needsApproval ? { approvalPath, approvalStaging } : {}),
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
        verified.resultHash
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
        verified.resultHash
    ) {
      fail(
        "STALE_SOURCE",
        "Source changed while recording sync; inspect the retained transaction.",
      );
    }
    if (needsApproval) {
      await Deno.link(approvalStaging, approvalPath);
      await fsyncDirectory(paths.stateDir);
    }
    const receipt: SyncReceipt = {
      version: 1,
      transactionId,
      source: paths.source,
      planHash: plan.planHash,
      previousSourceHash: plan.sourceHash,
      sourceHash: verified.resultHash,
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
