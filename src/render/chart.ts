/** Bounded chart contract for the actual pinned charts-lite renderer. */
import { type PlainTable, plainTable } from "./table.ts";
import type { Element, Json, Node } from "./types.ts";
import type { Frame } from "./design.ts";
export type ChartKind = "bar" | "line";
function fail(message: string): never {
  throw new Error(`UNSUPPORTED_CHART: ${message}`);
}
/** Never use native tableChartColumns: its parseFloat/missing->zero loses data. */
export function chartNumber(text: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    fail(
      "Values must be plain decimal numbers with at most two decimal places; missing values, percentages, exponents and locale separators need another adapter.",
    );
  }
  const value = Number(text);
  if (
    !Number.isFinite(value) || Math.abs(value) > 1e6 || Object.is(value, -0)
  ) {
    fail(
      "Values must be finite, within -1000000..1000000, and not negative zero.",
    );
  }
  return value;
}
export function chartOption(
  table: PlainTable,
  kind: ChartKind,
  frame: Pick<Frame, "w" | "h"> = { w: 1120, h: 460 },
): Record<string, Json> {
  if (kind !== "bar" && kind !== "line") fail("Choose bar or line explicitly.");
  if (!table.header || table.columns.length < 2 || table.columns.length > 5) {
    fail(
      "Use a header row, one category column and one to four numeric series.",
    );
  }
  const header = table.rows[0], body = table.rows.slice(1);
  if (header[0].text !== "") {
    fail(
      "The first column header must be empty: pinned Bento does not render a category-axis title, so a meaningful title cannot be silently dropped.",
    );
  }
  if (body.length < (kind === "line" ? 2 : 1) || body.length > 8) {
    fail("Use one to eight categories for bars, or two to eight for lines.");
  }
  const names = header.slice(1).map((cell) => cell.text);
  const labels = body.map((row) => row[0].text);
  for (const values of [names, labels]) {
    if (
      values.some((value) => !value.trim() || /[\r\n\t\p{Cc}]/u.test(value)) ||
      new Set(values).size !== values.length
    ) {
      fail(
        "Category labels and series names must be nonempty, unique plain text.",
      );
    }
  }
  const width = frame.w, fontSize = 14, plotWidth = width - 112 - 24;
  // Pinned charts-lite drops category labels below a 56px band. Six value-axis
  // ticks also need actual vertical space: never resize only an outer box.
  if (
    !Number.isFinite(width) || !Number.isFinite(frame.h) ||
    plotWidth < labels.length * 56 || frame.h < 242
  ) {
    fail(
      "The final chart frame needs at least 56px per category and 242px height for readable axes and legend.",
    );
  }
  if (
    labels.some((s) =>
      Array.from(s).length * fontSize * 2 > plotWidth / labels.length
    )
  ) {
    fail(
      "Category labels exceed the conservative single-line space; shorten the labels or use fewer categories.",
    );
  }
  if (
    names.reduce((n, s) => n + Array.from(s).length * fontSize * 2 + 40, 0) >
      width - 32
  ) {
    fail("Series names exceed the conservative single-line legend space.");
  }
  const series = names.map((name, index) => ({
    type: kind,
    name,
    data: body.map((row) => chartNumber(row[index + 1].text)),
    ...(kind === "line" ? { smooth: false } : {}),
  }));
  const values = series.flatMap((s) => s.data);
  const min = Math.min(0, Math.floor(Math.min(...values)));
  let max = Math.max(0, Math.ceil(Math.max(...values)));
  if (max === min) max = min + 1;
  // Integer bounds yield six ticks at fifths, accurately shown by native fmt(2dp).
  return {
    textStyle: { fontFamily: "Arial, sans-serif" },
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, textStyle: { fontSize } },
    grid: { left: 112, right: 24, top: 24, bottom: 78 },
    xAxis: { type: "category", data: labels, axisLabel: { fontSize } },
    yAxis: { type: "value", min, max, axisLabel: { fontSize } },
    series,
  };
}
export function projectChart(
  table: PlainTable,
  kind: ChartKind,
  id: string,
  y = 166,
  contentFrame?: Frame,
): Element {
  const frame = contentFrame ?? { x: 80, y, w: 1120, h: 460 };
  if (
    frame.x < 0 || frame.x + frame.w > 1280 || frame.y < 0 ||
    frame.y + frame.h > 720
  ) {
    fail(
      "The chart does not fit in the remaining slide area; place it on a separate slide.",
    );
  }
  return {
    id,
    type: "chart",
    preset: kind,
    option: chartOption(table, kind, frame),
    ...frame,
    rotation: 0,
    opacity: 1,
  };
}
/** Execute no guessing/fallback: a single table under only Quarto cell wrappers. */
export function executedChartTable(
  nodes: Node[],
): { table: PlainTable; computed: boolean } {
  let found: { table: PlainTable; computed: boolean } | undefined;
  function walk(nodes: Node[], computed: boolean) {
    for (const node of nodes) {
      if (node.t === "Table") {
        if (found) fail("Use exactly one table per chart producer.");
        found = { table: plainTable(node), computed };
      } else if (node.t === "Div") {
        const [attr, children] = node.c as [
          [string, string[], [string, string][]],
          Node[],
        ];
        if (
          attr[2].length || !attr[1].length ||
          attr[1].some((c) => !["cell", "cell-output-display"].includes(c))
        ) {
          fail(
            "Only plain Quarto cell/output wrappers may surround the chart data table; captions and floats need another adapter.",
          );
        }
        walk(children, computed || attr[1].includes("cell"));
      } else {fail(
          `Chart data must be exactly one plain table; ${node.t} cannot be dropped.`,
        );}
    }
  }
  walk(nodes, false);
  return found ??
    fail(
      "Chart data must contain one table; images cannot be inferred as native data.",
    );
}
