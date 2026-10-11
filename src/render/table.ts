/** Faithful rectangular plain-text subset of Pandoc tables -> pinned native Bento tables. */
import { escapeHtml } from "./html.ts";
import type { Element, Node } from "./types.ts";
export const TABLE_CODEC_VERSION = 1;
export type TableAlign = "left" | "center" | "right";
export interface PlainTable {
  header: boolean;
  columns: { width: number; align: TableAlign }[];
  rows: { text: string; align: TableAlign }[][];
}
function fail(message: string): never {
  throw new Error(`UNSUPPORTED_TABLE: ${message}`);
}
function array(value: unknown, length?: number): unknown[] {
  if (
    !Array.isArray(value) || length !== undefined && value.length !== length
  ) {
    fail("Malformed table structure.");
  }
  return value;
}
function attr(value: unknown, allowed: string[] = []) {
  const [id, classes, pairs] = array(value, 3);
  if (
    id !== "" ||
    array(classes).some((c) => typeof c !== "string" || !allowed.includes(c)) ||
    array(pairs).length
  ) {
    fail("Cell, row and table attributes need an explicit supported mapping.");
  }
}
function alignment(value: unknown, fallback: TableAlign = "left"): TableAlign {
  const name = (value as Node)?.t;
  if (name === "AlignDefault") return fallback;
  if (name === "AlignLeft") return "left";
  if (name === "AlignCenter") return "center";
  if (name === "AlignRight") return "right";
  return fail("Unknown column/cell alignment.");
}
function cellText(value: unknown): string {
  const blocks = array(value);
  if (!blocks.length) return "";
  if (blocks.length !== 1) {
    fail("Multiple paragraphs in a cell are not supported.");
  }
  const block = blocks[0] as Node;
  if (!block || !["Plain", "Para"].includes(block.t)) {
    fail("Cells must contain one plain-text paragraph.");
  }
  return array(block.c).map((value) => {
    const node = value as Node;
    if (node.t === "Str" && typeof node.c === "string") return node.c;
    if (node.t === "Space") return " ";
    return fail(
      `Cell content ${node.t} needs a faithful rich-content adapter; no content was flattened.`,
    );
  }).join("");
}
export function plainTable(node: Node): PlainTable {
  if (node.t !== "Table") fail("Expected a Pandoc Table node.");
  const [attributes, caption, specs, head, bodies, foot] = array(node.c, 6);
  attr(attributes, ["caption-top"]);
  const [shortCaption, longCaption] = array(caption, 2);
  if (shortCaption !== null || array(longCaption).length) {
    fail("Captions need a supported semantic/visual mapping.");
  }
  const columns = array(specs).map((value) => {
    const [align, widthValue] = array(value, 2), width = widthValue as Node;
    if (!width || !["ColWidthDefault", "ColWidth"].includes(width.t)) {
      fail("Unknown column width.");
    }
    const w = width.t === "ColWidthDefault" ? 1 : width.c;
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
      fail("Column widths must be finite positive weights.");
    }
    return { width: w, align: alignment(align) };
  });
  if (!columns.length || columns.length > 200) {
    fail("Use between 1 and 200 columns.");
  }
  const widthKinds = new Set(
    array(specs).map((value) => (array(value, 2)[1] as Node).t),
  );
  if (widthKinds.size > 1) {
    fail(
      "Mixed automatic and explicit widths need an explicit layout decision.",
    );
  }
  const [headAttr, headRows] = array(head, 2);
  const [footAttr, footRows] = array(foot, 2);
  attr(headAttr);
  attr(footAttr);
  if (array(headRows).length > 1 || array(footRows).length) {
    fail("Multiple header rows and table footers are not supported.");
  }
  if (array(bodies).length !== 1) {
    fail("Multiple table bodies are not supported.");
  }
  const [bodyAttr, rowHeads, intermediateHeads, bodyRows] = array(
    array(bodies)[0],
    4,
  );
  attr(bodyAttr);
  if (rowHeads !== 0 || array(intermediateHeads).length) {
    fail("Row headers and intermediate header sections are not supported.");
  }
  const rows = [...array(headRows), ...array(bodyRows)].map((value) => {
    const [rowAttr, cells] = array(value, 2);
    attr(rowAttr, ["header", "odd", "even"]);
    if (array(cells).length !== columns.length) {
      fail("Rows must be rectangular with one cell per column.");
    }
    return array(cells).map((value, index) => {
      const [cellAttr, align, rowSpan, colSpan, content] = array(value, 5);
      attr(cellAttr);
      if (rowSpan !== 1 || colSpan !== 1) {
        fail("Merged cells and row/column spans are not supported.");
      }
      return {
        text: cellText(content),
        align: alignment(align, columns[index].align),
      };
    });
  });
  if (!rows.length || rows.length > 2000) fail("Use between 1 and 2000 rows.");
  return { header: array(headRows).length === 1, columns, rows };
}
export function projectTable(node: Node, id: string, y = 166): Element {
  const table = plainTable(node);
  const fontSize = 18, cellPadX = 16, cellPadY = 11, borderWidth = 1;
  // Match native line-height/padding/border before adding a small rounding margin.
  // A conservative single-line width gate avoids claiming unmeasured wrapping.
  const width = 1120,
    totalWeight = table.columns.reduce((sum, column) => sum + column.width, 0);
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      const usableWidth =
        width * table.columns[columnIndex].width / totalWeight - cellPadX * 2 -
        borderWidth * 2;
      if (
        usableWidth <= 0 ||
        Array.from(cell.text).length * fontSize * 2 > usableWidth
      ) {
        throw new Error(
          `UNSUPPORTED_TABLE_LAYOUT: row ${rowIndex + 1}, column ${
            columnIndex + 1
          } exceeds the conservative single-line width limit; shorten or split the source table. Wrapped table-cell layout needs separate measured support.`,
        );
      }
    }
  }
  const rowHeight = Math.ceil(fontSize * 1.3 + cellPadY * 2 + borderWidth * 2) +
    8;
  const height = Math.max(100, table.rows.length * rowHeight);
  if (y < 0 || y + height > 720) {
    throw new Error(
      "UNSUPPORTED_TABLE_LAYOUT: the complete table does not fit in the remaining slide area; split it into smaller source tables rather than clipping rows.",
    );
  }
  return {
    id,
    type: "table",
    x: 80,
    y,
    w: width,
    h: height,
    rotation: 0,
    opacity: 1,
    header: table.header,
    columns: table.columns.map((column) => ({ w: column.width })),
    rows: table.rows.map((row) => ({
      cells: row.map((cell) => ({
        html: escapeHtml(cell.text),
        align: cell.align,
      })),
    })),
    style: {
      headerBg: "#1E2A3A",
      headerColor: "#FFFFFF",
      zebra: "rgba(30,42,58,0.05)",
      borderColor: "rgba(30,42,58,0.14)",
      borderWidth,
      cellPadX,
      cellPadY,
      fontSize,
      color: "#1E2A3A",
      radius: 10,
    },
  };
}
