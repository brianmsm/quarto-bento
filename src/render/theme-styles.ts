import {
  type DesignDefaults,
  DesignError,
  type DesignTheme,
  type PandocAttr,
  parseDesignAttributes,
  type ReusableStyle,
  type SlideVariant,
  validateDesignDefaults,
} from "./design.ts";
import {
  originalAttributeTokens,
  originalPandocAttributes,
} from "../source/attributes.ts";
import type { SourceBlock, SourceDocument } from "../source/mod.ts";
import type { Element } from "./types.ts";

const references = ["bento-style", "bento-variant"];
export function originalThemeAttributes(
  block: SourceBlock,
): PandocAttr | undefined {
  const content = /\{([^{}]*)\}[ \t]*$/.exec(block.raw.split(/\r?\n/)[0])?.[1];
  return content === undefined
    ? undefined
    : originalPandocAttributes(content, originalAttributeTokens(content));
}
/** Validate exact source selectors, including attributes a reader may erase. */
export function assertReusableDesignSource(
  source: SourceDocument,
  defaults: DesignDefaults = {},
): void {
  validateDesignDefaults(defaults);
  for (const block of source.blocks) {
    const selectorBlock = /\{([^{}]*)\}[ \t]*$/.exec(
      block.raw.split(/\r?\n/)[0],
    )?.[1];
    if (
      !["heading", "div", "code"].includes(block.kind) || !selectorBlock ||
      !/bento-(?:style|variant)\s*=/.test(selectorBlock)
    ) continue;
    const attr = originalThemeAttributes(block);
    if (!attr || !block.stable) {
      throw new DesignError(
        "INVALID_DESIGN_REFERENCE",
        "Reusable design selectors require explicit original source IDs.",
      );
    }
    const declaration = parseDesignAttributes(attr);
    if (declaration.variant) {
      if (block.kind !== "heading" || block.level !== 2 || block.parentId) {
        throw new DesignError(
          "VARIANT_TARGET_MISMATCH",
          "bento-variant belongs to a top-level level-2 slide heading.",
        );
      }
      variantFor(defaults.theme, declaration.variant);
    }
    if (declaration.style) {
      const named = namedStyle(defaults.theme, declaration.style);
      if (
        declaration.component === "card"
          ? named.target !== "card"
          : declaration.component && declaration.component !== "code" ||
            named.target === "card" ||
            declaration.component === "code" && named.target !== "code" ||
            block.kind === "heading" && named.target !== "text" ||
            block.kind === "code" && named.target !== "code"
      ) {
        throw new DesignError(
          "STYLE_TARGET_MISMATCH",
          "Named style does not match its source target.",
        );
      }
    }
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
): ReusableStyle {
  return theme?.styles?.[role] ?? {};
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
