/** Plain native speaker notes with a bounded, independently revalidated QMD patch. */
import {
  hashSource,
  scanSource,
  sliceBytes,
  type SourceBlock,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import type { Node } from "../render/types.ts";

export const NOTES_CODEC_VERSION = 1;
export interface NotesRequest {
  blockId: string;
  slideId: string;
  expected: string;
  text: string;
}
export interface NotesPreview {
  version: 1;
  kind: "speaker-notes";
  sourceHash: string;
  requests: NotesRequest[];
  patches: SourcePatch[];
  result: string;
  resultHash: string;
}
function fail(code: string, message: string): never {
  throw new SourceError(code, `${code}: ${message}`);
}
const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g;
const escapedPunctuation = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g;
export function normalizeNotesText(value: string): string {
  const text = value.replace(/\r\n|\r/g, "\n");
  if (/`+(?:\{(?:r|python|julia|ojs)\}|(?:r|python|julia|ojs)\s)/i.test(text)) {
    fail(
      "COMPUTED_NOTES_UNSUPPORTED",
      "Inline execution syntax cannot be introduced through plain notes; execution preprocessors may run before Markdown escaping.",
    );
  }
  if (
    Array.from(text).some((character) => {
      const point = character.codePointAt(0)!;
      return point < 32 && point !== 10 || point === 127 ||
        point >= 0xd800 && point <= 0xdfff;
    }) ||
    / {2}|^ | $/m.test(text) || /^\n|\n$|\n{3}/.test(text)
  ) {
    fail(
      "UNSUPPORTED_NOTES_WHITESPACE",
      "Plain notes support single spaces, line breaks and one blank line between paragraphs; remove tabs, indentation and extra surrounding whitespace before syncing.",
    );
  }
  return text;
}
/** Native Bento uses a textarea/textContent: richer AST nodes must never become HTML. */
export function renderPlainNotes(blocks: Node[]): string {
  return blocks.map((block) => {
    if (block.t !== "Para" && block.t !== "Plain") {
      return fail(
        "UNSUPPORTED_NOTES",
        "Speaker notes support plain paragraphs only; rich or structured blocks need explicit source authoring.",
      );
    }
    return (block.c as Node[]).map((node) => {
      if (node.t === "Str") return String(node.c);
      if (node.t === "Space") return " ";
      if (node.t === "SoftBreak") return "\n";
      return fail(
        "UNSUPPORTED_NOTES",
        `Speaker notes cannot faithfully project ${node.t} into native plain text.`,
      );
    }).join("");
  }).join("\n\n");
}
function opener(block: SourceBlock): string[] | undefined {
  const first = block.raw.split(/\r\n|\n|\r/, 1)[0];
  const match = first.match(/^ {0,3}:{3,}\s*\{([^{}]*)\}\s*$/);
  return match?.[1].trim().split(/\s+/);
}
export function sourceNotes(
  doc: SourceDocument,
  blockId: string,
  slideId: string,
): { block: SourceBlock; text: string } {
  const candidates = doc.blocks.filter((b) => b.id === blockId);
  if (doc.diagnostics.length || candidates.length !== 1) {
    fail(
      "AMBIGUOUS_NOTES",
      "Resolve source diagnostics and use one unique explicit notes identity.",
    );
  }
  const block = candidates[0], tokens = opener(block);
  const slide = doc.slides.find((s) => s.id === slideId);
  if (
    block.kind !== "div" || !block.explicitId || !block.stable ||
    block.parentId ||
    block.slideId !== slideId || !slide?.stable || !tokens ||
    tokens.length !== 2 || !tokens.includes(".notes") ||
    !tokens.includes(`#${blockId}`)
  ) {
    fail(
      "UNMAPPED_NOTES",
      "Speaker notes need one top-level ::: {#notes-id .notes} block under an explicitly identified slide; extra attributes/classes are unsupported.",
    );
  }
  const owners = doc.blocks.filter((b) =>
    b.kind === "div" && b.slideId === slideId && opener(b)?.includes(".notes")
  );
  if (owners.length !== 1) {
    fail(
      "AMBIGUOUS_NOTES",
      "Use a single notes block per slide before editing from Bento.",
    );
  }
  const children = doc.blocks.filter((b) =>
    b !== block && b.span.start >= block.contentSpan.start &&
    b.span.end <= block.contentSpan.end
  );
  // Execution preprocessors run before Markdown escaping. In particular knitr
  // still recognizes an escaped `r ...` opener, so keep this conservative gate.
  if (children.some((b) => b.origin === "computed" || b.kind === "chunk")) {
    fail(
      "COMPUTED_NOTES_UNSUPPORTED",
      "Computed speaker notes cannot be reverse-written as authored content.",
    );
  }
  if (
    children.some((b) =>
      b.parentId !== blockId || !["paragraph", "unsupported"].includes(b.kind)
    )
  ) {
    fail(
      "UNSUPPORTED_NOTES",
      "Speaker notes must contain only plain paragraphs.",
    );
  }
  // Literal source proof is compared with the executed plain AST at projection.
  // Decode only Markdown backslash punctuation, never HTML or arbitrary transforms.
  const text = block.content.replace(/\r\n|\r/g, "\n").replace(/^\n+|\n+$/g, "")
    .replace(escapedPunctuation, "$1");
  normalizeNotesText(text);
  return { block, text };
}
export function previewNotes(
  doc: SourceDocument,
  requests: NotesRequest[],
): NotesPreview {
  if (hashSource(doc.text) !== doc.hash) {
    fail("stale-document", "Notes source snapshot was modified.");
  }
  const fresh = scanSource(doc.text);
  const patches = requests.map((request): SourcePatch => {
    const { block } = sourceNotes(fresh, request.blockId, request.slideId);
    if (block.content !== request.expected) {
      fail("stale-fragment", "The notes fragment changed; review it again.");
    }
    const text = normalizeNotesText(request.text);
    const replacement = text
      ? text.replace(punctuation, "\\$&").replace(/\n/g, fresh.newline) +
        fresh.newline
      : "";
    return {
      blockId: block.id,
      span: block.contentSpan,
      expected: block.content,
      replacement,
    };
  }).sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < patches.length; i++) {
    if (
      patches[i].span.start < patches[i - 1].span.end ||
      patches[i].blockId === patches[i - 1].blockId
    ) fail("overlapping-patches", "Notes patches overlap or repeat a block.");
  }
  let result = doc.text;
  for (const patch of [...patches].reverse()) {
    result = sliceBytes(result, { start: 0, end: patch.span.start }) +
      patch.replacement +
      sliceBytes(result, {
        start: patch.span.end,
        end: new TextEncoder().encode(result).length,
      });
  }
  const after = scanSource(result);
  for (const request of requests) {
    if (
      sourceNotes(after, request.blockId, request.slideId).text !==
        normalizeNotesText(request.text)
    ) {
      fail(
        "structural-replacement",
        "Notes replacement changed its reviewed plain text.",
      );
    }
  }
  const outside = (document: SourceDocument) =>
    document.blocks.filter((b) =>
      !requests.some((r) => {
        const container = document.blocks.find((c) => c.id === r.blockId)!;
        return b.span.start >= container.contentSpan.start &&
          b.span.end <= container.contentSpan.end;
      })
    ).map((b) => [b.kind, b.explicitId, b.parentId, b.level, b.origin]);
  if (JSON.stringify(outside(fresh)) !== JSON.stringify(outside(after))) {
    fail(
      "structural-replacement",
      "Notes edit altered source structure outside the bounded body.",
    );
  }
  return {
    version: 1,
    kind: "speaker-notes",
    sourceHash: fresh.hash,
    requests,
    patches,
    result,
    resultHash: hashSource(result),
  };
}
export function applyNotes(current: string, preview: NotesPreview): string {
  if (
    preview.version !== 1 || preview.kind !== "speaker-notes" ||
    hashSource(current) !== preview.sourceHash
  ) fail("stale-source", "QMD changed after the notes review.");
  const verified = previewNotes(scanSource(current), preview.requests);
  if (JSON.stringify(verified) !== JSON.stringify(preview)) {
    fail(
      "invalid-preview",
      "The notes patch or bounds were modified after review.",
    );
  }
  return verified.result;
}
