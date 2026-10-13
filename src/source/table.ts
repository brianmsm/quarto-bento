import { originalAttributeTokens } from "./attributes.ts";
/** Independent proof for the supported literal original-QMD pipe-table subset. */
import { escapeHtml } from "../render/html.ts";
import type { PlainTable, TableAlign } from "../render/table.ts";
import type { Element, Json } from "../render/types.ts";
import {
  hashSource,
  scanSource,
  type SourceBlock,
  type SourceDocument,
} from "./mod.ts";
function fail(message: string): never {
  throw new Error(`UNMAPPED_TABLE_SOURCE: ${message}`);
}
function bodyBlocks(doc: SourceDocument, block: SourceBlock) {
  return doc.blocks.filter((b) =>
    b !== block && b.span.start >= block.contentSpan.start &&
    b.span.end <= block.contentSpan.end
  );
}
/** Pipes must have explicit outside delimiters; escaped punctuation remains literal. */
function cells(line: string): string[] {
  let trailingSlashes = 0;
  for (let i = line.length - 2; i >= 0 && line[i] === "\\"; i--) {
    trailingSlashes++;
  }
  if (!line.startsWith("|") || !line.endsWith("|") || trailingSlashes % 2) {
    fail("Use explicit outer pipes for every row.");
  }
  const result: string[] = [];
  let cell = "";
  for (let i = 1; i < line.length - 1; i++) {
    const char = line[i];
    if (
      char === "\\" &&
      /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(line[i + 1] ?? "")
    ) {
      cell += char + line[++i];
    } else if (char === "|") {
      result.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  result.push(cell.trim());
  return result;
}
export function parsePipeTable(content: string): PlainTable {
  const lines = content.replace(/\r\n|\r/g, "\n").replace(/^\n+|\n+$/g, "")
    .split("\n");
  if (
    lines.length < 2 || lines.some((line) => !line.trim() || /^\s/.test(line))
  ) fail("Use one contiguous, unindented pipe table.");
  const header = cells(lines[0]), separator = cells(lines[1]);
  if (
    header.length !== separator.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    fail(
      "The second row must declare one Markdown column separator per header.",
    );
  }
  const columns = separator.map((
    cell,
  ): { width: number; align: TableAlign } => ({
    width: 1,
    align: cell.endsWith(":")
      ? cell.startsWith(":") ? "center" : "right"
      : "left",
  }));
  const rows = [header, ...lines.slice(2).map(cells)].map((row) => {
    if (row.length !== columns.length) fail("Source table is not rectangular.");
    return row.map((cell, index) => ({
      text: cell.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1"),
      align: columns[index].align,
    }));
  });
  return { header: true, columns, rows };
}
export function authoredTableBlock(
  doc: SourceDocument,
  wrapperId: string,
): SourceBlock {
  if (doc.diagnostics.length) {
    fail("Resolve source mapping diagnostics before rendering tables.");
  }
  const wrappers = doc.blocks.filter((b) =>
    b.id === wrapperId && b.kind === "div" && b.stable && b.explicitId
  );
  if (wrappers.length !== 1) {
    fail("An authored table needs a unique identified fenced-div wrapper.");
  }
  const wrapper = wrappers[0], blocks = bodyBlocks(doc, wrapper);
  if (
    blocks.length !== 1 || blocks[0].kind !== "unsupported" ||
    blocks[0].parentId !== wrapper.id || blocks[0].origin !== "authored"
  ) {
    fail(
      "The identified wrapper must contain exactly one literal pipe table and no computed or other content.",
    );
  }
  parsePipeTable(blocks[0].content);
  return blocks[0];
}
/** A native identity binding must be explicit in the original table wrapper. */
export function tableNativeIdentity(
  doc: SourceDocument,
  wrapperId: string,
): string | undefined {
  const original = scanSource(doc.text);
  authoredTableBlock(original, wrapperId);
  const wrapper = original.blocks.find((block) => block.id === wrapperId)!;
  const content = /^ {0,3}:{3,}\s*\{([^{}]*)\}\s*$/.exec(
    wrapper.raw.split(/\r?\n/)[0],
  )?.[1];
  if (content === undefined) {
    fail("Table wrapper requires original literal attributes.");
  }
  const attributes = originalAttributeTokens(content).filter((token) =>
    token.key === "bento-element-id"
  );
  if (attributes.length > 1) {
    fail("Table wrapper has ambiguous native identities.");
  }
  return attributes[0]?.value;
}
/** Exact semantic fields, independent of native geometry and table styling. */
export function literalTableContent(content: string): Record<string, Json> {
  const table = parsePipeTable(content);
  return {
    header: table.header,
    columns: table.columns.map((column) => ({ w: column.width })),
    rows: table.rows.map((row) => ({
      cells: row.map((cell) => ({
        html: escapeHtml(cell.text),
        align: cell.align,
      })),
    })),
  };
}
export function tableContent(element: Element): Record<string, Json> {
  return {
    header: element.header,
    columns: element.columns,
    rows: element.rows,
  };
}
/** Only the original source bytes may establish a literal table fragment. */
export function literalTableBlock(
  doc: SourceDocument,
  blockId: string,
): SourceBlock {
  if (doc.hash !== hashSource(doc.text)) {
    fail("Original table source snapshot is stale.");
  }
  const original = scanSource(doc.text),
    candidates = original.blocks.filter((b) => b.id === blockId);
  if (
    original.diagnostics.length || candidates.length !== 1 ||
    candidates[0].kind !== "unsupported" || candidates[0].origin !== "authored"
  ) {
    fail("Table has no unique literal original source fragment.");
  }
  const block = candidates[0].parentId
    ? authoredTableBlock(original, candidates[0].parentId)
    : candidates[0];
  if (block.id !== blockId) {
    fail("Original table fragment does not match its container.");
  }
  parsePipeTable(block.content);
  return block;
}
export function validateAuthoredTable(
  doc: SourceDocument,
  blockId: string,
  element: Element,
): SourceBlock {
  const block = literalTableBlock(doc, blockId);
  if (
    element.type !== "table" ||
    JSON.stringify(tableContent(element)) !==
      JSON.stringify(literalTableContent(block.content))
  ) {
    fail(
      "Executed table cells, header or alignment differ from the exact literal source proof.",
    );
  }
  return block;
}
/** Recognize only complete literal top-level tables, never arbitrary unsupported blocks. */
export function bareTableBlocks(doc: SourceDocument): SourceBlock[] {
  if (doc.hash !== hashSource(doc.text)) {
    fail("Original table source snapshot is stale.");
  }
  const original = scanSource(doc.text);
  if (original.diagnostics.length) {
    fail("Resolve source mapping diagnostics before binding a bare table.");
  }
  return original.blocks.filter((block) => {
    if (
      block.kind !== "unsupported" || block.parentId ||
      block.origin !== "authored"
    ) return false;
    try {
      parsePipeTable(block.content);
      return true;
    } catch {
      return false;
    }
  });
}
/** Coverage also applies after an approved wrapper makes a formerly bare table stable. */
export function literalTableBlocks(doc: SourceDocument): SourceBlock[] {
  if (doc.hash !== hashSource(doc.text)) {
    fail("Original table source snapshot is stale.");
  }
  const original = scanSource(doc.text);
  if (original.diagnostics.length) {
    fail("Resolve source mapping diagnostics before table coverage checks.");
  }
  return original.blocks.filter((block) => {
    if (block.kind !== "unsupported" || block.origin !== "authored") {
      return false;
    }
    try {
      literalTableBlock(original, block.id);
      return true;
    } catch {
      return false;
    }
  });
}
/** Bare tables without IDs require a unique exact whole-table source match. */
export function matchBareTable(
  doc: SourceDocument,
  element: Element,
): SourceBlock {
  if (doc.hash !== hashSource(doc.text)) {
    fail("Original table source snapshot is stale.");
  }
  const original = scanSource(doc.text);
  if (original.diagnostics.length) {
    fail("Resolve source mapping diagnostics before binding a bare table.");
  }
  const matches = bareTableBlocks(original).filter((block) => {
    try {
      return JSON.stringify(literalTableContent(block.content)) ===
        JSON.stringify(tableContent(element));
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    fail(
      "A bare table needs one exact original literal table; duplicate or transformed tables require explicit source wrappers.",
    );
  }
  return matches[0];
}
export function tableProducer(
  doc: SourceDocument,
  contextId: string,
): SourceBlock {
  const original = scanSource(doc.text);
  if (original.diagnostics.length) {
    fail("Resolve source mapping diagnostics before binding a computed table.");
  }
  const contexts = original.blocks.filter((b) => b.id === contextId);
  if (contexts.length !== 1) {
    fail(
      "Computed table does not identify one original producer or container.",
    );
  }
  const context = contexts[0];
  if (context.kind === "chunk" && context.stable) return context;
  if (context.kind === "div" && context.stable) {
    const children = bodyBlocks(original, context);
    if (
      children.length === 1 && children[0].kind === "chunk" &&
      children[0].stable
    ) return children[0];
  }
  return fail(
    "Wrap a single explicitly labelled producer chunk in an identified div; a table cannot guess which original computation produced it.",
  );
}
