import type { SourceBlock } from "../source/mod.ts";
import { DesignError, type Frame } from "./design.ts";
import type { Node } from "./types.ts";

type Attr = [string, string[], [string, string][]];
export interface ExecutionLayout {
  location: "default" | "column" | "slide";
  columns: number;
  codeWidth: number;
  explicit: boolean;
}

/** Options are read from the checked original chunk, never generated attributes. */
export function executionLayout(block: SourceBlock): ExecutionLayout {
  const options = new Map<string, string>();
  for (const line of block.raw.split(/\r?\n/).slice(1, -1)) {
    if (!line.trim()) continue;
    if (!/^\s*#\|/.test(line)) break;
    const match =
      /^\s*#\|\s*(output-location|layout-ncol|bento-code-width)\s*:\s*(.*?)\s*$/
        .exec(line);
    if (!match) continue;
    if (options.has(match[1])) {
      throw new DesignError(
        "EXECUTION_LAYOUT",
        "Repeated execution layout option.",
      );
    }
    options.set(
      match[1],
      match[2].replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2"),
    );
  }
  const location = options.get("output-location") ?? "default";
  if (!["default", "column", "slide"].includes(location)) {
    throw new DesignError(
      "EXECUTION_LAYOUT",
      "Use output-location: default, column or slide; fragment playback needs a separate adapter.",
    );
  }
  const number = (
    key: string,
    fallback: number,
    maximum: number,
    minimum = 1,
  ) => {
    const value = options.get(key);
    if (value === undefined) return fallback;
    if (
      !/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum
    ) {
      throw new DesignError(
        "EXECUTION_LAYOUT",
        `${key} must be an integer from ${minimum} to ${maximum}.`,
      );
    }
    return Number(value);
  };
  return {
    location: location as ExecutionLayout["location"],
    columns: number("layout-ncol", 1, 6),
    codeWidth: number("bento-code-width", 50, 90, 10),
    explicit: options.size > 0,
  };
}

export interface ExecutionUnit {
  node: Node;
  code: boolean;
}
export function executionUnits(nodes: Node[]): ExecutionUnit[] {
  return nodes.flatMap((node): ExecutionUnit[] => {
    if (
      node.t === "RawBlock" &&
      /^\s*(?:<\/?(?:div|section|figure|figcaption)[^>]*>\s*|<!--[\s\S]*?-->\s*)*$/
        .test(String((node.c as unknown[])[1]))
    ) return [];
    if (node.t === "Div") {
      const [attr, children] = node.c as [Attr, Node[]];
      if (attr[1].includes("cell") || attr[1].includes("quarto-layout-row")) {
        return executionUnits(children);
      }
    }
    return [{
      node,
      code: node.t === "CodeBlock" &&
        (node.c as [Attr, string])[0][1].includes("cell-code"),
    }];
  });
}

/** Fixed text keeps its measured size; only figure rows divide remaining space. */
export function executionFrames(
  units: ExecutionUnit[],
  layout: ExecutionLayout,
  frame: Frame,
  height: (node: Node, width: number) => number,
): Frame[] {
  const result: Frame[] = [];
  const stack = (indexes: number[], area: Frame, columns = 1) => {
    const gap = 20;
    const rows = Array.from(
      { length: Math.ceil(indexes.length / columns) },
      (_, row) => indexes.slice(row * columns, (row + 1) * columns),
    );
    const width = (area.w - gap * (columns - 1)) / columns;
    const heights = rows.map((row) => {
      const values = row.map((index) => height(units[index].node, width));
      const flexible = values.includes(-1);
      return { flexible, minimum: Math.max(flexible ? 100 : 0, ...values) };
    });
    const fixed = heights.reduce((sum, row) => sum + row.minimum, 0);
    const flexible = heights.filter((row) => row.flexible).length;
    const free = area.h - gap * Math.max(0, rows.length - 1) - fixed;
    if (
      width <= 0 || free < -.01 ||
      flexible && width < 100
    ) {
      throw new DesignError(
        "EXECUTION_CONTENT_OVERFLOW",
        "Code and complete results exceed their frame; use columns, a larger frame, scrollable output or output-location: slide.",
      );
    }
    let y = area.y;
    rows.forEach((row, rowIndex) => {
      const measured = heights[rowIndex];
      const h = measured.minimum +
        (measured.flexible ? Math.max(0, free) / flexible : 0);
      row.forEach((index, column) =>
        result[index] = { x: area.x + column * (width + gap), y, w: width, h }
      );
      y += h + gap;
    });
  };
  const codes = units.flatMap((unit, index) => unit.code ? [index] : []);
  const outputs = units.flatMap((unit, index) => unit.code ? [] : [index]);
  if (layout.location === "column" && codes.length && outputs.length) {
    const width = (frame.w - 24) * layout.codeWidth / 100;
    stack(codes, { ...frame, w: width });
    stack(outputs, {
      ...frame,
      x: frame.x + width + 24,
      w: frame.w - width - 24,
    }, layout.columns);
  } else if (layout.columns > 1 && outputs.length) {
    stack(codes, frame);
    const codeHeight = codes.reduce(
      (sum, index) => sum + result[index].h + 20,
      0,
    );
    stack(outputs, {
      ...frame,
      y: frame.y + codeHeight,
      h: frame.h - codeHeight,
    }, layout.columns);
  } else stack(units.map((_, index) => index), frame);
  return result;
}
