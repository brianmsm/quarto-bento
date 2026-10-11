/** Conservative original-QMD mapping. All spans are UTF-8 bytes, end-exclusive. */
import { isSourceIdentity } from "./identity-id.ts";

export interface Span {
  start: number;
  end: number;
}
export type BlockKind =
  | "heading"
  | "paragraph"
  | "div"
  | "code"
  | "chunk"
  | "math"
  | "unsupported";
export interface SourceBlock {
  id: string;
  explicitId?: string;
  stable: boolean;
  kind: BlockKind;
  span: Span;
  contentSpan: Span;
  raw: string;
  content: string;
  origin: "authored" | "computed";
  editable: boolean;
  reason?: string;
  level?: number;
  parentId?: string;
  slideId?: string;
}
export interface SourceSlide {
  id: string;
  stable: boolean;
  span: Span;
  headingId: string;
  blockIds: string[];
}
export interface SourceDiagnostic {
  code: string;
  message: string;
  span?: Span;
}
export interface SourceDocument {
  text: string;
  hash: string;
  byteLength: number;
  newline: "\n" | "\r\n";
  blocks: SourceBlock[];
  slides: SourceSlide[];
  diagnostics: SourceDiagnostic[];
  preambleSpan: Span;
}
export interface PatchRequest {
  blockId: string;
  replacement: string;
  expected?: string;
}
export interface SourcePatch {
  blockId: string;
  span: Span;
  expected: string;
  replacement: string;
}
export interface PatchPreview {
  version: 1;
  sourceHash: string;
  patches: SourcePatch[];
  resultHash: string;
  result: string;
}
export class SourceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "SourceError";
  }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
/** Dependency-free SHA-256 keeps synchronous scans fully offline. */
export function hashSource(text: string): string {
  const k = [
    0x428a2f98,
    0x71374491,
    0xb5c0fbcf,
    0xe9b5dba5,
    0x3956c25b,
    0x59f111f1,
    0x923f82a4,
    0xab1c5ed5,
    0xd807aa98,
    0x12835b01,
    0x243185be,
    0x550c7dc3,
    0x72be5d74,
    0x80deb1fe,
    0x9bdc06a7,
    0xc19bf174,
    0xe49b69c1,
    0xefbe4786,
    0x0fc19dc6,
    0x240ca1cc,
    0x2de92c6f,
    0x4a7484aa,
    0x5cb0a9dc,
    0x76f988da,
    0x983e5152,
    0xa831c66d,
    0xb00327c8,
    0xbf597fc7,
    0xc6e00bf3,
    0xd5a79147,
    0x06ca6351,
    0x14292967,
    0x27b70a85,
    0x2e1b2138,
    0x4d2c6dfc,
    0x53380d13,
    0x650a7354,
    0x766a0abb,
    0x81c2c92e,
    0x92722c85,
    0xa2bfe8a1,
    0xa81a664b,
    0xc24b8b70,
    0xc76c51a3,
    0xd192e819,
    0xd6990624,
    0xf40e3585,
    0x106aa070,
    0x19a4c116,
    0x1e376c08,
    0x2748774c,
    0x34b0bcb5,
    0x391c0cb3,
    0x4ed8aa4a,
    0x5b9cca4f,
    0x682e6ff3,
    0x748f82ee,
    0x78a5636f,
    0x84c87814,
    0x8cc70208,
    0x90befffa,
    0xa4506ceb,
    0xbef9a3f7,
    0xc67178f2,
  ];
  const h = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const input = encoder.encode(text),
    bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input);
  bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(bytes.length - 4, (input.length * 8) >>> 0);
  const r = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      w[i] =
        (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) +
          w[i - 7] +
          (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, v] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (v + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + k[i] +
          w[i]) >>> 0;
      const t2 =
        ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      v = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    for (const [i, value] of [a, b, c, d, e, f, g, v].entries()) {
      h[i] = (h[i] + value) >>> 0;
    }
  }
  return h.map((n) => n.toString(16).padStart(8, "0")).join("");
}
export const sliceBytes = (text: string, span: Span): string =>
  decoder.decode(encoder.encode(text).slice(span.start, span.end));
