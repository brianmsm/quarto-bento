/** Frame adapters for existing simple native content; never rewrite semantic fields. */
import type { BentoElement, JsonObject } from "../state/types.ts";
import { canonical } from "../state/json.ts";
import { StateError } from "../state/types.ts";
import { type ChartKind, chartOption } from "./chart.ts";
import { type PlainTable, tableHeight } from "./table.ts";
import { escapeHtml } from "./html.ts";
import type { Frame } from "./design.ts";
function unsupported(message: string): never {
  throw new StateError("UNSUPPORTED_LAYOUT_CONTENT", message);
}
function plainText(html: unknown): string {
  if (typeof html !== "string") {
    return unsupported("A table cell needs plain text.");
  }
  const text = html.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) =>
      ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" })[
        entity
      ]!,
  );
  if (escapeHtml(text) !== html) {
    unsupported("Rich table cells need their own measured adapter.");
  }
  return text;
}
/** Validate the actual saved metrics, not an assumed projection before overrides. */
export function nativeLayoutFrame(element: BentoElement, slot: Frame): Frame {
  const refs = element.themeRefs;
  if (
    refs && typeof refs === "object" && !Array.isArray(refs) &&
    Object.keys(refs).some((path) =>
      ["x", "y", "w", "h", "rotation"].includes(path) ||
      ["table", "chart"].includes(element.type) &&
        /^(?:style(?:\.|$)|font|lineHeight)/.test(path)
    )
  ) {
    return unsupported(
      "This object's frame or measured metrics derive from a theme reference. Resolve that reference explicitly before applying a layout.",
    );
  }
  if (element.rotation !== undefined && element.rotation !== 0) {
    return unsupported(
      "Reset rotation before placing this object in a column.",
    );
  }
  if (["text", "code", "image"].includes(element.type)) return { ...slot };
  if (element.type === "table") {
    const style = element.style as JsonObject;
    if (
      !style || style.fontSize !== 18 || style.cellPadX !== 16 ||
      style.cellPadY !== 11 || style.borderWidth !== 1
    ) {
      return unsupported(
        "This table has custom cell metrics; retain its design or restore the simple table metrics before applying a layout.",
      );
    }
    const columns = element.columns as JsonObject[],
      rows = element.rows as JsonObject[];
    if (
      !Array.isArray(columns) || !columns.length || !Array.isArray(rows) ||
      !rows.length
    ) return unsupported("Malformed simple table.");
    const table: PlainTable = {
      header: element.header === true,
      columns: columns.map((column) => {
        if (
          typeof column.w !== "number" || !Number.isFinite(column.w) ||
          column.w <= 0
        ) return unsupported("Invalid table column weight.");
        return { width: column.w, align: "left" };
      }),
      rows: rows.map((row) => {
        const cells = row.cells as JsonObject[];
        if (!Array.isArray(cells) || cells.length !== columns.length) {
          return unsupported("Use a rectangular simple table.");
        }
        return cells.map((cell) => ({
          text: plainText(cell.html),
          align: "left",
        }));
      }),
    };
    return { ...slot, h: tableHeight(table, slot) };
  }
  if (element.type === "chart") {
    const option = element.option as JsonObject,
      axis = option?.xAxis as JsonObject;
    const labels = axis?.data, series = option?.series as JsonObject[];
    const kind = element.preset as ChartKind;
    if (
      !Array.isArray(labels) || !Array.isArray(series) || !series.length ||
      !["bar", "line"].includes(kind)
    ) return unsupported("Use a simple bar or line chart.");
    const cell = (text: unknown) => {
      if (typeof text !== "string") {
        return unsupported("Chart labels must be plain text.");
      }
      return { text, align: "left" as const };
    };
    const table: PlainTable = {
      header: true,
      columns: Array.from(
        { length: series.length + 1 },
        () => ({ width: 1, align: "left" }),
      ),
      rows: [
        [cell(""), ...series.map((s) => cell(s.name))],
        ...labels.map((label, index) => [
          cell(label),
          ...series.map((s) => {
            const values = s.data;
            if (
              !Array.isArray(values) || values.length !== labels.length ||
              typeof values[index] !== "number"
            ) {
              return unsupported(
                "Chart data needs the simple numeric adapter.",
              );
            }
            return cell(String(values[index]));
          }),
        ]),
      ],
    };
    // This both validates final axes/legend space and prevents silently dropping
    // custom native option fields while interpreting a different chart grammar.
    if (canonical(chartOption(table, kind, slot)) !== canonical(option)) {
      return unsupported(
        "This chart has custom options; its layout needs a matching measured adapter.",
      );
    }
    return { ...slot };
  }
  return unsupported(`No reusable-layout frame adapter for ${element.type}.`);
}

/** Conservative native table/chart metrics on the final saved frame, after overlays. */
export function nativeLayoutDiagnostics(
  document: Pick<import("./types.ts").BentoDoc, "slides">,
): import("./types.ts").Diagnostic[] {
  const diagnostics: import("./types.ts").Diagnostic[] = [];
  for (const slide of document.slides) {
    for (const element of slide.elements) {
      if (!["table", "chart"].includes(element.type)) continue;
      try {
        nativeLayoutFrame(element, {
          x: Number(element.x),
          y: Number(element.y),
          w: Number(element.w),
          h: Number(element.h),
        });
      } catch (error) {
        const detail = String(error);
        const overflow = detail.includes("UNSUPPORTED_TABLE_LAYOUT") ||
          /final chart frame|Category labels exceed|Series names exceed/.test(
            detail,
          );
        diagnostics.push({
          code: overflow
            ? "NATIVE_CONTENT_OVERFLOW"
            : "NATIVE_CONTENT_UNMEASURED",
          slideId: slide.id,
          elementId: element.id,
          message: overflow
            ? `The current ${element.type} content no longer fits the saved frame under its conservative native metrics. Enlarge it or reapply a roomier layout; saved geometry was preserved. ${detail}`
            : `The saved ${element.type} uses metrics outside the simple native layout adapter; inspect it in Bento. Saved geometry was preserved. ${detail}`,
        });
      }
    }
  }
  return diagnostics;
}
