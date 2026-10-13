/** Original bytes establish chart intent and table/producer provenance. */
import {
  hashSource,
  scanSource,
  type SourceBlock,
  type SourceDocument,
} from "./mod.ts";
import { authoredTableBlock, parsePipeTable, tableProducer } from "./table.ts";
import { type ChartKind, chartOption } from "../render/chart.ts";
import type { Element } from "../render/types.ts";
import { canonical } from "../state/json.ts";
import { type PandocAttr, parseDesignAttributes } from "../render/design.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
function fail(message: string): never {
  throw new Error(`UNMAPPED_CHART_SOURCE: ${message}`);
}
export function isSourceChart(block: SourceBlock): boolean {
  const content = /\{([^{}]*)\}[ \t]*$/.exec(block.raw.split(/\r?\n/)[0])?.[1];
  const tokens: string[] = content?.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ??
    [];
  return tokens.includes(".bento-chart");
}
export function chartSourceAttributes(block: SourceBlock): PandocAttr {
  const content = /^ {0,3}:{3,}\s*\{([^{}]*)\}\s*$/.exec(
    block.raw.split(/\r?\n/)[0],
  )?.[1];
  if (content === undefined) {
    fail("Chart ancestors require literal fenced-div attributes.");
  }
  return originalPandocAttributes(content, originalAttributeTokens(content));
}
export function chartSource(doc: SourceDocument, wrapperId: string) {
  if (doc.hash !== hashSource(doc.text)) {
    fail("The original chart source snapshot is stale.");
  }
  const original = scanSource(doc.text);
  const candidates = original.blocks.filter((b) =>
    b.id === wrapperId && b.kind === "div" && b.stable && b.explicitId
  );
  if (original.diagnostics.length || candidates.length !== 1) {
    fail("Use one uniquely identified original chart wrapper.");
  }
  const wrapper = candidates[0];
  const header = wrapper.raw.split(/\r?\n/)[0];
  const attr = /^\s*:{3,}\s*\{([^{}]*)\}\s*$/.exec(header)?.[1];
  const tokens = attr?.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [];
  const parsed: PandocAttr = ["", [], []];
  for (const token of tokens) {
    if (token.startsWith("#")) {
      if (parsed[0]) fail("Original chart wrapper has more than one identity.");
      parsed[0] = token.slice(1);
    } else if (token.startsWith(".")) parsed[1].push(token.slice(1));
    else {
      const pair =
        /^([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"\\]*)"|'([^'\\]*)'|([^\s"']+))$/
          .exec(token);
      if (!pair) {
        fail(
          "Original chart attributes need supported literal key=value syntax.",
        );
      }
      parsed[2].push([pair[1], pair[2] ?? pair[3] ?? pair[4]]);
    }
  }
  let declared;
  try {
    declared = parseDesignAttributes(parsed);
  } catch (error) {
    fail(`Invalid original component declaration: ${String(error)}`);
  }
  if (parsed[0] !== wrapper.id || declared.component !== "chart") {
    fail(
      "Original chart wrapper identity or component role disagrees with the source map.",
    );
  }
  if (tokens.filter((t) => t === ".bento-chart").length !== 1) {
    fail(
      "Native chart intent must be explicit in the original .bento-chart wrapper.",
    );
  }
  const kinds = tokens.filter((t) => t.startsWith("bento-chart-kind="));
  const match = kinds.length === 1
    ? /^bento-chart-kind=(?:"(bar|line)"|'(bar|line)'|(bar|line))$/.exec(
      kinds[0],
    )
    : null;
  if (!match) {
    fail("Declare exactly one bento-chart-kind=bar or line in original QMD.");
  }
  const kind = (match[1] ?? match[2] ?? match[3]) as ChartKind;
  const children = original.blocks.filter((b) =>
    b.id !== wrapper.id && b.span.start >= wrapper.contentSpan.start &&
    b.span.end <= wrapper.contentSpan.end
  );
  if (children.length !== 1) {
    fail(
      "A chart wrapper must contain one original literal table or one explicitly labelled producer chunk.",
    );
  }
  const block = children[0].kind === "chunk"
    ? tableProducer(original, wrapper.id)
    : authoredTableBlock(original, wrapper.id);
  const ancestors: string[] = [];
  let parentId = wrapper.parentId, groupId: string | undefined;
  while (parentId) {
    const parent = original.blocks.find((candidate) =>
      candidate.id === parentId
    );
    if (
      !parent || ancestors.includes(parentId) || parent.kind !== "div" ||
      !parent.explicitId || parent.origin !== "authored" ||
      parent.slideId !== wrapper.slideId
    ) {
      fail(
        "Chart ancestors must be original identified source divs on the same slide, outside execution output.",
      );
    }
    const component =
      parseDesignAttributes(chartSourceAttributes(parent)).component;
    if (component && !["card", "layout"].includes(component)) {
      fail(
        "Only original cards/layouts or transparent source wrappers may contain a chart.",
      );
    }
    if (component) groupId = parent.id;
    ancestors.push(parentId);
    parentId = parent.parentId;
  }
  return {
    original,
    wrapper,
    attr: parsed,
    ancestors,
    groupId,
    block,
    kind,
    computed: block.kind === "chunk",
  };
}
export function validateAuthoredChart(
  doc: SourceDocument,
  blockId: string,
  element: Element,
) {
  const original = scanSource(doc.text);
  const blocks = original.blocks.filter((b) => b.id === blockId);
  if (blocks.length !== 1 || !blocks[0].parentId) {
    fail("Chart lacks one original table fragment.");
  }
  const source = chartSource(original, blocks[0].parentId);
  if (
    source.computed || source.block.id !== blockId ||
    element.type !== "chart" || element.preset !== source.kind ||
    canonical(element.option) !==
      canonical(chartOption(parsePipeTable(source.block.content), source.kind))
  ) {
    fail(
      "Executed chart labels, values or kind differ from the exact authored table and original declaration.",
    );
  }
  return source.block;
}
