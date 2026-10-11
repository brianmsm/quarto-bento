/** Exact removal of one independently authored source unit, without container inference. */
import {
  sliceBytes,
  type SourceBlock,
  type SourceDocument,
  SourceError,
  type Span,
} from "./mod.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
import { isSourceIdentity } from "./identity-id.ts";
import { nativeDesignField, parseDesignAttributes } from "../render/design.ts";

function fail(code: string, message: string): never {
  throw new SourceError(code, message);
}
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasHtmlReference(text: string, id: string): boolean {
  for (const tag of text.matchAll(/<[a-z](?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    for (
      const attr of tag[0].matchAll(
        /\s([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
      )
    ) {
      if (!["href", "xlink:href"].includes(attr[1].toLowerCase())) continue;
      const value = (attr[2] ?? attr[3] ?? attr[4]).replace(
        /&#(?:x([\da-f]+)|(\d+));?|&(num|colon|period|lowbar|hyphen);/gi,
        (_, hex, decimal, named) => {
          if (named) {
            return ({
              num: "#",
              colon: ":",
              period: ".",
              lowbar: "_",
              hyphen: "-",
            } as Record<string, string>)[named.toLowerCase()];
          }
          const code = parseInt(hex ?? decimal, hex ? 16 : 10);
          return code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
        },
      ).trim();
      if (anchorMatches(value, id)) return true;
    }
  }
  return false;
}
function anchorMatches(value: string, id: string): boolean {
  if (!value.startsWith("#")) return false;
  try {
    return decodeURIComponent(value.slice(1)) === id;
  } catch {
    return false;
  }
}
/** Shared dependency guard for verified slide or element deletion. */
export function assertDeletionReferences(rest: string, ids: string[]): void {
  for (const original of ids) {
    const id = escapeRegex(original);
    const markdownLinks = rest.matchAll(
      /(?:\]\(\s*(?:<([^>]+)>|([^\s)]+))|^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+)))/gm,
    );
    if (
      new RegExp(`@${id}(?:\\.(?![\\w:.-])|(?![\\w:.-]))`).test(rest) ||
      [...markdownLinks].some((match) =>
        anchorMatches(match[1] ?? match[2] ?? match[3] ?? match[4], original)
      ) || hasHtmlReference(rest, original)
    ) {
      fail(
        "shared-reference",
        `Other source references ${original}; deletion requires dependency resolution.`,
      );
    }
  }
}
/** Include only this unit's immediately preceding technical identity marker. */
function withMarker(doc: SourceDocument, block: SourceBlock): Span {
  const before = sliceBytes(doc.text, { start: 0, end: block.span.start });
  const marker = before.match(
    /(?:^|\n)([ \t]*<!--[ \t]*qb:([^\s<>]+)[ \t]*-->[ \t]*(?:(?:\r\n|\n)[ \t]*)+)$/,
  );
  return {
    start: marker?.[2] === block.id && isSourceIdentity(marker[2])
      ? block.span.start - new TextEncoder().encode(marker[1]).length
      : block.span.start,
    end: block.span.end,
  };
}
export interface SourceDeletion {
  blockId: string;
  removedIds: string[];
  span: Span;
  expected: string;
  replacement: "";
}
/** A plain wrapper may provide identity/design, but cannot stand for a semantic component. */
function pureWrapper(
  doc: SourceDocument,
  parent: SourceBlock,
  block: SourceBlock,
): void {
  const opener = parent.raw.split(/\r?\n/)[0].match(
    /^ {0,3}(:{3,})[ \t]+\{([^{}]+)\}[ \t]*$/,
  );
  if (!opener) {
    fail(
      "unsafe-element-delete",
      "The containing div has no verified standalone boundary.",
    );
  }
  const attr = originalPandocAttributes(
    opener[2],
    originalAttributeTokens(opener[2]),
  );
  parseDesignAttributes(attr);
  if (
    attr[0] !== parent.id || attr[1].length ||
    attr[2].some(([key]) =>
      key !== "bento-element-id" && !nativeDesignField(key)
    ) ||
    new Set(attr[2].map(([key]) => key)).size !== attr[2].length
  ) {
    fail(
      "unsafe-element-delete",
      "A semantic component or unverified container must be edited explicitly in QMD.",
    );
  }
  const descendants = doc.blocks.filter((candidate) =>
    candidate !== parent && candidate.span.start >= parent.span.start &&
    candidate.span.end <= parent.span.end
  );
  if (descendants.length !== 1 || descendants[0] !== block) {
    fail(
      "unsafe-element-delete",
      "The containing div must contain exactly one independent authored element.",
    );
  }
  const leading = sliceBytes(doc.text, {
    start: parent.contentSpan.start,
    end: block.span.start,
  });
  const trailing = sliceBytes(doc.text, {
    start: block.span.end,
    end: parent.contentSpan.end,
  });
  // Scanner ignores comments; refuse hidden syntax except the child's own identity marker.
  const cleanLeading = block.explicitId
    ? leading.replace(
      new RegExp(
        `^[ \t]*<!--[ \t]*qb:${
          escapeRegex(block.id)
        }[ \t]*-->[ \t]*(?:\r?\n|$)`,
        "m",
      ),
      "",
    )
    : leading;
  const closer = sliceBytes(doc.text, {
    start: parent.contentSpan.end,
    end: parent.span.end,
  });
  if (cleanLeading.trim() || trailing.trim() || closer.trim() !== opener[1]) {
    fail(
      "unsafe-element-delete",
      "The containing div includes unverified syntax or a mismatched closing fence.",
    );
  }
}
/** Validate the source-only portion; core also verifies its exact executed provenance. */
export function sourceDeletion(
  doc: SourceDocument,
  blockId: string,
): SourceDeletion {
  if (doc.diagnostics.length) {
    fail(
      "ambiguous-structure",
      "Resolve source diagnostics before deleting an element.",
    );
  }
  const matches = doc.blocks.filter((candidate) => candidate.id === blockId);
  const block = matches[0];
  if (
    matches.length !== 1 || !block.editable || block.origin !== "authored" ||
    !["paragraph", "code", "math"].includes(block.kind) || !block.slideId
  ) {
    fail(
      "unsafe-element-delete",
      "Only one verified authored paragraph, displayed code or display equation can be deleted; headings and computed producers require explicit QMD authoring.",
    );
  }
  let unit = block;
  if (block.parentId) {
    const parents = doc.blocks.filter((candidate) =>
      candidate.id === block.parentId
    );
    const parent = parents[0];
    if (
      parents.length !== 1 || parent.kind !== "div" || !parent.stable ||
      parent.parentId
    ) {
      fail(
        "unsafe-element-delete",
        "The element is nested inside an ambiguous or shared source container.",
      );
    }
    pureWrapper(doc, parent, block);
    unit = parent;
  } else if (!block.stable) {
    fail(
      "unsafe-element-delete",
      "Pin this standalone source element and recalculate before deleting it.",
    );
  }
  const span = withMarker(doc, unit);
  const removed = doc.blocks.filter((candidate) =>
    candidate.span.start >= unit.span.start &&
    candidate.span.end <= unit.span.end
  );
  if (removed.some((candidate) => candidate.origin !== "authored")) {
    fail(
      "unsafe-element-delete",
      "Deletion would remove a computed or shared producer.",
    );
  }
  const rest = sliceBytes(doc.text, { start: 0, end: span.start }) +
    sliceBytes(doc.text, { start: span.end, end: doc.byteLength });
  assertDeletionReferences(
    rest,
    removed.flatMap((candidate) =>
      candidate.explicitId ? [candidate.explicitId] : []
    ),
  );
  return {
    blockId,
    removedIds: removed.map((candidate) => candidate.id),
    span,
    expected: sliceBytes(doc.text, span),
    replacement: "",
  };
}
/** Removing a unit must leave all other semantic boundaries, identities and bytes intact. */
export function verifySourceDeletion(
  before: SourceDocument,
  after: SourceDocument,
  blockId: string,
): void {
  const removed = new Set(sourceDeletion(before, blockId).removedIds);
  const shape = (blocks: SourceBlock[]) =>
    blocks.map((block) => [
      block.id,
      block.explicitId,
      block.kind,
      block.raw,
      block.content,
      block.origin,
      block.editable,
      block.parentId,
      block.slideId,
      block.level,
    ]);
  if (
    after.diagnostics.length ||
    JSON.stringify(
        shape(before.blocks.filter((block) => !removed.has(block.id))),
      ) !== JSON.stringify(shape(after.blocks)) ||
    JSON.stringify(before.slides.map((slide) => [slide.id, slide.stable])) !==
      JSON.stringify(after.slides.map((slide) => [slide.id, slide.stable]))
  ) {
    fail(
      "unsafe-element-delete",
      "Deletion would change another source boundary or identity. Pin the remaining blocks or repair the surrounding QMD and recalculate before retrying.",
    );
  }
}