interface Line {
  text: string;
  start: number;
  end: number;
  fullEnd: number;
}
function linesOf(text: string): Line[] {
  let offset = 0;
  return (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean).map(
    (raw) => {
      const body = raw.replace(/(?:\r\n|\n|\r)$/, "");
      const line = {
        text: body,
        start: offset,
        end: offset + encoder.encode(body).length,
        fullEnd: offset + encoder.encode(raw).length,
      };
      offset = line.fullEnd;
      return line;
    },
  );
}
const explicitId = (text: string): string | undefined => {
  const attributes = text.trim().replace(/^\{/, "").replace(/\}$/, "");
  const tokens = attributes.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.find((token) =>
    token[0] === "#" && isSourceIdentity(token.slice(1))
  )?.slice(1);
};
const dynamic = (text: string): boolean =>
  /`+(?:\{(?:r|python|julia|ojs)\}|(?:r|python|julia|ojs)\s)/i.test(text) ||
  /\{\{[<%]/.test(text);
const unsupported = (text: string): boolean =>
  /^(?: {4}|\t|\s*(?:>|[-+*]\s|\d+[.)]\s|\|)|\s*<(?!!--)|\s*\[[^\]]+\]:|\s*[-=]{3,}\s*$)/
    .test(text) || /\|/.test(text);

/** Scans the original source, never a post-execution Markdown representation. */
export function scanSource(
  text: string,
  options: { slideLevel?: number } = {},
): SourceDocument {
  if (
    text.includes("\u0000") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
      .test(text)
  ) {
    throw new SourceError(
      "invalid-source",
      "Source must be valid Unicode text without NUL bytes.",
    );
  }
  const lines = linesOf(text),
    blocks: SourceBlock[] = [],
    diagnostics: SourceDiagnostic[] = [];
  const doc: SourceDocument = {
    text,
    hash: hashSource(text),
    byteLength: encoder.encode(text).length,
    newline: text.includes("\r\n") ? "\r\n" : "\n",
    blocks,
    slides: [],
    diagnostics,
    preambleSpan: { start: 0, end: encoder.encode(text).length },
  };
  const stack: { block: SourceBlock; fence: number }[] = [];
  let marker: string | undefined;
  const add = (
    kind: BlockKind,
    first: number,
    last: number,
    contentSpan?: Span,
    id?: string,
  ): SourceBlock => {
    const span = { start: lines[first].start, end: lines[last].fullEnd };
    const inner = contentSpan ?? { start: span.start, end: lines[last].end };
    const content = sliceBytes(text, inner),
      isDynamic = kind === "chunk" || dynamic(content);
    const parentId = stack.at(-1)?.block.id;
    const ordinal =
      blocks.filter((b) => b.parentId === parentId && b.kind === kind).length +
      1;
    const block: SourceBlock = {
      id: id ?? marker ??
        (parentId ? `${parentId}/${kind}:${ordinal}` : `${kind}@${span.start}`),
      explicitId: id ?? marker,
      stable: Boolean(id ?? marker),
      kind,
      span,
      contentSpan: inner,
      raw: sliceBytes(text, span),
      content,
      origin: isDynamic ? "computed" : "authored",
      editable: !isDynamic && !["div", "unsupported"].includes(kind),
      parentId: stack.at(-1)?.block.id,
    };
    marker = undefined;
    if (isDynamic) {
      block.reason =
        "Computed content cannot be reverse-written to executable source.";
    }
    if (kind === "unsupported") {
      block.reason = "This Markdown construct has no verified reverse mapping.";
    }
    if (kind === "div") {
      block.reason =
        "Edit mapped children; replacing a complete fenced div is unsupported.";
    }
    blocks.push(block);
    return block;
  };
  let i = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, "") === "---") {
    i = 1;
    while (i < lines.length && !/^(?:---|\.\.\.)\s*$/.test(lines[i].text)) i++;
    if (i === lines.length) {
      diagnostics.push({
        code: "unclosed-frontmatter",
        message: "YAML front matter is not closed.",
      });
      return doc;
    }
    i++;
  }
  while (i < lines.length) {
    const line = lines[i], s = line.text;
    if (!s.trim()) {
      i++;
      continue;
    }
    if (/^\s*<!--/.test(s)) {
      const first = i;
      while (i < lines.length && !lines[i].text.includes("-->")) i++;
      const comment = lines.slice(first, Math.min(i + 1, lines.length)).map((
        l,
      ) => l.text).join("\n");
      marker = comment.match(/^\s*<!--\s*qb:([^\s]+)\s*-->\s*$/)?.[1];
      if (marker && !isSourceIdentity(marker)) marker = undefined;
      if (i === lines.length) {
        diagnostics.push({
          code: "unclosed-comment",
          message: "HTML comment is not closed.",
          span: { start: lines[first].start, end: doc.byteLength },
        });
      }
      i++;
      continue;
    }
    const fence = s.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const first = i, token = fence[1], info = fence[2].trim();
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^ {0,3}${token[0]}{${token.length},}\\s*$`).test(
          lines[i].text,
        )
      ) i++;
      const closed = i < lines.length, last = closed ? i : lines.length - 1;
      const body = lines.slice(first + 1, closed ? i : lines.length).map((l) =>
        l.text
      ).join("\n");
      const executable = /^\{[A-Za-z]/.test(info);
      const label =
        body.match(/^\s*#\|\s*label:\s*["']?([A-Za-z][\w:.-]*)["']?\s*$/m)
          ?.[1] ?? info.match(/^\{\w+[ ,]+([A-Za-z][\w:.-]*)(?:[, }]|$)/)?.[1];
      const block = add(
        executable ? "chunk" : /^\{=/.test(info) ? "unsupported" : "code",
        first,
        last,
        {
          start: lines[first].fullEnd,
          end: closed ? lines[i].start : doc.byteLength,
        },
        label ?? explicitId(info),
      );
      if (!closed) {
        block.editable = false;
        block.reason = "Unclosed code fence.";
        diagnostics.push({
          code: "unclosed-fence",
          message: block.reason,
          span: block.span,
        });
      }
      i++;
      continue;
    }
    const div = s.match(/^ {0,3}(:{3,})(.*)$/);
    if (div) {
      if (!div[2].trim() && stack.length) {
        const open = stack.pop()!;
        open.block.span.end = line.fullEnd;
        open.block.contentSpan.end = line.start;
        open.block.raw = sliceBytes(text, open.block.span);
        open.block.content = sliceBytes(text, open.block.contentSpan);
      } else if (div[2].trim()) {
        const block = add("div", i, i, {
          start: line.fullEnd,
          end: line.fullEnd,
        }, explicitId(div[2].replace(/^\s*\{/, "")));
        stack.push({ block, fence: div[1].length });
      } else {diagnostics.push({
          code: "unmatched-div",
          message: "Closing div fence has no opener.",
          span: { start: line.start, end: line.fullEnd },
        });}
      i++;
      continue;
    }
    const heading = s.match(/^( {0,3})(#{1,6})([ \t]+)(.*)$/);
    if (heading) {
      const tail = heading[4],
        attrs = tail.match(/\s+\{([^{}]*)\}\s*$/),
        closing = (attrs ? tail.slice(0, attrs.index) : tail).match(
          /\s+#+\s*$/,
        );
      const value = (attrs ? tail.slice(0, attrs.index) : tail).slice(
        0,
        closing?.index,
      );
      const start = line.start +
        encoder.encode(heading[1] + heading[2] + heading[3]).length;
      const block = add("heading", i, i, {
        start,
        end: start + encoder.encode(value).length,
      }, attrs ? explicitId(attrs[1]) : undefined);
      block.level = heading[2].length;
      i++;
      continue;
    }
    if (/^\s*\$\$\s*$/.test(s)) {
      const first = i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i].text)) i++;
      const closed = i < lines.length;
      const block = add("math", first, closed ? i : lines.length - 1, {
        start: lines[first].fullEnd,
        end: closed ? lines[i].start : doc.byteLength,
      });
      if (!closed) {
        block.editable = false;
        block.reason = "Unclosed display math.";
      }
      i++;
      continue;
    }
    const first = i++;
    while (
      i < lines.length && lines[i].text.trim() &&
      !/^ {0,3}(?:#{1,6}\s|`{3,}|~{3,}|:{3,}|<!--|\$\$\s*$)/.test(lines[i].text)
    ) i++;
    const raw = lines.slice(first, i).map((l) => l.text).join("\n");
    add(
      raw.split("\n").some(unsupported) || raw.includes("<!--")
        ? "unsupported"
        : "paragraph",
      first,
      i - 1,
    );
  }
  for (const { block } of stack) {
    block.span.end = doc.byteLength;
    diagnostics.push({
      code: "unclosed-div",
      message: "Fenced div is not closed.",
      span: block.span,
    });
    for (
      const child of blocks.filter((b) => b.span.start >= block.span.start)
    ) {
      child.editable = false;
      child.reason = "Contained in an unclosed div.";
    }
  }
  const counts = new Map<string, number>();
  for (const block of blocks) {
    counts.set(block.id, (counts.get(block.id) ?? 0) + 1);
  }
  for (const block of blocks) {
    if (counts.get(block.id)! > 1) {
      block.editable = false;
      block.reason = `Duplicate source identity: ${block.id}.`;
      diagnostics.push({
        code: "duplicate-id",
        message: block.reason,
        span: block.span,
      });
    }
  }
  const headings = blocks.filter((b) =>
    b.kind === "heading" && b.level === (options.slideLevel ?? 2) && !b.parentId
  );
  doc.preambleSpan.end = headings[0]?.span.start ?? doc.byteLength;
  doc.slides = headings.map((h, n) => {
    const span = {
      start: h.span.start,
      end: headings[n + 1]?.span.start ?? doc.byteLength,
    };
    const members = blocks.filter((b) =>
      b.span.start >= span.start && b.span.start < span.end
    );
    for (const block of members) block.slideId = h.id;
    return {
      id: h.id,
      stable: h.stable,
      span,
      headingId: h.id,
      blockIds: members.map((b) => b.id),
    };
  });
  return doc;
}

function findBlock(doc: SourceDocument, id: string): SourceBlock {
  const matches = doc.blocks.filter((b) => b.id === id);
  if (matches.length !== 1) {
    throw new SourceError(
      "ambiguous-source",
      `Expected exactly one source block for ${id}, found ${matches.length}.`,
    );
  }
  return matches[0];
}
function validateReplacement(block: SourceBlock, replacement: string): void {
  if (block.kind === "heading" && /[\r\n]|\s\{[^}]*\}\s*$/.test(replacement)) {
    throw new SourceError(
      "structural-replacement",
      "Heading edits must contain only heading content.",
    );
  }
  if (
    block.kind === "paragraph" &&
    (/\r?\n\s*\r?\n/.test(replacement) ||
      replacement.split(/\r?\n/).some((l) =>
        /^ {0,3}(?:#{1,6}\s|`{3,}|~{3,}|:{3,}|<!--|\$\$)/.test(l) ||
        unsupported(l)
      ))
  ) {
    throw new SourceError(
      "structural-replacement",
      "Paragraph edits must remain a single supported paragraph.",
    );
  }
  if (block.kind === "code" && /^ {0,3}(?:`{3,}|~{3,})/m.test(replacement)) {
    throw new SourceError(
      "structural-replacement",
      "Displayed-code edits cannot introduce fences.",
    );
  }
  if (block.kind === "math" && /^\s*\$\$\s*$/m.test(replacement)) {
    throw new SourceError(
      "structural-replacement",
      "Math edits cannot introduce display delimiters.",
    );
  }
  if (dynamic(replacement)) {
    throw new SourceError(
      "computed-replacement",
      "A semantic edit cannot introduce executable inline content.",
    );
  }
  if (!replacement.trim()) {
    throw new SourceError(
      "structural-replacement",
      "Deletion is a separate explicitly reviewed operation.",
    );
  }
}
/** Produces a reviewable in-memory patch; it never writes a file. */
export function previewPatches(
  doc: SourceDocument,
  requests: PatchRequest[],
): PatchPreview {
  if (hashSource(doc.text) !== doc.hash) {
    throw new SourceError(
      "stale-document",
      "Source document snapshot was modified.",
    );
  }
  // Rescan the trusted bytes so mutation of caller-owned mapping metadata cannot broaden edits.
  const fresh = scanSource(doc.text);
  const patches = requests.map((request): SourcePatch => {
    const block = findBlock(fresh, request.blockId);
    if (!block.editable) {
      throw new SourceError(
        "unmapped",
        block.reason ?? "Block is not editable.",
      );
    }
    if (request.expected !== undefined && block.content !== request.expected) {
      throw new SourceError(
        "stale-fragment",
        `Source fragment changed: ${block.id}.`,
      );
    }
    validateReplacement(block, request.replacement);
    let replacement = request.replacement.replace(/\r\n|\r|\n/g, doc.newline);
    if (
      ["code", "math"].includes(block.kind) &&
      block.content.endsWith(doc.newline) && !replacement.endsWith(doc.newline)
    ) replacement += doc.newline;
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
    ) {
      throw new SourceError(
        "overlapping-patches",
        "Patch requests overlap or repeat a block.",
      );
    }
  }
  const result = splice(doc.text, patches);
  const rescanned = scanSource(result);
  const shape = (b: SourceBlock) => [b.kind, b.explicitId, b.level, b.origin];
  if (
    JSON.stringify(fresh.blocks.map(shape)) !==
      JSON.stringify(rescanned.blocks.map(shape))
  ) {
    throw new SourceError(
      "structural-replacement",
      "A content patch changed source structure or provenance.",
    );
  }
  for (const patch of patches) {
    const index = fresh.blocks.findIndex((b) => b.id === patch.blockId);
    if (rescanned.blocks[index].content !== patch.replacement) {
      throw new SourceError(
        "structural-replacement",
        "The replacement is parsed differently from its reviewed content.",
      );
    }
  }
  return {
    version: 1,
    sourceHash: doc.hash,
    patches,
    resultHash: hashSource(result),
    result,
  };
}
function splice(text: string, patches: SourcePatch[]): string {
  let bytes = encoder.encode(text);
  for (const patch of [...patches].reverse()) {
    if (sliceBytes(text, patch.span) !== patch.expected) {
      throw new SourceError(
        "stale-fragment",
        `Source fragment changed: ${patch.blockId}.`,
      );
    }
    const replacement = encoder.encode(patch.replacement),
      joined = new Uint8Array(
        patch.span.start + replacement.length + bytes.length - patch.span.end,
      );
    joined.set(bytes.slice(0, patch.span.start));
    joined.set(replacement, patch.span.start);
    joined.set(
      bytes.slice(patch.span.end),
      patch.span.start + replacement.length,
    );
    bytes = joined;
  }
  return decoder.decode(bytes);
}
/** Apply an approved preview to exactly the reviewed current source snapshot. */
export function applyPatches(
  currentText: string,
  preview: PatchPreview,
): string {
  if (preview.version !== 1 || hashSource(currentText) !== preview.sourceHash) {
    throw new SourceError(
      "stale-source",
      "Source changed after preview; review a new diff before applying.",
    );
  }
  const verified = previewPatches(
    scanSource(currentText),
    preview.patches.map((p) => ({
      blockId: p.blockId,
      expected: p.expected,
      replacement: p.replacement,
    })),
  );
  if (
    JSON.stringify(verified.patches) !== JSON.stringify(preview.patches) ||
    verified.resultHash !== preview.resultHash ||
    verified.result !== preview.result
  ) {
    throw new SourceError(
      "invalid-preview",
      "Patch preview was altered or has inconsistent bounds.",
    );
  }
  return verified.result;
}

/** Resolve execution output only with original-source evidence; ambiguity is an error. */
export function resolveSourceMapping(
  doc: SourceDocument,
  evidence: {
    sourceHash: string;
    sourceId?: string;
    literal?: string;
    computed?: boolean;
  },
): SourceBlock {
  if (evidence.sourceHash !== doc.hash) {
    throw new SourceError(
      "stale-source",
      "Execution source snapshot differs from source map.",
    );
  }
  if (evidence.computed) {
    throw new SourceError(
      "computed-source",
      "Executed output is not reverse-editable source.",
    );
  }
  const matches = evidence.sourceId
    ? doc.blocks.filter((b) => b.id === evidence.sourceId)
    : doc.blocks.filter((b) =>
      b.content === evidence.literal &&
      ["heading", "paragraph"].includes(b.kind)
    );
  if (matches.length !== 1) {
    throw new SourceError(
      "ambiguous-source",
      "Output cannot be uniquely mapped to an original authored block.",
    );
  }
  const block = matches[0];
  if (!block.editable || block.origin === "computed") {
    throw new SourceError("unmapped", block.reason ?? "Unsupported mapping.");
  }
  if (evidence.literal !== undefined && evidence.literal !== block.content) {
    throw new SourceError(
      "transformed-source",
      "Rendered text differs from the source; a verified transform is required.",
    );
  }
  return block;
}
