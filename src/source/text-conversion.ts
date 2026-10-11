/** Explicit paragraph/list conversion over one independently bound source unit. */
import {
  scanSource,
  sliceBytes,
  type SourceDocument,
  SourceError,
  type Span,
} from "./mod.ts";
import { pureWrapper } from "./deletion.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
import { isNativeIdentity } from "./identity-id.ts";
export interface TextConversion {
  type: "convert-text";
  blockId: string;
  expected: string;
  markdown: string;
  from: "paragraph" | "list";
  to: "paragraph" | "list";
  nativeId: string;
}
const fail = (message: string): never => {
  throw new SourceError("unsafe-text-conversion", message);
};
function binding(doc: SourceDocument, op: TextConversion) {
  const blocks = doc.blocks.filter((b) => b.id === op.blockId),
    block = blocks[0];
  if (
    doc.diagnostics.length || blocks.length !== 1 || !block.editable ||
    block.origin !== "authored" || block.kind !== op.from ||
    block.content !== op.expected || !block.slideId ||
    !isNativeIdentity(op.nativeId) ||
    !["paragraph", "list"].includes(op.from) ||
    !["paragraph", "list"].includes(op.to) || op.from === op.to
  ) {
    fail(
      "Conversion needs an exact independent authored paragraph/list baseline.",
    );
  }
  const parent = block.parentId
    ? doc.blocks.find((b) => b.id === block.parentId)
    : undefined;
  if (parent) {
    if (!parent.stable || parent.parentId) {
      fail("Nested or weak containers need explicit source authoring.");
    }
    pureWrapper(doc, parent, block);
    if (block.explicitId && block.id !== op.nativeId) {
      fail(
        "The technical marker must retain its native identity during conversion.",
      );
    }
  } else if (!block.stable || block.id !== op.nativeId) {
    fail(
      "Acquire an explicit source/native identity before converting this text.",
    );
  }
  const parsed = scanSource(op.markdown), replacement = parsed.blocks[0];
  if (
    parsed.diagnostics.length || parsed.blocks.length !== 1 ||
    replacement.kind !== op.to || !replacement.editable ||
    replacement.origin !== "authored" || replacement.explicitId ||
    replacement.parentId || replacement.content !== op.markdown ||
    /<!--|-->|\{\{[<%]/.test(op.markdown)
  ) {
    fail(
      "Replacement must be exactly one non-executable authored paragraph or list.",
    );
  }
  return { block, parent };
}
export function convertedBlockId(
  doc: SourceDocument,
  op: TextConversion,
): string {
  const { block } = binding(doc, op);
  return block.explicitId ??
    (block.parentId ? `${block.parentId}/${op.to}:1` : block.id);
}
export function conversionEdits(
  doc: SourceDocument,
  op: TextConversion,
): { span: Span; expected: string; replacement: string }[] {
  const { block, parent } = binding(doc, op);
  const edits = [{
    span: block.contentSpan,
    expected: block.content,
    replacement: op.markdown.replace(/\r\n|\r|\n/g, doc.newline),
  }];
  if (parent && !block.explicitId) {
    const opener = parent.raw.split(/\r?\n/)[0];
    const attributeText = /\{([^{}]+)\}/.exec(opener)![1];
    const attributes = originalPandocAttributes(
      attributeText,
      originalAttributeTokens(attributeText),
    );
    const existing = attributes[2].find(([key]) => key === "bento-element-id");
    if (existing && existing[1] !== op.nativeId) {
      fail(
        "Container's explicit native identity differs from the edited object.",
      );
    }
    if (!existing) {
      const end = opener.lastIndexOf("}");
      if (end < 0) fail("Missing verified wrapper attributes.");
      const span = {
        start: parent.span.start,
        end: parent.span.start + new TextEncoder().encode(opener).length,
      };
      edits.push({
        span,
        expected: sliceBytes(doc.text, span),
        replacement: opener.slice(0, end) +
          ` bento-element-id="${op.nativeId}"` + opener.slice(end),
      });
    }
  }
  return edits;
}
export function verifyConversion(
  before: SourceDocument,
  after: SourceDocument,
  op: TextConversion,
): void {
  const { block, parent } = binding(before, op),
    id = convertedBlockId(before, op),
    next = after.blocks.find((b) => b.id === id);
  if (
    !next || next.kind !== op.to || next.origin !== "authored" ||
    !next.editable || next.slideId !== block.slideId ||
    next.content.replace(/\r\n/g, "\n") !==
      op.markdown.replace(/\r\n/g, "\n") ||
    after.blocks.length !== before.blocks.length
  ) fail("Conversion changed an unrelated source boundary.");
  const prior = before.blocks.filter((b) => b !== block && b !== parent).map(
    (b) => [b.id, b.kind, b.raw, b.origin],
  );
  const remaining = after.blocks.filter((b) =>
    b.id !== id && b.id !== parent?.id
  ).map((b) => [b.id, b.kind, b.raw, b.origin]);
  if (JSON.stringify(prior) !== JSON.stringify(remaining)) {
    fail("Conversion changed unrelated source bytes or identities.");
  }
}
