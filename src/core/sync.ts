import { loadDesignRegistry } from "../render/registry.ts";
import {
  assertCurrentComponentSource,
  componentOperation,
  projectAuthoredComponent,
} from "./component-actions.ts";
import { componentMarkdown } from "../source/component-insertion.ts";
import {
  type ComponentApproval,
  prepareComponentApprovals,
  validateComponentApprovals,
} from "./component-sync.ts";
import {
  type ComponentCreation,
  componentProblems,
  type ComponentProjection,
} from "../state/mod.ts";
import {
  canonicalInlineHtml,
  INLINE_CODEC_VERSION,
  inlineHtmlToMarkdown,
  renderInline,
} from "../render/inline.ts";
export { canonicalInlineHtml, inlineHtmlToMarkdown } from "../render/inline.ts";
import { LIST_CODEC_VERSION, parseNativeList } from "../render/lists.ts";
import { MATH_CODEC_VERSION, parseNativeDisplayMath } from "../render/math.ts";
import { graphSyncRequest, preflightGraphSync } from "./graph-sync.ts";
import {
  applyGraphEndpoints,
  type GraphEndpointPreview,
  type GraphEndpointRequest,
  previewGraphEndpoints,
} from "../source/graphs.ts";
/** Approved bounded text synchronization with a durable, recoverable QMD transaction. */
import { verifiedSourceSlide } from "./source-scope.ts";
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
  JsonObject,
  ProjectState,
  Provenance,
  ProvenanceMap,
  Target,
  Value,
} from "../state/mod.ts";
import {
  applyPatches,
  hashSource,
  previewPatches,
  scanSource,
} from "../source/mod.ts";
import type {
  PatchPreview,
  SourceBlock,
  SourceDocument,
} from "../source/mod.ts";
import type { Node } from "../render/types.ts";
import { readSourceInline } from "../render/source-inline.ts";
import {
  applyIdentities,
  type IdentityPreview,
  type IdentityRequest,
  previewIdentities,
} from "../source/identities.ts";
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
  notesIdentity,
  type NotesPreview,
  type NotesRequest,
  previewNotes,
  sourceNotes,
} from "../source/notes.ts";
import { validateDesignValue } from "../render/design.ts";
import {
  type AnnotationDiagnostic,
  type AnnotationPreview,
  applyAnnotations,
  previewAnnotations,
} from "../source/annotations.ts";
import {
  annotationIdentityDiagnostics,
  type AnnotationRegistry,
  annotationRegistry,
  annotationRequests,
  type AnnotationSummary,
  originalAnnotationLevel,
  registryEqual,
} from "./annotations.ts";
import { applyStructure, previewStructure } from "../source/structure.ts";
import { sourceDeletion } from "../source/deletion.ts";
import type {
  StructureOperation,
  StructurePreview,
} from "../source/structure.ts";
export interface SyncNormalization {
  changeId: string;
  expectedAfter: Value;
  after: Value;
}
export interface SyncIdentityBinding {
  target: Target;
  before: Provenance;
  after: Provenance;
  expectedHtml: string;
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
  componentApprovals?: ComponentApproval[];
  componentRetirements?: ComponentCreation[];
  componentProjectionRetirements?: ComponentProjection[];
  /** Exact post-apply state before any element deletion may retire retained edits. */
  deletionStateHash?: string;
  identityBindings?: SyncIdentityBinding[];
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
  graphs?: GraphEndpointPreview;
  structure?: StructurePreview;
  identities?: IdentityPreview;
  annotations: AnnotationPreview;
  designRegistry: AnnotationRegistry;
  result: string;
  resultHash: string;
  confirmedDeleteIds: string[];
  creationChangeIds: string[];
  normalizations: SyncNormalization[];
  identityBindings?: SyncIdentityBinding[];
  componentApprovals?: ComponentApproval[];
  componentRetirements?: ComponentCreation[];
  componentProjectionRetirements?: ComponentProjection[];
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
  annotations: AnnotationSummary;
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
    !Array.isArray(a.normalizations) ||
    (a.deletionStateHash !== undefined &&
      !/^[a-f0-9]{64}$/.test(a.deletionStateHash))
  ) fail("INVALID_APPROVAL", "Sync approval metadata is malformed.");
  if (a.identityBindings !== undefined) {
    if (
      !Array.isArray(a.identityBindings) || a.identityBindings.some((binding) =>
        !binding || !binding.target
      ) || new Set(a.identityBindings.map((binding) =>
          targetKey(binding.target)
        )).size !== a.identityBindings.length ||
      a.identityBindings.some((binding) =>
        typeof binding.target.slideId !== "string" || !binding.target.slideId ||
        typeof binding.target.elementId !== "string" ||
        !binding.target.elementId || typeof binding.expectedHtml !== "string" ||
        binding.before?.origin !== "authored" ||
        binding.after?.origin !== "authored" ||
        typeof binding.before.source?.hash !== "string" ||
        binding.after.source?.hash !== a.sourceHash ||
        typeof binding.before.source?.blockId !== "string" ||
        typeof binding.after.source?.blockId !== "string" ||
        binding.before.semanticId !== binding.before.source.blockId ||
        binding.after.semanticId !== binding.after.source.blockId
      )
    ) {
      fail(
        "INVALID_APPROVAL",
        "Identity approval requires exact authored source bindings and native targets.",
      );
    }
  }
  validateComponentApprovals(
    a.componentApprovals,
    a.componentRetirements,
    a.docId,
    a.componentProjectionRetirements,
  );
  if (
    ((a.componentRetirements?.length ?? 0) +
        (a.componentProjectionRetirements?.length ?? 0)) > 0 &&
    (!a.deletionStateHash ||
      [
        ...a.componentRetirements ?? [],
        ...a.componentProjectionRetirements ?? [],
      ].some((intent) =>
        !a.expectedPending.some((pending) =>
          pending.kind === "delete-slide" &&
          pending.target.slideId === intent.slideId
        )
      ))
  ) {
    fail(
      "INVALID_APPROVAL",
      "Pending components retire only under exact approved parent deletion.",
    );
  }
  for (const approval of a.componentApprovals ?? []) {
    if (
      approval.intent.members.some((member) =>
        !a.expectedPending.some((pending) =>
          pending.kind === "create-element" &&
          pending.target.slideId === approval.intent.slideId &&
          pending.target.elementId === member.nativeId &&
          a.creationChangeIds.includes(pending.id)
        )
      )
    ) {
      fail(
        "INVALID_APPROVAL",
        "Every component role must have its own approved pending creation.",
      );
    }
  }
  const ids = a.expectedPending.map((p) => p?.id);
  if (
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length ||
    new Set(a.creationChangeIds).size !== a.creationChangeIds.length ||
    (a.expectedPending.some((p) => p.kind === "delete-element") &&
      !a.deletionStateHash) ||
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
  freshProvenance?: ProvenanceMap,
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
  const elementDeletions = a.expectedPending.filter((p) =>
    p.kind === "delete-element"
  );
  if (
    (elementDeletions.length || a.componentRetirements?.length ||
      a.componentProjectionRetirements?.length) &&
    hashSource(canonical(state)) !== a.deletionStateHash
  ) {
    fail(
      "STALE_APPROVAL",
      "The saved project changed after approving source-element deletion; preserve the pending edits and recover/review before rendering.",
    );
  }
  const prepared = clone(state);
  for (const binding of a.identityBindings ?? []) {
    const key = targetKey(binding.target), fresh = freshProvenance?.[key];
    const element = generated.slides.find((slide) =>
      slide.id === binding.target.slideId
    )?.elements.find((element) => element.id === binding.target.elementId);
    if (
      canonical(state.provenance[key]) !== canonical(binding.before) ||
      canonical(fresh) !== canonical(binding.after) ||
      fresh?.source?.hash !== sourceHash || element?.type !== "text" ||
      element.html !== binding.expectedHtml
    ) {
      fail(
        "STALE_APPROVAL",
        "Approved identity acquisition lacks exact fresh source and content proof; pending edits are retained.",
      );
    }
    prepared.provenance[key] = clone(fresh!);
  }
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
  for (const change of elementDeletions) {
    const { slideId, elementId } = change.target;
    const slide = generated.slides.find((item) => item.id === slideId);
    if (
      !slideId || !elementId || !slide ||
      slide.elements.some((item) => item.id === elementId)
    ) {
      fail(
        "STALE_APPROVAL",
        "Fresh execution must retain the slide and omit exactly the approved source element before its pending content and design are retired.",
      );
    }
    const covers = (target: Change["target"]) =>
      target.slideId === slideId && target.elementId === elementId;
    delete prepared.provenance[targetKey(change.target)];
    delete prepared.ownership[targetKey(change.target)];
    prepared.overrides = prepared.overrides.filter((item) =>
      !covers(item.target)
    );
    prepared.bentoOnly = prepared.bentoOnly.filter((item) =>
      !(item.slideId === slideId && item.element.id === elementId)
    );
    prepared.pending = prepared.pending.filter((item) => !covers(item.target));
    for (
      const order of prepared.elementOrders.filter((item) =>
        item.slideId === slideId
      )
    ) {
      order.ids = order.ids.filter((id) => id !== elementId);
    }
  }
  const components = prepareComponentApprovals(
    prepared,
    generated,
    sourceHash,
    a.componentApprovals,
    a.componentRetirements,
    freshProvenance,
    a.componentProjectionRetirements,
  );
  return promoteCreated(components, generated, a.creationChangeIds);
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
  if (source.kind === "list" && source.listCodec !== LIST_CODEC_VERSION) {
    fail(
      "SOURCE_FORMAT_UNSUPPORTED",
      "Recalculate before synchronizing a list without its verified codec baseline.",
    );
  }
  if (source.kind === "math" && source.mathCodec !== MATH_CODEC_VERSION) {
    fail(
      "SOURCE_FORMAT_UNSUPPORTED",
      "This saved equation lacks a verified display-math baseline; recalculate and review before syncing.",
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
function acquiredProvenance(
  before: Provenance,
  block: SourceBlock,
  document: SourceDocument,
): Provenance {
  const source: JsonObject = {
    ...clone(before.source!),
    hash: document.hash,
    inlineCodec: INLINE_CODEC_VERSION,
    blockId: block.id,
    content: block.content,
    kind: block.kind,
    stable: block.stable,
  };
  delete source.parentId;
  delete source.siblings;
  if (block.parentId) {
    source.parentId = block.parentId;
    source.siblings = document.blocks.filter((candidate) =>
      candidate.parentId === block.parentId && candidate.kind === block.kind
    ).length;
  }
  return { ...clone(before), semanticId: block.id, source };
}
/** A global source hash change affects every weak authored binding, selected or not. */
function identityAcquisition(
  text: string,
  state: ProjectState,
  selected: Change[],
) {
  if (!selected.length) return undefined;
  const document = scanSource(text), requests: IdentityRequest[] = [];
  for (const [key, proof] of Object.entries(state.provenance)) {
    if (proof.origin === "computed") continue;
    const binding = proof.source;
    const block = document.blocks.find((candidate) =>
      candidate.id === binding?.blockId
    );
    const singleton = binding?.siblings === 1 &&
      typeof binding.parentId === "string" &&
      document.blocks.some((parent) =>
        parent.id === binding.parentId && parent.stable
      ) &&
      document.blocks.filter((candidate) =>
          candidate.parentId === binding.parentId &&
          candidate.kind === binding.kind
        ).length === 1;
    if (binding?.stable === true && block?.stable || singleton) continue;
    const target = JSON.parse(key) as [string | null, string | null];
    const slideId = target[0], elementId = target[1];
    if (
      selected.some((change) =>
        change.kind === "delete-slide" && change.target.slideId === slideId ||
        change.kind === "delete-element" && targetKey(change.target) === key
      )
    ) continue;
    const element = state.generatedBaseline.slides.find((slide) =>
      slide.id === slideId
    )?.elements.find((element) => element.id === elementId);
    if (
      !slideId || !elementId || proof.origin !== "authored" || !binding ||
      !block || document.blocks.filter((candidate) =>
          candidate.id === block.id
        ).length !== 1 ||
      binding.hash !== document.hash || proof.semanticId !== block.id ||
      block.content !== binding.content || block.kind !== binding.kind ||
      block.origin !== "authored" || !block.editable ||
      !["heading", "paragraph", "list"].includes(block.kind) ||
      element?.type !== "text" || typeof element.html !== "string"
    ) {
      fail(
        "AMBIGUOUS_IDENTITY",
        "A source change needs exact weak authored heading/paragraph/list proofs from the unchanged executed baseline; pin unsupported or externally changed identities and recalculate before syncing. Pending edits are retained.",
      );
    }
    const title = block.kind === "heading" &&
      document.slides.some((slide) => slide.headingId === block.id);
    requests.push({
      blockId: block.id,
      sourceId: title
        ? slideId
        : block.kind === "heading"
        ? elementId
        : `qb-identity-${
          hashSource(canonical([state.docId, slideId, elementId])).slice(0, 24)
        }`,
      nativeId: elementId,
      title,
    });
  }
  const producerRequests = document.blocks.filter((block) =>
    block.kind === "chunk" && !block.stable && !block.parentId &&
    !selected.some((change) =>
      change.kind === "delete-slide" && change.target.slideId === block.slideId
    )
  ).map((block) => block.id);
  if (producerRequests.length) {
    const hashes = new Set(
      Object.values(state.provenance).map((proof) => proof.source?.hash).filter(
        (hash) => typeof hash === "string",
      ),
    );
    if (hashes.size !== 1 || !hashes.has(document.hash)) {
      fail(
        "AMBIGUOUS_IDENTITY",
        "Retaining executable producer identities requires the unchanged executed source; recalculate before review.",
      );
    }
  }
  return requests.length || producerRequests.length
    ? previewIdentities(document, requests, producerRequests)
    : undefined;
}
function assertMappedDisplayMath(html: string): void {
  if (/\$\$|\\\[/.test(html)) {
    fail(
      "UNSUPPORTED_MATH",
      "A new display equation requires a separately authored QMD math block; this text conversion has no verified math mapping.",
    );
  }
}
/** New source acquisition needs the current executed identities, never ID coincidence. */
function assertTextCreationSource(
  state: ProjectState,
  source: SourceDocument,
  change: Change,
  acquiredIds: ReadonlyMap<string, string> = new Map(),
) {
  const slideId = change.target.slideId, elementId = change.target.elementId;
  const baseline = state.generatedBaseline.slides.find((slide) =>
    slide.id === slideId
  );
  if (
    !slideId || !elementId || !baseline ||
    !state.emitted.slides.some((slide) => slide.id === slideId) ||
    change.origin !== "authored" || change.before.present ||
    baseline.elements.some((element) => element.id === elementId) ||
    state.provenance[targetKey(change.target)]
  ) {
    fail(
      "UNSUPPORTED_TEXT_INSERTION",
      "New text needs an existing source slide and an unused native identity; restore or resolve conflicting objects first. Pending edits are retained.",
    );
  }
  const proofs = Object.values(state.provenance);
  const hashes = new Set(
    proofs.map((proof) => proof.source?.hash).filter((hash) =>
      typeof hash === "string"
    ),
  );
  if (hashes.size !== 1 || !hashes.has(source.hash)) {
    fail(
      "STALE_SOURCE",
      "QMD differs from the executed baseline; recalculate and review before inserting new text. Pending edits are retained.",
    );
  }
  for (const proof of proofs.filter((proof) => proof.origin !== "computed")) {
    const binding = proof.source;
    const parent = source.blocks.find((block) =>
      block.id === binding?.parentId
    );
    if (
      binding?.stable !== true &&
      !(parent?.stable && binding?.siblings === 1) &&
      !acquiredIds.has(String(binding?.blockId))
    ) {
      fail(
        "AMBIGUOUS_IDENTITY",
        "Pin existing authored block identities in QMD and recalculate before inserting text; the insertion must not invalidate saved visual mappings. Pending edits are retained.",
      );
    }
  }
}
/** Parse only the new fragment; this never executes source or rewrites the document. */
async function assertInsertedInline(markdown: string, expected: string) {
  const process = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = process.output(), writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(markdown));
  await writer.close();
  const result = await output;
  if (!result.success) {
    fail(
      "UNSUPPORTED_TEXT_INSERTION",
      "Pandoc could not verify the inserted text fragment; author it explicitly in QMD.",
    );
  }
  const parsed = JSON.parse(new TextDecoder().decode(result.stdout));
  if (
    !Array.isArray(parsed.blocks) || parsed.blocks.length !== 1 ||
    parsed.blocks[0].t !== "Para" ||
    renderInline(parsed.blocks[0].c as Node[]) !== expected
  ) {
    fail(
      "UNSUPPORTED_TEXT_INSERTION",
      "The inserted text does not round-trip faithfully through Pandoc; remove unsupported formatting or author it explicitly in QMD. Pending edits are retained.",
    );
  }
}
async function buildPlan(
  source: string,
  text: string,
  state: ProjectState,
  selectedChangeIds?: string[],
  options: SyncOptions = {},
): Promise<SyncPlan> {
  const ids = selectedChangeIds ?? state.pending.map((p) => p.id),
    confirmedDeleteIds = options.confirmedDeleteIds ?? [];
  if (
    new Set(ids).size !== ids.length ||
    new Set(confirmedDeleteIds).size !== confirmedDeleteIds.length ||
    confirmedDeleteIds.some((id) =>
      !ids.includes(id) ||
      !state.pending.some((p) =>
        p.id === id &&
        ["delete-slide", "delete-element"].includes(p.kind)
      )
    )
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
  if (
    selected.some((change) =>
      change.kind === "delete-element" &&
      state.pending.some((pending) =>
        pending.kind === "delete-slide" &&
        pending.target.slideId === change.target.slideId
      )
    )
  ) {
    fail(
      "OVERLAPPING_SOURCE_DELETE",
      "This element belongs to a slide also marked for deletion. Restore the pending element deletion through Compare with QMD before reviewing the slide deletion, or restore the slide before reviewing the element. No QMD changes are proposed.",
    );
  }
  const identities = identityAcquisition(text, state, selected);
  const identityResult = identities?.result ?? text;
  const acquiredIds = new Map(
    identities?.bindings.map((
      binding,
    ) => [binding.blockId, binding.newBlockId]) ?? [],
  );
  const componentApprovals: ComponentApproval[] = [],
    componentRetirements: ComponentCreation[] = [];
  const componentProjectionRetirements = (state.componentProjections ?? [])
    .filter((record) =>
      selected.some((pending) =>
        pending.kind === "delete-slide" &&
        pending.target.slideId === record.slideId
      )
    ).map((record) => clone(record));
  const componentChangeIds = new Set<string>();
  for (const intent of state.componentCreations ?? []) {
    const memberChanges = state.pending.filter((pending) =>
      pending.kind === "create-element" &&
      pending.target.slideId === intent.slideId &&
      intent.members.some((member) =>
        member.nativeId === pending.target.elementId
      )
    );
    const selectedMembers = memberChanges.filter((pending) =>
      ids.includes(pending.id)
    );
    const parentDelete = selected.some((pending) =>
      pending.kind === "delete-slide" &&
      pending.target.slideId === intent.slideId
    );
    if (parentDelete) {
      componentRetirements.push(clone(intent));
      memberChanges.forEach((pending) => componentChangeIds.add(pending.id));
      continue;
    }
    if (!selectedMembers.length && selectedChangeIds !== undefined) continue;
    const problems = componentProblems(state, intent);
    if (problems.length) {
      fail(
        "COMPONENT_INCOMPLETE",
        problems.join(" ") +
          " Abre Añadir componente para restaurar miembros ausentes o descartar la creación pendiente.",
      );
    }
    if (selectedMembers.length !== intent.members.length) {
      fail(
        "PARTIAL_COMPONENT_SELECTION",
        "Review all fields of a pending component together; a partial source acquisition is not approved.",
      );
    }
    const mapping = scanSource(text);
    assertCurrentComponentSource(state, mapping);
    for (const pending of memberChanges) {
      assertTextCreationSource(state, mapping, pending, acquiredIds);
    }
    const operation = componentOperation(intent, state.emitted);
    previewStructure(scanSource(identityResult), [operation]);
    const registry = await loadDesignRegistry(projectPaths(source).directory);
    const projection = await projectAuthoredComponent(
      operation,
      state.docId,
      registry.defaults,
      new Map([[intent.id, clone(intent.projectionFrame)]]),
      {
        elements: new Map(
          intent.members.map((
            member,
          ) => [member.nativeId, clone(member.snapshot)]),
        ),
        resources: state
          .emitted as unknown as import("../render/types.ts").BentoDoc,
      },
    );
    for (const member of intent.members) {
      const expected = canonicalInlineHtml(String(member.snapshot.html));
      if (
        projection.find((element) => element.id === member.nativeId)?.html !==
          expected
      ) {
        fail(
          "COMPONENT_FRAGMENT_UNSUPPORTED",
          "The component text changes when parsed; author unsupported constructs explicitly in QMD. Pending edits remain retained.",
        );
      }
    }
    componentApprovals.push({ version: 1, intent: clone(intent), operation });
    memberChanges.forEach((pending) => componentChangeIds.add(pending.id));
  }
  const changes: SyncItem[] = [],
    normalizations: SyncNormalization[] = [],
    operations: StructureOperation[] = [],
    creationChangeIds: string[] = [];
  const attributeRequests: AttributeRequest[] = [];
  const notesRequests: NotesRequest[] = [];
  const graphRequests: GraphEndpointRequest[] = [];
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
  for (const approval of componentApprovals) {
    operations.push(approval.operation);
    for (const member of approval.intent.members) {
      const change = selected.find((pending) =>
        pending.target.slideId === approval.intent.slideId &&
        pending.target.elementId === member.nativeId
      )!;
      creationChangeIds.push(change.id);
      addNormalization(change, {
        present: true,
        value: {
          ...clone(change.after.value as Record<string, never>),
          html: canonicalInlineHtml(String(member.snapshot.html)),
        },
      });
    }
    changes.push({
      changeId: `component:${approval.intent.id}`,
      target: { slideId: approval.intent.slideId },
      blockId: approval.intent.id,
      kind: "create-component",
      before: "",
      after: componentMarkdown(approval.operation),
      html: "",
    });
  }
  for (const intent of componentRetirements) {
    changes.push({
      changeId: `component-retirement:${intent.id}`,
      target: { slideId: intent.slideId },
      blockId: intent.id,
      kind: "retire-pending-component",
      before: intent.members.map((member) =>
        `${member.role}: ${member.snapshot.html}`
      ).join("\n"),
      after: "Se descarta con la eliminación de su diapositiva aprobada.",
      html: "",
    });
  }
  // Existing text edits first, then source creation/deletion, finally the requested final order.
  for (const change of selected) {
    if (componentChangeIds.has(change.id)) continue;
    // Deletion retires this object's whole pending content after fresh execution;
    // never publish an intermediate text/attribute edit to the source being removed.
    if (
      change.kind === "field" &&
      selected.some((item) =>
        item.kind === "delete-element" &&
        canonical(item.target) === canonical(change.target)
      )
    ) continue;
    if (change.kind === "field") {
      const graphRequest = graphSyncRequest(text, state, change);
      if (graphRequest) {
        graphRequests.push(graphRequest);
        changes.push({
          changeId: change.id,
          target: change.target,
          blockId: graphRequest.edgeId,
          kind: "graph-endpoint",
          before: graphRequest.expected,
          after: graphRequest.nodeId,
          html: "",
        });
        continue;
      }
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
          !provenance && change.after.present &&
          typeof change.after.value === "string"
        ) {
          const mapping = scanSource(text);
          const originalSlide = state.generatedBaseline.slides.find((slide) =>
            slide.id === change.target.slideId
          );
          const hashes = new Set(
            Object.values(state.provenance).map((proof) => proof.source?.hash),
          );
          const sourceSlide = mapping.slides.find((slide) =>
            (acquiredIds.get(slide.headingId) ?? slide.id) ===
              change.target.slideId
          );
          if (
            change.origin !== "authored" || !originalSlide ||
            (originalSlide.notes !== undefined && originalSlide.notes !== "") ||
            canonical(change.before) !==
              canonical(
                originalSlide.notes === undefined
                  ? { present: false }
                  : { present: true, value: originalSlide.notes },
              ) ||
            hashes.size !== 1 || !hashes.has(mapping.hash) || !sourceSlide
          ) {
            fail(
              "UNMAPPED_NOTES",
              "New notes require an empty executed baseline and the unchanged source slide; recalculate and review first.",
            );
          }
          verifiedSourceSlide(
            mapping,
            state,
            sourceSlide.id,
            change.target.slideId,
          );
          const normalized = normalizeNotesText(change.after.value);
          const blockId = notesIdentity(change.target.slideId);
          const operation: StructureOperation = {
            type: "insert-notes",
            slideId: change.target.slideId,
            id: blockId,
            text: normalized,
          };
          previewStructure(scanSource(identityResult), [operation]);
          operations.push(operation);
          changes.push({
            changeId: change.id,
            target: change.target,
            blockId,
            kind: "notes",
            before: "",
            after: normalized,
            html: "",
          });
          addNormalization(change, { present: true, value: normalized });
          continue;
        }
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
          `Field ${
            change.path.join(".")
          } on change ${change.id} cannot synchronize safely for this object. Pending edits are retained; edit the original QMD or explicitly resolve or detach this change.`,
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
      const displayedMath = !displayedCode &&
        state.provenance[targetKey(change.target)]?.source?.kind === "math";
      if (!displayedCode && !displayedMath) {
        assertMappedDisplayMath(change.after.value);
      }
      const displayedList =
        state.provenance[targetKey(change.target)]?.source?.kind === "list";
      const parsedList = displayedList
        ? parseNativeList(change.after.value)
        : undefined;
      const parsedMath = displayedMath
        ? parseNativeDisplayMath(change.after.value)
        : undefined;
      const { block, expected } = chooseBlock(
          text,
          state,
          change,
          displayedCode
            ? ["code"]
            : displayedMath
            ? ["math"]
            : displayedList
            ? ["list"]
            : ["heading", "paragraph"],
        ),
        normalized = displayedCode
          ? change.after.value.replace(/\r\n|\r/g, "\n")
          : parsedList?.html ?? parsedMath?.html ??
            canonicalInlineHtml(change.after.value),
        after = displayedCode
          ? normalized + "\n"
          : parsedMath
          ? parsedMath.tex + "\n"
          : parsedList?.markdown ?? inlineHtmlToMarkdown(change.after.value);
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
    } else if (change.kind === "create-element") {
      const element = change.after.value as Record<string, unknown>;
      if (
        !change.after.present || !element || element.type !== "text" ||
        element.id !== change.target.elementId ||
        typeof element.html !== "string"
      ) {
        fail(
          "UNSUPPORTED_TEXT_INSERTION",
          "Only a new authored text object on an existing slide can be inserted into QMD. Pending content is retained.",
        );
      }
      if (element.groupId) {
        fail(
          "UNSUPPORTED_TEXT_INSERTION",
          "Ungroup the new text before syncing it as a standalone block, or author its component explicitly in QMD. Grouped content remains pending.",
        );
      }
      const mapping = scanSource(text);
      assertTextCreationSource(state, mapping, change, acquiredIds);
      assertMappedDisplayMath(element.html);
      const markdown = inlineHtmlToMarkdown(element.html),
        html = canonicalInlineHtml(element.html);
      const blockId = `qb-text-${
        hashSource(canonical([change.target.slideId, element.id])).slice(0, 24)
      }`;
      const operation: StructureOperation = {
        type: "insert-text",
        slideId: change.target.slideId!,
        id: blockId,
        elementId: change.target.elementId!,
        markdown,
      };
      // Validate boundaries/identities before consulting Pandoc's fragment reader.
      previewStructure(scanSource(identityResult), [operation]);
      await assertInsertedInline(markdown, html);
      operations.push(operation);
      creationChangeIds.push(change.id);
      addNormalization(change, {
        present: true,
        value: { ...clone(element), html },
      });
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId,
        kind: "create-element",
        before: "",
        after: markdown,
        html,
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
        (slide.title && slide.title !== "")
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          "Separate title metadata needs explicit source authoring.",
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
      for (const element of texts) {
        assertMappedDisplayMath(element.html as string);
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
      if (slide.notes) {
        operations.push({
          type: "insert-notes",
          slideId: slide.id,
          id: notesIdentity(slide.id),
          text: normalizeNotesText(slide.notes as string),
        });
      }
      creationChangeIds.push(change.id);
      const normalized = clone(slide);
      if (slide.notes) {
        normalized.notes = normalizeNotesText(slide.notes as string);
      }
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
    } else if (change.kind === "delete-element") {
      if (!confirmedDeleteIds.includes(change.id)) {
        fail(
          "CONFIRM_DELETE_REQUIRED",
          "Deleting a source element requires its own explicit confirmedDeleteIds selection.",
        );
      }
      const key = targetKey(change.target);
      const baseline = state.generatedBaseline.slides.find((slide) =>
        slide.id === change.target.slideId
      )
        ?.elements.find((element) => element.id === change.target.elementId);
      if (
        !change.target.slideId || !change.target.elementId || !baseline ||
        change.origin !== "authored" ||
        state.provenance[key]?.origin !== "authored" ||
        !change.before.present || change.after.present ||
        canonical(change.before.value) !== canonical(baseline)
      ) {
        fail(
          "COMPUTED_SYNC_FORBIDDEN",
          "Element deletion requires exactly one existing authored source object; computed or detached objects cannot delete their producer.",
        );
      }
      const hashes = new Set(
        Object.values(state.provenance).map((proof) => proof.source?.hash),
      );
      if (hashes.size !== 1 || !hashes.has(hashSource(text))) {
        fail(
          "STALE_SOURCE",
          "QMD differs from the executed source baseline. Recalculate and review before deleting a source element; pending edits are retained.",
        );
      }
      const { block } = chooseBlock(text, state, change, [
        "paragraph",
        "code",
        "math",
      ]);
      // The executed proof above is checked against the unchanged source. Structural
      // ownership uses the reviewed identity phase, which can pin a plain heading.
      const deletionSource = scanSource(identityResult);
      const deletionBlock = deletionSource.blocks.find((candidate) =>
        candidate.id === block.id
      );
      const deletion = sourceDeletion(deletionSource, block.id);
      if (
        deletionBlock?.slideId !== change.target.slideId ||
        Object.entries(state.provenance).some(([otherKey, proof]) =>
          otherKey !== key && typeof proof.source?.blockId === "string" &&
          deletion.removedIds.includes(proof.source.blockId)
        )
      ) {
        fail(
          "UNSUPPORTED_SYNC",
          "This source unit is shared by another object; delete or edit its structure explicitly in QMD.",
        );
      }
      operations.push({
        type: "delete-block",
        blockId: block.id,
        confirmed: true,
      });
      changes.push({
        changeId: change.id,
        target: change.target,
        blockId: block.id,
        kind: "delete-element",
        before: deletion.expected,
        after: "",
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
  const patch = previewPatches(
    scanSource(identityResult),
    textRequests.map((request) => ({
      ...request,
      blockId: acquiredIds.get(request.blockId) ?? request.blockId,
    })),
  );
  const listChanges = changes.filter((change) => change.kind === "list");
  if (listChanges.length) {
    const proofs = await readSourceInline(scanSource(patch.result));
    for (const change of listChanges) {
      const id = acquiredIds.get(change.blockId) ?? change.blockId;
      if (proofs.get(id)?.html !== parseNativeList(change.html).html) {
        fail(
          "UNSUPPORTED_LIST",
          "Edited list does not round-trip faithfully through the original-source Pandoc reader; pending edits are retained.",
        );
      }
    }
  }
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
  const structureResult = structure?.result ?? attributeResult;
  const graphs = graphRequests.length
    ? previewGraphEndpoints(scanSource(structureResult), graphRequests)
    : undefined;
  const semanticResult = graphs?.result ?? structureResult;
  const designRegistry = await annotationRegistry(
    projectPaths(source).directory,
  );
  const level = await originalAnnotationLevel(text);
  const annotationDocument = scanSource(semanticResult);
  const signalDiagnostics: AnnotationDiagnostic[] = [];
  const requests = level === "none" ? [] : annotationRequests(
    annotationDocument,
    state,
    ids,
    designRegistry,
    signalDiagnostics,
  );
  let annotations = previewAnnotations(
    annotationDocument,
    level,
    requests,
    signalDiagnostics,
  );
  if (annotations.patches.length) {
    const annotationState = clone(state);
    for (const [key, proof] of Object.entries(annotationState.provenance)) {
      const id = acquiredIds.get(String(proof.source?.blockId));
      const block = annotationDocument.blocks.find((block) => block.id === id);
      if (block) {
        annotationState.provenance[key] = acquiredProvenance(
          proof,
          block,
          annotationDocument,
        );
      }
    }
    const blocked = annotationIdentityDiagnostics(
      annotationDocument,
      annotationState,
    );
    if (blocked.length) {
      annotations = previewAnnotations(
        annotationDocument,
        level,
        requests,
        [...signalDiagnostics, ...blocked],
      );
    }
  }
  if (
    !ids.length && !annotations.patches.length &&
    !annotations.diagnostics.length
  ) {
    fail(
      "NO_PENDING_CHANGES",
      "No pending changes or optional annotation updates selected.",
    );
  }
  for (const [index, patch] of annotations.patches.entries()) {
    changes.push({
      changeId: `annotation:${patch.blockId}:${index}`,
      target: { slideId: patch.blockId },
      blockId: patch.blockId,
      kind: "visual-annotation",
      before: patch.expected,
      after: patch.replacement,
      html: "",
    });
  }
  for (const [index, diagnostic] of annotations.diagnostics.entries()) {
    changes.push({
      changeId: `annotation-diagnostic:${index}`,
      target: diagnostic.slideId ? { slideId: diagnostic.slideId } : {},
      blockId: diagnostic.slideId ?? "annotations",
      kind: "annotation-diagnostic",
      before: "",
      after: `${diagnostic.code}: ${diagnostic.message}`,
      html: "",
    });
  }
  const result = annotations.result;
  const identityBindings: SyncIdentityBinding[] = [];
  if (identities) {
    const document = scanSource(result),
      inline = await readSourceInline(document);
    for (const binding of identities.bindings) {
      const entry = Object.entries(state.provenance).find(([, proof]) =>
        proof.source?.blockId === binding.blockId
      );
      const block = document.blocks.find((block) =>
          block.id === binding.newBlockId
        ),
        html = inline.get(binding.newBlockId)?.html;
      if (!entry || !block || typeof html !== "string") {
        fail(
          "AMBIGUOUS_IDENTITY",
          "Acquired source identity has no faithful approved content proof.",
        );
      }
      const [slideId, elementId] = JSON.parse(entry[0]) as [string, string];
      identityBindings.push({
        target: { slideId, elementId },
        before: clone(entry[1]),
        after: acquiredProvenance(entry[1], block, document),
        expectedHtml: html,
      });
    }
    for (const patch of identities.patches) {
      const index = identities.bindings.findIndex((binding) =>
        binding.blockId === patch.blockId
      );
      const binding = index >= 0 ? identityBindings[index] : undefined;
      const producer = document.blocks.find((block) =>
        block.id === patch.blockId
      );
      changes.push({
        changeId: `identity:${patch.blockId}`,
        target: binding?.target ??
          { ...(producer?.slideId ? { slideId: producer.slideId } : {}) },
        blockId: patch.blockId,
        kind: "source-identity",
        before: patch.expected,
        after: patch.replacement,
        html: "",
      });
    }
  }
  await preflightGraphSync(state, text, result);
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
    ...(graphs ? { graphs } : {}),
    ...(structure ? { structure } : {}),
    ...(identities ? { identities, identityBindings } : {}),
    annotations,
    designRegistry,
    result,
    resultHash: hashSource(result),
    confirmedDeleteIds: [...confirmedDeleteIds],
    creationChangeIds,
    normalizations,
    ...(componentApprovals.length ? { componentApprovals } : {}),
    ...(componentRetirements.length ? { componentRetirements } : {}),
    ...(componentProjectionRetirements.length
      ? { componentProjectionRetirements }
      : {}),
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
    if (
      !registryEqual(
        await annotationRegistry(paths.directory),
        plan.designRegistry,
      )
    ) {
      fail(
        "STALE_DESIGN_REGISTRY",
        "External design registry changed since preview; inspect a new plan.",
      );
    }
    const verified = await buildPlan(
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
    const identityResult = verified.identities
      ? applyIdentities(text, verified.identities)
      : text;
    const textResult = applyPatches(identityResult, verified.patch);
    const notesResult = verified.notes
      ? applyNotes(textResult, verified.notes)
      : textResult;
    const attributeResult = verified.attributes
      ? applyAttributePatches(notesResult, verified.attributes)
      : notesResult;
    const structureResult = verified.structure
      ? applyStructure(attributeResult, verified.structure)
      : attributeResult;
    const graphResult = verified.graphs
      ? applyGraphEndpoints(structureResult, verified.graphs)
      : structureResult;
    const result = applyAnnotations(graphResult, verified.annotations);
    if (result === text && !verified.selectedChangeIds.length) {
      fail(
        "NO_SOURCE_CHANGES",
        "No source patches are approved. Inspect the reviewed annotation diagnostics; no QMD change is approved by this plan.",
      );
    }
    if (
      result !== verified.result || hashSource(result) !== verified.resultHash
    ) {
      fail(
        "INVALID_PLAN",
        "Combined text and structure result differs from approved source.",
      );
    }
    const annotationSummary: AnnotationSummary = {
      level: verified.annotations.level,
      patchCount: verified.annotations.patches.length,
      diagnostics: clone(verified.annotations.diagnostics),
    };
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
      verified.confirmedDeleteIds.length > 0 ||
      (verified.identityBindings?.length ?? 0) > 0 ||
      (verified.componentRetirements?.length ?? 0) > 0 ||
      (verified.componentProjectionRetirements?.length ?? 0) > 0;
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
        ...(verified.componentApprovals
          ? { componentApprovals: clone(verified.componentApprovals) }
          : {}),
        ...(verified.componentRetirements
          ? { componentRetirements: clone(verified.componentRetirements) }
          : {}),
        ...(verified.componentProjectionRetirements
          ? {
            componentProjectionRetirements: clone(
              verified.componentProjectionRetirements,
            ),
          }
          : {}),
        ...((verified.componentRetirements?.length ||
            verified.componentProjectionRetirements?.length ||
            verified.selectedChangeIds.some((id) =>
              state.pending.some((p) =>
                p.id === id && p.kind === "delete-element"
              )
            ))
          ? {
            deletionStateHash: hashSource(
              canonical({ ...clone(state), revision: state.revision + 1 }),
            ),
          }
          : {}),
        ...(verified.identityBindings
          ? { identityBindings: verified.identityBindings }
          : {}),
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
          annotations: annotationSummary,
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
    if (
      !registryEqual(
        await annotationRegistry(paths.directory),
        plan.designRegistry,
      )
    ) {
      fail(
        "STALE_DESIGN_REGISTRY",
        "External design registry changed during preparation; inspect the retained transaction.",
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
      annotations: annotationSummary,
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
