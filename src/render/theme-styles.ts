import {
  builtinLayouts,
  type DesignDefaults,
  DesignError,
  type DesignTheme,
  type Frame,
  type PandocAttr,
  parseDesignAttributes,
  type ReusableStyle,
  type SlideVariant,
  validateDesignDefaults,
  type VariantSlot,
} from "./design.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "../source/attributes.ts";
import type { SourceBlock, SourceDocument } from "../source/mod.ts";
import type { Element } from "./types.ts";

const references = ["bento-style", "bento-variant", "bento-slot"];
export function originalThemeAttributes(
  block: SourceBlock,
): PandocAttr | undefined {
  const content = /\{([^{}]*)\}[ \t]*$/.exec(block.raw.split(/\r?\n/)[0])?.[1];
  return content === undefined
    ? undefined
    : originalPandocAttributes(content, originalAttributeTokens(content));
}
function sourceChildren(
  source: SourceDocument,
  block: SourceBlock,
): SourceBlock[] {
  return source.blocks.filter((child) =>
    child.parentId === block.id &&
    child.span.start >= block.contentSpan.start &&
    child.span.end <= block.contentSpan.end
  );
}
/** Resolve a single authored object through transparent source wrappers.
 * Computed/unsupported content still needs the executed projection's check.
 */
