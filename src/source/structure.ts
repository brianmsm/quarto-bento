import {
  type ComponentInsertion,
  generatedComponent,
  verifyComponentInsertion,
} from "./component-insertion.ts";
/** Explicit, review-only structural operations over original QMD source sections. */
import { hashSource, scanSource, sliceBytes, SourceError } from "./mod.ts";
import type { SourceBlock, SourceDocument, SourceSlide, Span } from "./mod.ts";
import {
  assertDeletionReferences,
  sourceDeletion,
  verifySourceDeletion,
} from "./deletion.ts";

export type StructureOperation =
  | ComponentInsertion
  | {
    type: "insert-slide";
    id: string;
    title: string;
    body: string;
    bodyIds?: string[];
    /** Slide-local Bento IDs, distinct from globally unique QMD block IDs. */
    bodyElementIds?: string[];
    titleElementId?: string;
    afterId?: string | null;
  }
  | {
    type: "insert-text";
    slideId: string;
    id: string;
    elementId: string;
    markdown: string;
  }
  | { type: "reorder-slides"; ids: string[] }
  | { type: "delete-slide"; id: string; confirmed: true }
  | { type: "delete-block"; blockId: string; confirmed: true }
  | { type: "pin-identities"; bindings: { blockId: string; id: string }[] };
