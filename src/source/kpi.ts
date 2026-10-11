/** Original-source contract for the deliberately bounded KPI composition. */
import {
  hashSource,
  scanSource,
  type SourceBlock,
  type SourceDocument,
} from "./mod.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "./attributes.ts";
import {
  type DesignDeclaration,
  DesignError,
  nativeDesignField,
  type PandocAttr,
  parseDesignAttributes,
} from "../render/design.ts";

export type KpiRole = "label" | "value" | "detail";
export interface KpiSlot {
  role: KpiRole;
  wrapper: SourceBlock;
  paragraph: SourceBlock;
  attr: PandocAttr;
  design: DesignDeclaration;
}
export interface KpiSource {
  wrapper: SourceBlock;
  attr: PandocAttr;
  design: DesignDeclaration;
  slots: KpiSlot[];
}
function fail(code: string, message: string): never {
  throw new DesignError(code, message);
}
export function kpiSourceAttributes(block: SourceBlock): PandocAttr {
  const content = /^ {0,3}:{3,}\s*\{([^{}]*)\}\s*$/.exec(
    block.raw.split(/\r?\n/)[0],
  )?.[1];
  if (content === undefined) {
    fail(
      "KPI_SOURCE_ATTRIBUTES",
      "Use literal fenced-div attributes for KPI identities and roles.",
    );
  }
  return originalPandocAttributes(content, originalAttributeTokens(content));
}
/** A computed paragraph is its own inline source proof; no chunk is invented. */
function assertInlineValue(block: SourceBlock): void {
  if (block.origin !== "computed") return;
  // Quarto's ordinary inline forms only. Shortcodes, multiline/delimiter tricks,
  // and unproved dynamic constructs have no faithful KPI mapping in this slice.
  if (/\{\{[<%]|\r|\n/.test(block.content)) {
    fail(
      "KPI_INLINE_SOURCE_UNSUPPORTED",
      "Use a single-line Quarto inline expression in the value slot.",
    );
  }
  const codes = [...block.content.matchAll(/(?<!`)(`+)([^`]*?)\1(?!`)/g)];
  const expressions = codes.filter((match) =>
    /^(?:r\s+|\{(?:r|python|julia)\}\s*)\S/.test(match[2])
  );
  if (!expressions.length || expressions.some((match) => match[1] !== "`")) {
    fail(
      "KPI_INLINE_SOURCE_UNSUPPORTED",
      "The computed value needs an explicit supported Quarto inline expression, not a synthetic producer.",
    );
  }
}
export function kpiSource(document: SourceDocument, id: string): KpiSource {
  if (document.hash !== hashSource(document.text)) {
    fail(
      "KPI_SOURCE_CHANGED",
      "The original KPI source snapshot hash is stale.",
    );
  }
  const source = scanSource(document.text);
  if (source.diagnostics.length) {
    fail(
      "KPI_SOURCE_IDENTITY",
      "Resolve duplicate IDs or malformed source structure before rendering a KPI.",
    );
  }
  const wrappers = source.blocks.filter((block) => block.id === id);
  if (
    wrappers.length !== 1 || wrappers[0].kind !== "div" ||
    !wrappers[0].explicitId
  ) {
    fail(
      "KPI_SOURCE_IDENTITY",
      "A KPI needs one globally identified original fenced div.",
    );
  }
  const wrapper = wrappers[0], attr = kpiSourceAttributes(wrapper);
  const design = parseDesignAttributes(attr);
  if (attr[0] !== id || design.component !== "kpi" || id.length + 18 > 160) {
    fail(
      "KPI_SOURCE_IDENTITY",
      "The original .bento-kpi identity must fit the pinned native object IDs.",
    );
  }
  const children = source.blocks.filter((block) => block.parentId === id);
  if (
    children.length < 2 || children.length > 3 ||
    children.some((block) => block.kind !== "div" || !block.explicitId)
  ) {
    fail(
      "KPI_SLOT_STRUCTURE",
      "A KPI needs exactly two or three identified direct div children: label, value, optional detail.",
    );
  }
  const roles: KpiRole[] = ["label", "value", "detail"];
  const slots = children.map((child, index): KpiSlot => {
    const childAttr = kpiSourceAttributes(child);
    const declared = childAttr[2].filter(([key]) => key === "bento-role");
    if (
      childAttr[0] !== child.id || child.id.length + 12 > 160 ||
      declared.length !== 1 || declared[0][1] !== roles[index] ||
      childAttr[1].length
    ) {
      fail(
        "KPI_SLOT_ROLE",
        "Declare the unique roles label, value, optional detail in that order, on plain identified div children.",
      );
    }
    const descendants = source.blocks.filter((block) =>
      block.parentId === child.id
    );
    if (
      descendants.length !== 1 || descendants[0].kind !== "paragraph" ||
      descendants[0].id !== `${child.id}/paragraph:1`
    ) {
      fail(
        "KPI_SLOT_PARAGRAPH",
        "Each KPI role needs exactly one ordinary paragraph; nested blocks and separately marked paragraphs refuse.",
      );
    }
    if (
      childAttr[2].some(([key]) =>
        key !== "bento-role" && !nativeDesignField(key)
      )
    ) {
      fail(
        "KPI_SLOT_ATTRIBUTE",
        "KPI children accept bento-role and supported native text design fields only.",
      );
    }
    const paragraph = descendants[0];
    if (paragraph.origin === "computed" && roles[index] !== "value") {
      fail(
        "KPI_LITERAL_ROLE_REQUIRED",
        "Label and detail are authored literal paragraphs; inline computation belongs to value.",
      );
    }
    assertInlineValue(paragraph);
    return {
      role: roles[index],
      wrapper: child,
      paragraph,
      attr: childAttr,
      design: parseDesignAttributes(childAttr),
    };
  });
  return { wrapper, attr, design, slots };
}
