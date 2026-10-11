import {
  hashSource,
  scanSource,
  type SourceDocument,
  SourceError,
  type SourcePatch,
} from "./mod.ts";
import {
  nativeDesignField,
  type PandocAttr,
  parseDesignAttributes,
  validateDesignValue,
} from "../render/design.ts";

export interface AttributeRequest {
  blockId: string;
  attribute: string;
  value: string | number | null;
  expected?: string;
}
export interface AttributePreview {
  version: 1;
  kind: "visual-attributes";
  sourceHash: string;
  requests: AttributeRequest[];
  patches: SourcePatch[];
  result: string;
  resultHash: string;
}
interface Token {
  start: number;
  end: number;
  key?: string;
  value?: string;
  valueStart?: number;
  valueEnd?: number;
  quote?: string;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
/** Token offsets are local UTF-16; converted to UTF-8 only at the patch boundary. */
function tokens(content: string): Token[] {
  const result: Token[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    if (/\s/.test(content[cursor])) {
      cursor++;
      continue;
    }
    const start = cursor;
    if (content[cursor] === "#" || content[cursor] === ".") {
      cursor++;
      while (cursor < content.length && !/\s/.test(content[cursor])) cursor++;
      if (
        !/^[#.][\p{L}_][\p{L}\p{N}_.:-]*$/u.test(content.slice(start, cursor))
      ) {
        throw new SourceError(
          "unsupported-attributes",
          "Malformed class/id token.",
        );
      }
      result.push({ start, end: cursor });
      continue;
    }
    while (cursor < content.length && /[A-Za-z0-9_-]/.test(content[cursor])) {
      cursor++;
    }
    const key = content.slice(start, cursor);
    if (!key || content[cursor] !== "=") {
      throw new SourceError(
        "unsupported-attributes",
        "Expected a key=value attribute without spaces around '='.",
      );
    }
    cursor++;
    const quote = ["'", '"'].includes(content[cursor])
      ? content[cursor++]
      : undefined;
    const valueStart = cursor;
    if (quote) {
      while (cursor < content.length && content[cursor] !== quote) {
        if (content[cursor] === "\\") {
          throw new SourceError(
            "unsupported-attributes",
            "Escaped attribute syntax needs explicit mapping.",
          );
        }
        cursor++;
      }
      if (cursor === content.length) {
        throw new SourceError(
          "unsupported-attributes",
          "Unclosed quoted value.",
        );
      }
    } else {while (cursor < content.length && !/\s/.test(content[cursor])) {
        cursor++;
      }}
    const valueEnd = cursor, value = content.slice(valueStart, valueEnd);
    if (!value || /[{}\r\n]/.test(value)) {
      throw new SourceError(
        "unsupported-attributes",
        "Empty or nested attribute syntax.",
      );
    }
    if (quote) cursor++;
    if (cursor < content.length && !/\s/.test(content[cursor])) {
      throw new SourceError(
        "unsupported-attributes",
        "Attribute tokens require whitespace separation.",
      );
    }
    result.push({
      start,
      end: cursor,
      key,
      value,
      valueStart,
      valueEnd,
      quote,
    });
  }
  return result;
}
function asAttr(content: string, parsed: Token[]): PandocAttr {
  let id = "";
  const classes: string[] = [], attributes: [string, string][] = [];
  for (const token of parsed) {
    if (token.key) attributes.push([token.key, token.value!]);
    else {
      const value = content.slice(token.start, token.end);
      if (value[0] === "#") {
        if (id) {
          throw new SourceError("unsupported-attributes", "Multiple IDs.");
        }
        id = value.slice(1);
      } else classes.push(value.slice(1));
    }
  }
  return [id, classes, attributes];
}
/** Read exact original values only from supported, stable source declarations. */
export function sourceDesignAttribute(
  doc: SourceDocument,
  blockId: string,
  attribute: string,
): string {
  const blocks = doc.blocks.filter((b) => b.id === blockId);
  if (
    blocks.length !== 1 || !blocks[0].stable ||
    !["heading", "div", "code"].includes(blocks[0].kind)
  ) {
    throw new SourceError(
      "unmapped",
      "Visual attributes need an identified source declaration.",
    );
  }
  const line = blocks[0].raw.split(/\r?\n/)[0];
  const content = /\{([^{}]*)\}[ \t]*$/.exec(line)?.[1];
  if (content === undefined) {
    throw new SourceError("unmapped", "Missing original attribute block.");
  }
  const parsed = tokens(content), attr = asAttr(content, parsed);
  parseDesignAttributes(attr);
  const values = attr[2].filter(([key]) => key === attribute);
  if (values.length !== 1 || !nativeDesignField(attribute)) {
    throw new SourceError(
      "unmapped",
      "Missing or ambiguous original visual attribute.",
    );
  }
  return values[0][1];
}
function splice(text: string, patches: SourcePatch[]): string {
  let bytes = encoder.encode(text);
  for (
    const patch of [...patches].sort((a, b) => b.span.start - a.span.start)
  ) {
    const expected = decoder.decode(
      bytes.slice(patch.span.start, patch.span.end),
    );
    if (expected !== patch.expected) {
      throw new SourceError(
        "stale-fragment",
        patch.blockId,
      );
    }
    const replacement = encoder.encode(patch.replacement),
      next = new Uint8Array(
        bytes.length - (patch.span.end - patch.span.start) + replacement.length,
      );
    next.set(bytes.slice(0, patch.span.start));
    next.set(replacement, patch.span.start);
    next.set(
      bytes.slice(patch.span.end),
      patch.span.start + replacement.length,
    );
    bytes = next;
  }
  return decoder.decode(bytes);
}
/** Review-only bounded patches to explicit visual keys in heading/div/code openers. */
export function previewAttributePatches(
  document: SourceDocument,
  requests: AttributeRequest[],
): AttributePreview {
  if (hashSource(document.text) !== document.hash) {
    throw new SourceError("stale-document", "Source snapshot changed.");
  }
  const fresh = scanSource(document.text), patches: SourcePatch[] = [];
  if (fresh.diagnostics.length) {
    throw new SourceError(
      "invalid-source-structure",
      "Resolve scanner diagnostics before patching attributes.",
    );
  }
  const grouped = new Map<string, AttributeRequest[]>();
  for (const request of requests) {
    if (!nativeDesignField(request.attribute)) {
      throw new SourceError(
        "unsupported-attribute",
        "Only implemented visual fields are patchable.",
      );
    }
    if (request.value !== null) {
      validateDesignValue(request.attribute, request.value);
    }
    grouped.set(request.blockId, [
      ...(grouped.get(request.blockId) ?? []),
      request,
    ]);
  }
  for (const [id, edits] of grouped) {
    const matches = fresh.blocks.filter((b) => b.id === id);
    if (matches.length !== 1 || !matches[0].stable) {
      throw new SourceError(
        "unmapped",
        "Pin a unique source identity before editing visual attributes.",
      );
    }
    const block = matches[0];
    if (!["heading", "div", "code"].includes(block.kind)) {
      throw new SourceError(
        "unsupported-attribute-target",
        "Use attributes on an identified heading/div/displayed code; computation options are not visual attributes.",
      );
    }
    const line = block.raw.split(/\r?\n/)[0];
    const match = /\{([^{}]*)\}[ \t]*$/.exec(line);
    if (!match) {
      throw new SourceError(
        "unmapped",
        "An existing explicit attribute block is required; source syntax was not guessed.",
      );
    }
    const content = match[1],
      parsed = tokens(content),
      attr = asAttr(content, parsed);
    parseDesignAttributes(attr); // also rejects ambiguous aliases and malformed declarations
    const attrsStart = match.index + 1, seen = new Set<string>();
    const local: {
      start: number;
      end: number;
      expected: string;
      replacement: string;
    }[] = [];
    for (const edit of edits) {
      const native = nativeDesignField(edit.attribute)!;
      if (seen.has(native)) {
        throw new SourceError(
          "overlapping-patches",
          "Repeated or aliased attribute requests.",
        );
      }
      seen.add(native);
      const entries = parsed.filter((t) => t.key === edit.attribute);
      if (entries.length > 1) {
        throw new SourceError("unmapped", "Duplicate attribute key.");
      }
      const token = entries[0];
      if (edit.expected !== undefined && token?.value !== edit.expected) {
        throw new SourceError("stale-fragment", `${id}:${edit.attribute}`);
      }
      if (edit.value === null) {
        if (!token) {
          throw new SourceError(
            "unmapped",
            "Cannot remove an absent attribute.",
          );
        }
        local.push({
          start: token.start,
          end: token.end,
          expected: content.slice(token.start, token.end),
          replacement: "",
        });
      } else if (token) {
        const value = String(edit.value);
        // Preserve original quotes when possible. Unquoted values that need spaces
        // are quoted as one token rather than introducing new attributes.
        if (!token.quote && /\s/.test(value)) {
          local.push({
            start: token.valueStart!,
            end: token.valueEnd!,
            expected: token.value!,
            replacement: `"${value}"`,
          });
        } else {local.push({
            start: token.valueStart!,
            end: token.valueEnd!,
            expected: token.value!,
            replacement: value,
          });}
      } else {local.push({
          start: content.length,
          end: content.length,
          expected: "",
          replacement: ` ${edit.attribute}="${String(edit.value)}"`,
        });}
    }
    // Coalesce insertions at the same closing brace while keeping other fields surgical.
    const insertions = local.filter((p) => p.start === p.end);
    const changes = local.filter((p) => p.start !== p.end);
    if (insertions.length) {
      changes.push({
        ...insertions[0],
        replacement: insertions.map((p) => p.replacement).join(""),
      });
    }
    for (const change of changes) {
      const start = block.span.start +
        encoder.encode(line.slice(0, attrsStart + change.start)).length;
      const end = block.span.start +
        encoder.encode(line.slice(0, attrsStart + change.end)).length;
      patches.push({
        blockId: id,
        span: { start, end },
        expected: change.expected,
        replacement: change.replacement,
      });
    }
  }
  patches.sort((a, b) => a.span.start - b.span.start);
  for (let i = 1; i < patches.length; i++) {
    if (patches[i].span.start < patches[i - 1].span.end) {
      throw new SourceError("overlapping-patches", "Attribute ranges overlap.");
    }
  }
  const result = splice(fresh.text, patches), rescanned = scanSource(result);
  const shape = (d: SourceDocument) =>
    d.blocks.map((b) => [b.kind, b.explicitId, b.level, b.origin, b.content]);
  // Div raw content includes nested opener attributes, so compare semantic children
  // and identities, not the div's aggregate text.
  const normalize = (d: SourceDocument) =>
    shape(d).map((row) => row[0] === "div" ? [...row.slice(0, 4)] : row);
  if (
    JSON.stringify(normalize(fresh)) !== JSON.stringify(normalize(rescanned))
  ) {
    throw new SourceError(
      "structural-replacement",
      "Attribute edit changed semantics/identity.",
    );
  }
  for (const id of grouped.keys()) {
    const opener = rescanned.blocks.find((b) =>
      b.id === id
    )!.raw.split(/\r?\n/)[0];
    const content = /\{([^{}]*)\}[ \t]*$/.exec(opener)?.[1];
    if (content === undefined) {
      throw new SourceError(
        "invalid-preview",
        "Attribute block disappeared.",
      );
    }
    parseDesignAttributes(asAttr(content, tokens(content)));
  }
  return {
    version: 1,
    kind: "visual-attributes",
    sourceHash: fresh.hash,
    requests: structuredClone(requests),
    patches,
    result,
    resultHash: hashSource(result),
  };
}
/** Apply only a regenerated, exactly matching preview to the unchanged source bytes. */
export function applyAttributePatches(
  current: string,
  preview: AttributePreview,
): string {
  if (
    preview.version !== 1 || preview.kind !== "visual-attributes" ||
    hashSource(current) !== preview.sourceHash
  ) throw new SourceError("stale-source", "Review a new attribute diff.");
  const verified = previewAttributePatches(
    scanSource(current),
    preview.requests,
  );
  if (JSON.stringify(verified) !== JSON.stringify(preview)) {
    throw new SourceError(
      "invalid-preview",
      "Attribute preview was changed after review.",
    );
  }
  return verified.result;
}

/** Shared bounded original-source attribute syntax, with token offsets retained. */
export {
  asAttr as originalPandocAttributes,
  tokens as originalAttributeTokens,
};