export interface StructuralEdit {
  span: Span;
  expected: string;
  replacement: string;
}
export interface StructureStep {
  operation: StructureOperation;
  beforeHash: string;
  afterHash: string;
  edits: StructuralEdit[];
}
export interface StructurePreview {
  version: 1;
  sourceHash: string;
  resultHash: string;
  operations: StructureOperation[];
  steps: StructureStep[];
  result: string;
}
const encode = new TextEncoder();
const decode = new TextDecoder("utf-8", { fatal: true });
const idPattern = /^[\p{L}_][\p{L}\p{N}\p{M}_.:-]*$/u;
function fail(code: string, message: string): never {
  throw new SourceError(code, message);
}
function assertIdentity(id: string): void {
  if (!idPattern.test(id)) {
    fail("invalid-id", `Invalid source identity: ${id}.`);
  }
}
function assertDocument(doc: SourceDocument): void {
  if (doc.diagnostics.length) {
    fail(
      "ambiguous-structure",
      "Resolve source diagnostics before structural changes.",
    );
  }
  const ids = doc.blocks.map((b) => b.id);
  if (new Set(ids).size !== ids.length) {
    fail("duplicate-id", "Source identities must be unique.");
  }
}
function uniqueSlide(doc: SourceDocument, id: string): SourceSlide {
  const slides = doc.slides.filter((s) => s.id === id);
  if (slides.length !== 1) {
    fail("missing-slide", `Slide ${id} is missing or ambiguous.`);
  }
  if (!slides[0].stable) {
    fail(
      "unstable-slide",
      "Pin slide identity explicitly before changing source order.",
    );
  }
  return slides[0];
}
/** A preceding technical marker travels with the heading it identifies. */
function sectionSpans(doc: SourceDocument): Map<string, Span> {
  const starts = doc.slides.map((slide) => {
    const before = sliceBytes(doc.text, { start: 0, end: slide.span.start });
    const marker = before.match(
      /(?:^|\n)([ \t]*<!--[ \t]*qb:([\p{L}_][\p{L}\p{N}\p{M}_.:-]*)[ \t]*-->[ \t]*(?:(?:\r\n|\n)[ \t]*)+)$/u,
    );
    if (marker && marker[2] === slide.id) {
      return slide.span.start - encode.encode(marker[1]).length;
    }
    return slide.span.start;
  });
  return new Map(
    doc.slides.map((
      slide,
      index,
    ) => [slide.id, {
      start: starts[index],
      end: starts[index + 1] ?? doc.byteLength,
    }]),
  );
}
function replace(doc: SourceDocument, edits: StructuralEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.span.start - b.span.start);
  for (let i = 0; i < sorted.length; i++) {
    const edit = sorted[i];
    if (
      !Number.isInteger(edit.span.start) || !Number.isInteger(edit.span.end) ||
      edit.span.start < 0 || edit.span.end < edit.span.start ||
      edit.span.end > doc.byteLength
    ) fail("invalid-span", "Invalid structural edit span.");
    if (i && edit.span.start <= sorted[i - 1].span.end) {
      fail("overlapping-patches", "Structural edit spans overlap.");
    }
    if (sliceBytes(doc.text, edit.span) !== edit.expected) {
      fail("stale-fragment", "Structural source fragment changed.");
    }
  }
  let bytes = encode.encode(doc.text);
  for (const edit of sorted.reverse()) {
    const inserted = encode.encode(edit.replacement);
    const next = new Uint8Array(
      bytes.length - (edit.span.end - edit.span.start) + inserted.length,
    );
    next.set(bytes.subarray(0, edit.span.start));
    next.set(inserted, edit.span.start);
    next.set(bytes.subarray(edit.span.end), edit.span.start + inserted.length);
    bytes = next;
  }
  return decode.decode(bytes);
}
function producerOrder(doc: SourceDocument, boundaryNewline = false): string[] {
  return doc.blocks.filter((b) => b.origin === "computed").map((b) =>
    JSON.stringify([
      b.kind,
      b.explicitId ?? null,
      boundaryNewline ? b.raw.replace(/\r?\n$/, "") : b.raw,
    ])
  );
}
function sameProducerOrder(
  before: SourceDocument,
  after: SourceDocument,
  boundaryNewline = false,
): void {
  if (
    JSON.stringify(producerOrder(before, boundaryNewline)) !==
      JSON.stringify(producerOrder(after, boundaryNewline))
  ) {
    fail(
      "execution-order",
      "Structural edit would change executable or computed source order.",
    );
  }
}
function generatedSlide(
  doc: SourceDocument,
  operation: Extract<StructureOperation, { type: "insert-slide" }>,
): string {
  assertIdentity(operation.id);
  if (!operation.title.trim() || /[\r\n]|\{[^}]*\}/.test(operation.title)) {
    fail("invalid-slide", "A new slide requires a single-line authored title.");
  }
  const titleDoc = scanSource(`## ${operation.title} {#${operation.id}}\n`);
  if (
    titleDoc.blocks.length !== 1 || titleDoc.blocks[0].kind !== "heading" ||
    titleDoc.blocks[0].content !== operation.title ||
    !titleDoc.blocks[0].editable || titleDoc.blocks[0].id !== operation.id
  ) fail("invalid-slide", "Title contains structural or executable syntax.");
  const body = operation.body.replace(/\r\n|\r|\n/g, "\n").trim();
  const bodyDoc = scanSource(body);
  if (
    bodyDoc.diagnostics.length || (body && bodyDoc.blocks.length === 0) ||
    bodyDoc.blocks.some((b) =>
      b.kind !== "paragraph" || !b.editable || b.explicitId
    ) || /<!--|-->|\{\{[<%]/.test(body)
  ) {
    fail(
      "invalid-slide",
      "New slide body supports authored paragraphs only; structural or executable syntax must be authored explicitly in QMD.",
    );
  }
  // Scanner ignores front matter/comments: require all non-whitespace body bytes belong to paragraphs.
  let cursor = 0;
  for (const block of bodyDoc.blocks) {
    if (sliceBytes(body, { start: cursor, end: block.span.start }).trim()) {
      fail("invalid-slide", "Body contains unmapped source syntax.");
    }
    cursor = block.span.end;
  }
  if (sliceBytes(body, { start: cursor, end: bodyDoc.byteLength }).trim()) {
    fail("invalid-slide", "Body contains unmapped source syntax.");
  }
  if (operation.titleElementId !== undefined) {
    assertIdentity(operation.titleElementId);
  }
  const bodyIds = operation.bodyIds ??
    bodyDoc.blocks.map((_block, index) => `${operation.id}-text-${index + 1}`);
  if (bodyIds.length !== bodyDoc.blocks.length) {
    fail(
      "invalid-slide",
      "Each body paragraph requires exactly one native text identity.",
    );
  }
  bodyIds.forEach(assertIdentity);
  const nativeIds = operation.bodyElementIds ?? bodyIds;
  if (nativeIds.length !== bodyIds.length) {
    fail("invalid-slide", "Each body paragraph needs one visual identity.");
  }
  nativeIds.forEach(assertIdentity);
  if (
    new Set([operation.id, ...bodyIds]).size !== bodyIds.length + 1 ||
    new Set(nativeIds).size !== nativeIds.length ||
    (operation.titleElementId && nativeIds.includes(operation.titleElementId))
  ) fail("duplicate-id", "Created slide identities collide.");
  const titleAttribute = operation.titleElementId
    ? ` bento-title-id="${operation.titleElementId}"`
    : "";
  const pieces = [`## ${operation.title} {#${operation.id}${titleAttribute}}`];
  bodyDoc.blocks.forEach((block, index) =>
    pieces.push(
      operation.bodyElementIds
        ? `::: {#${bodyIds[index]} bento-element-id="${
          nativeIds[index]
        }"}\n${block.content}\n:::`
        : `<!-- qb:${bodyIds[index]} -->\n${block.content}`,
    )
  );
  const result = (pieces.join("\n\n") + "\n\n").replace(/\n/g, doc.newline);
  const existing = new Set(doc.blocks.map((b) => b.id));
  const generated = scanSource(result);
  for (const block of generated.blocks) {
    if (existing.has(block.id)) {
      fail("duplicate-id", `Source identity ${block.id} already exists.`);
    }
  }
  return result;
}
/** One standalone authored paragraph, with a distinct source and native identity. */
function generatedText(
  doc: SourceDocument,
  operation: Extract<StructureOperation, { type: "insert-text" }>,
): string {
  assertIdentity(operation.id);
  assertIdentity(operation.elementId);
  const body = operation.markdown.replace(/\r\n|\r/g, "\n");
  const parsed = scanSource(body), block = parsed.blocks[0];
  if (
    parsed.diagnostics.length || parsed.blocks.length !== 1 ||
    block.kind !== "paragraph" || !block.editable || block.explicitId ||
    block.parentId || block.content !== body ||
    /<!--|-->|\{\{[<%]/.test(body)
  ) {
    fail(
      "invalid-text-insertion",
      "New text must be one complete authored paragraph; author structural or executable content explicitly in QMD.",
    );
  }
  const result =
    `::: {#${operation.id} bento-element-id="${operation.elementId}"}\n${body}\n:::\n\n`;
  const existing = new Set(doc.blocks.map((b) => b.id));
  for (const created of scanSource(result).blocks) {
    if (existing.has(created.id)) {
      fail("duplicate-id", `Source identity ${created.id} already exists.`);
    }
  }
  return result.replace(/\n/g, doc.newline);
}
function validateStep(
  doc: SourceDocument,
  operation: StructureOperation,
): StructuralEdit[] {
  assertDocument(doc);
  const spans = sectionSpans(doc);
  switch (operation.type) {
    case "insert-slide": {
      const section = generatedSlide(doc, operation);
      let offset = doc.byteLength;
      if (operation.afterId === null) {
        offset = doc.slides.length
          ? spans.get(doc.slides[0].id)!.start
          : doc.byteLength;
      } else if (operation.afterId !== undefined) {
        offset = spans.get(uniqueSlide(doc, operation.afterId).id)!.end;
      }
      const before = sliceBytes(doc.text, { start: 0, end: offset });
      const prefix = before && !/(?:\r?\n){2}$/.test(before)
        ? (/(?:\r?\n)$/.test(before) ? doc.newline : doc.newline + doc.newline)
        : "";
      return [{
        span: { start: offset, end: offset },
        expected: "",
        replacement: prefix + section,
      }];
    }
    case "insert-component":
    case "insert-text": {
      const slide = uniqueSlide(doc, operation.slideId);
      const section = operation.type === "insert-component"
        ? generatedComponent(doc, operation)
        : generatedText(doc, operation);
      const offset = spans.get(slide.id)!.end;
      const before = sliceBytes(doc.text, { start: 0, end: offset });
      const prefix = before && !/(?:\r?\n){2}$/.test(before)
        ? (/(?:\r?\n)$/.test(before) ? doc.newline : doc.newline + doc.newline)
        : "";
      return [{
        span: { start: offset, end: offset },
        expected: "",
        replacement: prefix + section,
      }];
    }
    case "reorder-slides": {
      if (
        operation.ids.length !== doc.slides.length ||
        new Set(operation.ids).size !== operation.ids.length ||
        operation.ids.some((id) => !spans.has(id))
      ) {
        fail(
          "invalid-order",
          "Reorder must contain every current slide exactly once.",
        );
      }
      for (const id of operation.ids) uniqueSlide(doc, id);
      if (!doc.slides.length) return [];
      const start = spans.get(doc.slides[0].id)!.start;
      const replacement = operation.ids.map((id) =>
        sliceBytes(doc.text, spans.get(id)!)
      ).join("");
      return [{
        span: { start, end: doc.byteLength },
        expected: sliceBytes(doc.text, { start, end: doc.byteLength }),
        replacement,
      }];
    }
    case "delete-slide": {
      if (operation.confirmed !== true) {
        fail(
          "confirmation-required",
          "Deleting source requires an explicit confirmed operation.",
        );
      }
      const slide = uniqueSlide(doc, operation.id), span = spans.get(slide.id)!;
      const members = doc.blocks.filter((b) =>
        b.span.start >= span.start && b.span.start < span.end
      );
      if (
        members.some((b) => b.origin === "computed" || b.kind === "unsupported")
      ) {
        fail(
          "unsafe-delete",
          "Cannot delete computed producers or source with unverified shared dependencies.",
        );
      }
      const rest = sliceBytes(doc.text, { start: 0, end: span.start }) +
        sliceBytes(doc.text, { start: span.end, end: doc.byteLength });
      assertDeletionReferences(
        rest,
        members.flatMap((block) => block.explicitId ? [block.explicitId] : []),
      );
      return [{ span, expected: sliceBytes(doc.text, span), replacement: "" }];
    }
    case "delete-block": {
      if (operation.confirmed !== true) {
        fail(
          "confirmation-required",
          "Deleting source requires an explicit confirmed operation.",
        );
      }
      const { span, expected, replacement } = sourceDeletion(
        doc,
        operation.blockId,
      );
      return [{ span, expected, replacement }];
    }
    case "pin-identities": {
      const used = new Set(doc.blocks.map((b) => b.id)),
        seen = new Set<string>();
      return operation.bindings.map(({ blockId, id }) => {
        assertIdentity(id);
        if (seen.has(blockId) || used.has(id)) {
          fail(
            "duplicate-id",
            "Identity pinning repeats or collides with an existing source identity.",
          );
        }
        const matches = doc.blocks.filter((b) => b.id === blockId);
        if (matches.length !== 1) {
          fail("ambiguous-source", `Cannot uniquely identify ${blockId}.`);
        }
        const block = matches[0];
        if (block.stable) {
          fail(
            "already-pinned",
            `Block ${blockId} already has an explicit identity.`,
          );
        }
        if (block.kind === "unsupported") {
          fail("unmapped", "Cannot pin an unsupported source construct.");
        }
        used.add(id);
        seen.add(blockId);
        return {
          span: { start: block.span.start, end: block.span.start },
          expected: "",
          replacement: `<!-- qb:${id} -->${doc.newline}`,
        };
      });
    }
    default:
      return fail("unsupported-operation", "Unknown structural operation.");
  }
}
function verifyResult(
  before: SourceDocument,
  after: SourceDocument,
  operation: StructureOperation,
): void {
  assertDocument(after);
  if (operation.type === "reorder-slides") {
    if (
      JSON.stringify(after.slides.map((s) => s.id)) !==
        JSON.stringify(operation.ids)
    ) {
      fail(
        "ambiguous-boundary",
        "Slide boundaries cannot be moved without altering original bytes; add an explicit blank-line boundary in QMD first.",
      );
    }
    sameProducerOrder(before, after);
  } else if (operation.type === "insert-slide") {
    if (
      after.slides.length !== before.slides.length + 1 ||
      !after.slides.some((s) => s.id === operation.id)
    ) {
      fail(
        "invalid-slide",
        "Insertion did not create exactly one source slide.",
      );
    }
    sameProducerOrder(before, after);
  } else if (operation.type === "insert-component") {
    verifyComponentInsertion(before, after, operation);
    sameProducerOrder(before, after, true);
  } else if (operation.type === "insert-text") {
    const added = after.blocks.filter((block) =>
      block.id === operation.id || block.parentId === operation.id
    );
    const wrapper = added.find((block) => block.id === operation.id);
    const paragraph = added.find((block) =>
      block.id === `${operation.id}/paragraph:1`
    );
    const prior = before.blocks.map((
      block,
    ) => [
      block.kind,
      block.raw.replace(/\r?\n$/, ""),
      block.origin,
      block.level,
      block.slideId,
    ]);
    const remaining = after.blocks.filter((block) => !added.includes(block))
      .map((
        block,
      ) => [
        block.kind,
        block.raw.replace(/\r?\n$/, ""),
        block.origin,
        block.level,
        block.slideId,
      ]);
    if (
      added.length !== 2 || wrapper?.kind !== "div" || wrapper.parentId ||
      !wrapper.stable || wrapper.slideId !== operation.slideId ||
      paragraph?.kind !== "paragraph" || paragraph.origin !== "authored" ||
      !paragraph.editable || paragraph.slideId !== operation.slideId ||
      paragraph.content.replace(/\r\n/g, "\n") !==
        operation.markdown.replace(/\r\n|\r/g, "\n") ||
      JSON.stringify(before.slides.map((slide) => [slide.id, slide.stable])) !==
        JSON.stringify(after.slides.map((slide) => [slide.id, slide.stable])) ||
      JSON.stringify(prior) !== JSON.stringify(remaining)
    ) {
      fail(
        "invalid-text-insertion",
        "Insertion must create exactly one standalone text block without changing existing source boundaries; close or explicitly repair the surrounding QMD first.",
      );
    }
    // A separator may add the first newline after the final original fence.
    sameProducerOrder(before, after, true);
  } else if (operation.type === "delete-slide") {
    if (after.slides.length !== before.slides.length - 1) {
      fail(
        "ambiguous-boundary",
        "Deletion changed unrelated slide boundaries.",
      );
    }
    sameProducerOrder(before, after);
  } else if (operation.type === "delete-block") {
    verifySourceDeletion(before, after, operation.blockId);
    sameProducerOrder(before, after);
  } else {
    // Pinning changes identity metadata, never block content, execution or order.
    const content = (blocks: SourceBlock[]) =>
      blocks.map((b) => [
        b.kind,
        b.kind === "div"
          ? b.content.replace(
            /^[ \t]*<!--[ \t]*qb:[\p{L}_][\p{L}\p{N}\p{M}_.:-]*[ \t]*-->[ \t]*(?:\r\n|\n)/gmu,
            "",
          )
          : b.content,
        b.origin,
        b.level,
      ]);
    if (
      JSON.stringify(content(before.blocks)) !==
        JSON.stringify(content(after.blocks))
    ) fail("unsafe-pin", "Marker insertion changed parsed source semantics.");
    for (const binding of operation.bindings) {
      if (!after.blocks.some((b) => b.id === binding.id && b.stable)) {
        fail(
          "unsafe-pin",
          "Inserted identity did not survive a fresh source scan.",
        );
      }
    }
  }
}
/** Preview sequential explicit structural changes. No source or sidecar files are written. */
export function previewStructure(
  document: SourceDocument,
  operations: StructureOperation[],
): StructurePreview {
  if (hashSource(document.text) !== document.hash) {
    fail("stale-source", "Source snapshot changed.");
  }
  let current = scanSource(document.text);
  const steps: StructureStep[] = [];
  for (const supplied of operations) {
    const operation = structuredClone(supplied);
    const edits = validateStep(current, operation);
    const result = replace(current, edits), after = scanSource(result);
    verifyResult(current, after, operation);
    steps.push({
      operation,
      beforeHash: current.hash,
      afterHash: after.hash,
      edits,
    });
    current = after;
  }
  return {
    version: 1,
    sourceHash: document.hash,
    resultHash: current.hash,
    operations: structuredClone(operations),
    steps,
    result: current.text,
  };
}
/** Replays and verifies an approved preview against the unchanged original snapshot. */
export function applyStructure(
  currentText: string,
  preview: StructurePreview,
): string {
  if (preview.version !== 1 || hashSource(currentText) !== preview.sourceHash) {
    fail(
      "stale-source",
      "Source changed after structural preview; review again.",
    );
  }
  const verified = previewStructure(
    scanSource(currentText),
    preview.operations,
  );
  if (JSON.stringify(verified) !== JSON.stringify(preview)) {
    fail("invalid-preview", "Structural preview was modified after review.");
  }
  return verified.result;
}