function authoredStyleTarget(
  source: SourceDocument,
  block: SourceBlock,
): "text" | "code" | undefined {
  while (block.kind === "div") {
    const attr = originalThemeAttributes(block);
    const component = attr && parseDesignAttributes(attr).component;
    if (component && component !== "code") return undefined;
    const children = sourceChildren(source, block);
    if (children.length !== 1) return undefined;
    block = children[0];
  }
  if (block.origin !== "authored") return undefined;
  if (block.kind === "code") return "code";
  if (["heading", "paragraph", "list"].includes(block.kind)) return "text";
  return undefined;
}
/** Validate exact source selectors, including attributes a reader may erase. */
export function assertReusableDesignSource(
  source: SourceDocument,
  defaults: DesignDefaults = {},
): void {
  validateDesignDefaults(defaults);
  const usedSlots = new Set<string>();
  for (const block of source.blocks) {
    const selectorBlock = /\{([^{}]*)\}[ \t]*$/.exec(
      block.raw.split(/\r?\n/)[0],
    )?.[1];
    if (
      !["heading", "div", "code"].includes(block.kind) || !selectorBlock ||
      !/bento-(?:style|variant|slot|layout-name)\s*=/.test(selectorBlock)
    ) continue;
    const attr = originalThemeAttributes(block);
    if (!attr || !block.stable) {
      throw new DesignError(
        "INVALID_DESIGN_REFERENCE",
        "Reusable design selectors require explicit original source IDs.",
      );
    }
    const declaration = parseDesignAttributes(attr);
    if (declaration.layout) {
      const layout = Object.hasOwn(defaults.layouts ?? {}, declaration.layout)
        ? defaults.layouts![declaration.layout]
        : Object.hasOwn(builtinLayouts, declaration.layout)
        ? builtinLayouts[declaration.layout]
        : undefined;
      if (!layout) throw new DesignError("UNKNOWN_LAYOUT", declaration.layout);
      const children = sourceChildren(source, block);
      // Identified direct divs are the supported layout slots. Nested content
      // and source comments do not add columns; unsupported shapes still go
      // through the executed projection's existing diagnostics.
      if (
        children.every((child) => child.kind === "div" && child.stable) &&
        children.length !== layout.columns
      ) {
        throw new DesignError(
          "LAYOUT_ARITY",
          `${declaration.layout} expects ${layout.columns} semantic children; ${block.id} has ${children.length}.`,
        );
      }
    }
    if (declaration.variant) {
      if (block.kind !== "heading" || block.level !== 2 || block.parentId) {
        throw new DesignError(
          "VARIANT_TARGET_MISMATCH",
          "bento-variant belongs to a top-level level-2 slide heading.",
        );
      }
      variantFor(defaults.theme, declaration.variant);
    }
    if (declaration.slot) {
      if (
        block.kind !== "div" || block.parentId || !block.slideId ||
        attr[1].includes("notes")
      ) {
        throw new DesignError(
          "SLOT_TARGET_MISMATCH",
          "bento-slot belongs to an identified top-level source div under a slide heading.",
        );
      }
      const headingId = source.slides.find((slide) =>
        slide.id === block.slideId
      )?.headingId;
      const heading = source.blocks.find((candidate) =>
        candidate.id === headingId
      );
      const headingAttr = heading && originalThemeAttributes(heading);
      const variant = variantFor(
        defaults.theme,
        headingAttr && parseDesignAttributes(headingAttr).variant ||
          defaults.theme?.defaultVariant,
      );
      const slot = slotFor(variant, declaration.slot);
      const key = JSON.stringify([block.slideId, declaration.slot]);
      if (usedSlots.has(key)) {
        throw new DesignError(
          "DUPLICATE_SLOT",
          "Select a slot once per slide; place repeated content inside its rows or columns.",
        );
      }
      usedSlots.add(key);
      const children = sourceChildren(source, block);
      if (
        slot.layout &&
        (declaration.component || children.length < 1 || children.length > 6 ||
          children.some((child) => child.kind !== "div" || !child.stable))
      ) {
        throw new DesignError(
          "SLOT_LAYOUT_CHILDREN",
          "A row/column slot needs one to six identified direct div children and no component class.",
        );
      }
      if (slot.style) {
        const style = namedStyle(defaults.theme, slot.style);
        const targets = slot.layout
          ? children.map((child) => authoredStyleTarget(source, child))
          : [
            declaration.component === "card"
              ? "card"
              : authoredStyleTarget(source, block),
          ];
        if (
          targets.some((target) =>
            target === undefined || target !== style.target
          )
        ) {
          throw new DesignError(
            "STYLE_TARGET_MISMATCH",
            "Slot style must match every original content target.",
          );
        }
      }
      if (slot.layout) slotFrames(slot, children.length);
    }
    if (declaration.style) {
      const named = namedStyle(defaults.theme, declaration.style);
      const contentTarget = block.kind === "div" && !declaration.component
        ? authoredStyleTarget(source, block)
        : undefined;
      if (
        declaration.component === "card"
          ? named.target !== "card"
          : declaration.component && declaration.component !== "code" ||
            named.target === "card" ||
            declaration.component === "code" && named.target !== "code" ||
            block.kind === "heading" && named.target !== "text" ||
            block.kind === "code" && named.target !== "code" ||
            contentTarget !== undefined && named.target !== contentTarget
      ) {
        throw new DesignError(
          "STYLE_TARGET_MISMATCH",
          "Named style does not match its source target.",
        );
      }
    }
  }
  const defaultVariant = variantFor(
    defaults.theme,
    defaults.theme?.defaultVariant,
  );
  if (
    defaultVariant?.decorations?.length &&
    source.blocks.some((block) =>
      block.slideId === undefined &&
      (block.kind !== "heading" || (block.level ?? 3) > 2)
    )
  ) {
    throw new DesignError(
      "THEME_INTRO_HEADING_REQUIRED",
      "This theme adds slide decorations that require an original slide heading. Start the presentation content with an identified level-2 heading, for example ## Introduction {#introduction}, before paragraphs, components or executable chunks.",
    );
  }
}
/** Only recover selectors from the actual original block, never generated output. */
export function recoverThemeAttributes(
  attr: PandocAttr,
  kind: SourceBlock["kind"],
  source?: SourceDocument,
  computed = false,
): PandocAttr {
  if (!source) return attr;
  const block = source.blocks.find((block) =>
    block.id === attr[0] && block.kind === kind && block.stable &&
    block.origin === "authored"
  );
  const original = block && originalThemeAttributes(block);
  const current = attr[2].filter(([key]) => references.includes(key));
  const expected = original?.[2].filter(([key]) => references.includes(key)) ??
    [];
  if (
    current.length &&
    (computed || !block ||
      current.some(([key, value]) =>
        !expected.some(([name, selected]) => key === name && value === selected)
      ))
  ) {
    throw new DesignError(
      "UNMAPPED_DESIGN_REFERENCE",
      "Executed reusable design selector differs from original source.",
    );
  }
  return expected.length
    ? [attr[0], attr[1], [
      ...attr[2].filter(([key]) => !references.includes(key)),
      ...expected,
    ]]
    : attr;
}
export function namedStyle(
  theme: DesignTheme | undefined,
  name: string,
  target?: "text" | "code" | "card",
): NonNullable<DesignTheme["namedStyles"]>[string] {
  const style = theme?.namedStyles && Object.hasOwn(theme.namedStyles, name)
    ? theme.namedStyles[name]
    : undefined;
  if (!style) throw new DesignError("UNKNOWN_STYLE", name);
  if (target && style.target !== target) {
    throw new DesignError(
      "STYLE_TARGET_MISMATCH",
      `${name} targets ${style.target}, not ${target}.`,
    );
  }
  return style;
}
export function roleStyle(
  theme: DesignTheme | undefined,
  role: "title" | "heading" | "body" | "code" | "card",
  variant?: SlideVariant,
): ReusableStyle {
  return { ...theme?.styles?.[role], ...variant?.styles?.[role] };
}
export function textProperties(properties: ReusableStyle): ReusableStyle {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) =>
      !["fill", "stroke", "strokeWidth", "radius", "opacity"].includes(key)
    ),
  );
}
export function variantFor(
  theme: DesignTheme | undefined,
  name?: string,
): SlideVariant | undefined {
  if (!name) return undefined;
  const variant = theme?.variants && Object.hasOwn(theme.variants, name)
    ? theme.variants[name]
    : undefined;
  if (!variant) throw new DesignError("UNKNOWN_VARIANT", name);
  return variant;
}
export function variantDecorations(
  slideId: string,
  variant: string,
  definition: SlideVariant,
): Element[] {
  return (definition.decorations ?? []).map(({ id, ...properties }) => ({
    id: `${slideId}/qb-theme/${variant}/${id}`,
    type: "shape",
    shape: "rect",
    rotation: 0,
    opacity: 1,
    stroke: "none",
    strokeWidth: 0,
    radius: 0,
    ...properties,
  }));
}

export function slotFor(
  variant: SlideVariant | undefined,
  name: string,
): VariantSlot {
  const slot = variant?.slots && Object.hasOwn(variant.slots, name)
    ? variant.slots[name]
    : undefined;
  if (!slot) throw new DesignError("UNKNOWN_SLOT", name);
  return slot;
}
export function slotFrames(slot: VariantSlot, count: number): Frame[] {
  const gap = slot.gap ?? 16, frame = slot.frame;
  const horizontal = slot.layout === "columns";
  const size = ((horizontal ? frame.w : frame.h) - gap * (count - 1)) / count;
  if (size <= 0) {
    throw new DesignError(
      "SLOT_OVERFLOW",
      "Slot gap exceeds the available frame.",
    );
  }
  return Array.from({ length: count }, (_, index) => ({
    x: frame.x + (horizontal ? index * (size + gap) : 0),
    y: frame.y + (horizontal ? 0 : index * (size + gap)),
    w: horizontal ? size : frame.w,
    h: horizontal ? frame.h : size,
  }));
}
