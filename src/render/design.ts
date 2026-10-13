import type { Element, Json } from "./types.ts";

export type PandocAttr = [string, string[], [string, string][]];
export type DesignProperties = Record<string, string | number>;
export interface DesignDeclaration {
  sourceId: string;
  component?:
    | "card"
    | "layout"
    | "code"
    | "chart"
    | "kpi"
    | "diagram"
    | "timeline"
    | "node"
    | "edge"
    | "milestone";
  chartKind?: "bar" | "line";
  layout?: string;
  properties: DesignProperties;
  /** Actual native Bento field -> the exact original QMD attribute key. */
  bindings: Record<string, string>;
}
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface DesignTheme {
  background: string;
  color: string;
  accent: string;
  fontFamily: string;
}
export interface LayoutDefinition {
  columns: number;
  gap: number;
  padding: number;
}
export interface DesignDefaults {
  frame?: Frame;
  theme?: DesignTheme;
  layouts?: Record<string, LayoutDefinition>;
}
export class DesignError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "DesignError";
  }
}
const numbers: Record<string, [number, number]> = {
  x: [-1e6, 1e6],
  y: [-1e6, 1e6],
  w: [0.01, 1e6],
  h: [0.01, 1e6],
  rotation: [-3600, 3600],
  opacity: [0, 1],
  fontSize: [0.01, 4000],
  fontWeight: [1, 1000],
  lineHeight: [0.01, 100],
  letterSpacing: [-1000, 1000],
  radius: [0, 100000],
  strokeWidth: [0, 10000],
};
const aliases: Record<string, string> = {
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "line-height": "lineHeight",
  "letter-spacing": "letterSpacing",
  "stroke-width": "strokeWidth",
};
const textFields = new Set([
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "align",
  "valign",
]);
const shapeFields = new Set(["fill", "stroke", "strokeWidth", "radius"]);
const genericFields = new Set(["x", "y", "w", "h", "rotation", "opacity"]);
export function nativeDesignField(key: string): string | undefined {
  const field = aliases[key] ?? key;
  return genericFields.has(field) || textFields.has(field) ||
      shapeFields.has(field)
    ? field
    : undefined;
}
/** Deliberately bounded CSS vocabulary; no urls, variables, declarations or code. */
export function validateDesignValue(
  key: string,
  raw: string | number,
): string | number {
  const field = nativeDesignField(key);
  if (!field) throw new DesignError("UNSUPPORTED_DESIGN_ATTRIBUTE", key);
  const value = String(raw);
  if (numbers[field]) {
    const n = Number(value), [min, max] = numbers[field];
    if (
      !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(n) ||
      n < min || n > max
    ) {
      throw new DesignError(
        "INVALID_DESIGN_VALUE",
        `${key} requires a finite number in [${min}, ${max}]`,
      );
    }
    return n;
  }
  if (["color", "fill", "stroke"].includes(field)) {
    if (
      !/^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|black|white|red|green|blue|gray|grey|navy|teal|orange|purple|yellow|none)$/i
        .test(value)
    ) {
      throw new DesignError(
        "INVALID_DESIGN_VALUE",
        `${key} requires a hex or supported named color`,
      );
    }
    if (field === "color" && value === "none") {
      throw new DesignError(
        "INVALID_DESIGN_VALUE",
        "text color cannot be none",
      );
    }
    return value;
  }
  if (field === "fontFamily") {
    if (
      value.length > 300 || !/^[\p{L}\p{N} ,._-]+$/u.test(value) ||
      !value.trim()
    ) {
      throw new DesignError(
        "INVALID_DESIGN_VALUE",
        "font-family requires a plain family/stack without CSS syntax",
      );
    }
    return value;
  }
  const allowed = field === "align"
    ? ["left", "center", "right"]
    : ["top", "middle", "bottom"];
  if (!allowed.includes(value)) {
    throw new DesignError("INVALID_DESIGN_VALUE", `${key}: ${value}`);
  }
  return value;
}
export function parseDesignAttributes(attr: PandocAttr): DesignDeclaration {
  const result: DesignDeclaration = {
    sourceId: attr[0],
    properties: {},
    bindings: {},
  };
  const components = attr[1].filter((c) => c.startsWith("bento-"));
  if (components.length > 1) {
    throw new DesignError("AMBIGUOUS_COMPONENT", components.join(", "));
  }
  if (components.length) {
    if (attr[0].length > 160 || /["'<>{};]/.test(attr[0])) {
      throw new DesignError(
        "INVALID_COMPONENT_ID",
        "component ID must fit native Bento identity constraints",
      );
    }
    if (!attr[0]) {
      throw new DesignError(
        "COMPONENT_ID_REQUIRED",
        "give the component a stable explicit #id",
      );
    }
    if (components[0] === "bento-card") result.component = "card";
    else if (components[0] === "bento-layout") result.component = "layout";
    else if (components[0] === "bento-code") result.component = "code";
    else if (components[0] === "bento-chart") result.component = "chart";
    else if (components[0] === "bento-kpi") result.component = "kpi";
    else if (components[0] === "bento-diagram") result.component = "diagram";
    else if (components[0] === "bento-timeline") result.component = "timeline";
    else if (components[0] === "bento-node") result.component = "node";
    else if (components[0] === "bento-edge") result.component = "edge";
    else if (components[0] === "bento-milestone") {
      result.component = "milestone";
    } else throw new DesignError("UNSUPPORTED_COMPONENT", components[0]);
  }
  const seen = new Set<string>();
  for (const [key, value] of attr[2]) {
    if (seen.has(key)) throw new DesignError("DUPLICATE_DESIGN_ATTRIBUTE", key);
    seen.add(key);
    if (key === "bento-role") {
      if (result.component || !["label", "value", "detail"].includes(value)) {
        throw new DesignError(
          "KPI_SLOT_ROLE",
          "bento-role belongs to a plain KPI child and must be label, value or detail.",
        );
      }
      continue;
    }
    if ((key === "from" || key === "to") && result.component === "edge") {
      if (!/^[A-Za-z][\w:.-]{0,159}$/.test(value)) {
        throw new DesignError(
          "INVALID_GRAPH_ENDPOINT",
          "Endpoint values require literal source node identities.",
        );
      }
      continue;
    }
    if (key === "bento-chart-kind") {
      if (result.component !== "chart" || !["bar", "line"].includes(value)) {
        throw new DesignError(
          "INVALID_CHART_KIND",
          "bento-chart-kind belongs to an identified .bento-chart and must be bar or line",
        );
      }
      result.chartKind = value as "bar" | "line";
      continue;
    }
    if (key === "layout" || key === "bento-layout-name") {
      if (result.layout) {
        throw new DesignError(
          "DUPLICATE_DESIGN_ATTRIBUTE",
          "Several layout names were declared.",
        );
      }
      if (
        result.component !== "layout" || !/^[a-z][a-z0-9-]{0,63}$/.test(value)
      ) {
        throw new DesignError(
          "INVALID_LAYOUT",
          "layout belongs to an identified .bento-layout",
        );
      }
      result.layout = value;
      continue;
    }
    const native = nativeDesignField(key);
    if (native) {
      if (result.bindings[native]) {
        throw new DesignError(
          "DUPLICATE_DESIGN_ATTRIBUTE",
          `${key} aliases ${result.bindings[native]}`,
        );
      }
      result.properties[native] = validateDesignValue(key, value);
      result.bindings[native] = key;
    } else if (
      (key.startsWith("bento-") || result.component) &&
      !["bento-title-id", "bento-element-id", "bento-image-id"].includes(key)
    ) {
      throw new DesignError("UNSUPPORTED_DESIGN_ATTRIBUTE", key);
    }
  }
  if (result.component === "layout" && !result.layout) {
    throw new DesignError(
      "LAYOUT_REQUIRED",
      'declare bento-layout-name="two-column" or a registered reusable layout',
    );
  }
  if (result.component === "chart" && !result.chartKind) {
    throw new DesignError(
      "CHART_KIND_REQUIRED",
      "declare bento-chart-kind=bar or line",
    );
  }
  return result;
}
function checkedDeclaration(value: DesignDeclaration): DesignDeclaration {
  if (
    !value || typeof value.sourceId !== "string" || !value.properties ||
    !value.bindings ||
    value.component &&
      ![
        "card",
        "layout",
        "code",
        "chart",
        "kpi",
        "diagram",
        "timeline",
        "node",
        "edge",
        "milestone",
      ].includes(value.component)
  ) {
    throw new DesignError(
      "INVALID_DECLARATION",
      "malformed design declaration",
    );
  }
  const attrs: [string, string][] = [];
  for (const [field, property] of Object.entries(value.properties)) {
    const key = value.bindings[field];
    if (
      !key || nativeDesignField(key) !== field ||
      !["string", "number"].includes(typeof property)
    ) {
      throw new DesignError(
        "INVALID_DECLARATION",
        "visual properties require matching validated bindings",
      );
    }
    attrs.push([key, String(property)]);
  }
  if (value.layout) attrs.push(["layout", value.layout]);
  if (value.chartKind) attrs.push(["bento-chart-kind", value.chartKind]);
  return parseDesignAttributes([
    value.sourceId,
    value.component ? [`bento-${value.component}`] : [],
    attrs,
  ]);
}
export function applyElementDesign(
  element: Element,
  declaration: DesignDeclaration,
): {
  element: Element;
  ownedPaths: string[];
  bindings: Record<string, string>;
} {
  declaration = checkedDeclaration(declaration);
  if (declaration.component) {
    throw new DesignError(
      "COMPONENT_REQUIRES_GROUP",
      "use applyComponentDesign for components",
    );
  }
  const copy = structuredClone(element);
  for (const [field, value] of Object.entries(declaration.properties)) {
    if (
      textFields.has(field) && element.type !== "text" &&
        !(element.type === "code" &&
          !["fontWeight", "letterSpacing"].includes(field)) ||
      shapeFields.has(field) && element.type !== "shape"
    ) {
      throw new DesignError(
        "DESIGN_TARGET_MISMATCH",
        `${field} does not apply to native ${element.type}`,
      );
    }
    copy[field] = value;
  }
  return {
    element: copy,
    ownedPaths: Object.keys(declaration.properties),
    bindings: { ...declaration.bindings },
  };
}
const defaultTheme: DesignTheme = {
  background: "#ffffff",
  color: "#172a35",
  accent: "#156f65",
  fontFamily: "Arial, sans-serif",
};
const builtinLayouts: Record<string, LayoutDefinition> = {
  "two-column": { columns: 2, gap: 32, padding: 0 },
};
export function validateDesignDefaults(
  defaults: DesignDefaults,
): DesignDefaults {
  const clean = structuredClone(defaults);
  const keys = (value: unknown, allowed: string[], required: string[] = []) => {
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !(key in value))
    ) {
      throw new DesignError(
        "INVALID_DESIGN_DEFAULTS",
        "unexpected or missing field",
      );
    }
  };
  keys(clean, ["frame", "theme", "layouts"]);
  if (clean.frame) {
    keys(clean.frame, ["x", "y", "w", "h"], ["x", "y", "w", "h"]);
    for (const key of ["x", "y", "w", "h"] as const) {
      if (typeof clean.frame[key] !== "number") {
        throw new DesignError(
          "INVALID_DESIGN_DEFAULTS",
          "frame fields must be numbers",
        );
      }
      validateDesignValue(key, clean.frame[key]);
    }
  }
  if (clean.theme) {
    keys(clean.theme, ["background", "color", "accent", "fontFamily"], [
      "background",
      "color",
      "accent",
      "fontFamily",
    ]);
    if (Object.values(clean.theme).some((value) => typeof value !== "string")) {
      throw new DesignError(
        "INVALID_DESIGN_DEFAULTS",
        "theme fields must be strings",
      );
    }
    validateDesignValue("fill", clean.theme.background);
    validateDesignValue("color", clean.theme.color);
    validateDesignValue("color", clean.theme.accent);
    validateDesignValue("fontFamily", clean.theme.fontFamily);
  }
  if (
    clean.layouts &&
    (Array.isArray(clean.layouts) || typeof clean.layouts !== "object" ||
      Object.keys(clean.layouts).length > 64)
  ) {
    throw new DesignError(
      "INVALID_DESIGN_DEFAULTS",
      "layouts must be a bounded registry",
    );
  }
  for (const [name, layout] of Object.entries(clean.layouts ?? {})) {
    keys(layout, ["columns", "gap", "padding"], ["columns", "gap", "padding"]);
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !Number.isInteger(layout.columns) || layout.columns < 1 ||
      layout.columns > 6 ||
      !Number.isFinite(layout.gap) || layout.gap < 0 || layout.gap > 1000 ||
      !Number.isFinite(layout.padding) || layout.padding < 0 ||
      layout.padding > 1000
    ) {
      throw new DesignError("INVALID_LAYOUT", name);
    }
  }
  return clean;
}
export interface MeasuredComponents {
  /** Source-verified native objects whose metrics must not change after measuring. */
  fixed: ReadonlySet<string>;
  /** Rescued default text has no painted bounds until saved overlays are composed. */
  omitted: ReadonlySet<string>;
}
function bounds(elements: Element[], measured?: MeasuredComponents): Element[] {
  return elements.filter((element) => !measured?.omitted.has(element.id));
}
function placed(
  elements: Element[],
  frame: Frame,
  measured?: MeasuredComponents,
): Element[] {
  if (!elements.length) return [];
  const original = elements.map((e) => {
    if (
      ![e.x, e.y, e.w, e.h].every((v) =>
        typeof v === "number" && Number.isFinite(v)
      )
    ) throw new DesignError("INVALID_ELEMENT_FRAME", e.id);
    return e as Element & Frame;
  });
  const sizing = bounds(original, measured) as (Element & Frame)[];
  const left = Math.min(...sizing.map((e) => e.x)),
    top = Math.min(...sizing.map((e) => e.y));
  const width = Math.max(...sizing.map((e) => e.x + e.w)) - left;
  const height = Math.max(...sizing.map((e) => e.y + e.h)) - top;
  if (width <= 0 || height <= 0) {
    throw new DesignError("INVALID_ELEMENT_FRAME", "empty group bounds");
  }
  // Uniform fit retains aspect ratio and relative positioning within a semantic child.
  let scale = Math.min(1, frame.w / width, frame.h / height);
  if (
    original.some((element) =>
      element.type === "table" || element.type === "chart" ||
      measured?.fixed.has(element.id)
    )
  ) {
    if (width > frame.w + .01 || height > frame.h + .01) {
      throw new DesignError(
        "COMPONENT_CONTENT_OVERFLOW",
        "Measured native content must fit its final frame without scaling its box; use a wider or taller component.",
      );
    }
    // Coordinate subtraction can exceed an exact slot by floating-point dust.
    // Accept that tolerance as translation, never as a near-one scale.
    scale = 1;
  }
  return original.map((e) => {
    const fitted: Element = {
      ...structuredClone(e),
      x: frame.x + (e.x - left) * scale,
      y: frame.y + (e.y - top) * scale,
      w: e.w * scale,
      h: e.h * scale,
    };
    // Scale pixel metrics with their boxes; lineHeight is a unitless ratio.
    // Keeping the original font size inside a fitted code box clips content.
    for (
      const field of ["fontSize", "letterSpacing", "strokeWidth", "radius"]
    ) {
      if (typeof e[field] === "number") fitted[field] = e[field] * scale;
    }
    return fitted;
  });
}
/** Resolve final slots before projecting children, so nested cards do not fit twice. */
export function componentFrames(
  declaration: DesignDeclaration,
  base: Frame,
  count: number,
  defaults: DesignDefaults = {},
  heights?: number[],
): { frame: Frame; children: Frame[] } {
  const clean = validateDesignDefaults(defaults);
  declaration = checkedDeclaration(declaration);
  const frame = { ...base };
  for (const key of ["x", "y", "w", "h"] as const) {
    if (declaration.properties[key] !== undefined) {
      frame[key] = Number(declaration.properties[key]);
    }
  }
  if (count < 1) throw new DesignError("EMPTY_COMPONENT", declaration.sourceId);
  if (declaration.component === "layout") {
    const layout = { ...builtinLayouts, ...clean.layouts }[declaration.layout!];
    if (!layout) throw new DesignError("UNKNOWN_LAYOUT", declaration.layout!);
    if (count !== layout.columns) {
      throw new DesignError(
        "LAYOUT_ARITY",
        `${declaration.layout} expects ${layout.columns} semantic children`,
      );
    }
    const w = (frame.w - 2 * layout.padding - (count - 1) * layout.gap) / count;
    const h = frame.h - 2 * layout.padding;
    if (w <= 0 || h <= 0) {
      throw new DesignError(
        "LAYOUT_OVERFLOW",
        "gap/padding exceed layout dimensions",
      );
    }
    return {
      frame,
      children: Array.from({ length: count }, (_, i) => ({
        x: frame.x + layout.padding + i * (w + layout.gap),
        y: frame.y + layout.padding,
        w,
        h,
      })),
    };
  }
  const padding = 24, gap = 16;
  const h = (frame.h - 2 * padding - gap * (count - 1)) / count;
  if (h <= 0 || frame.w <= 2 * padding) {
    throw new DesignError("CARD_OVERFLOW", "card too small for its children");
  }
  if (heights) {
    if (
      heights.length !== count ||
      heights.some((v) => !Number.isFinite(v) || v === 0 || v < -1)
    ) throw new DesignError("CARD_CONTENT_MEASUREMENT", declaration.sourceId);
    const available = frame.h - 2 * padding - gap * (count - 1);
    const fixed = heights.reduce((sum, v) => sum + Math.max(0, v), 0);
    const flexible = heights.filter((v) => v === -1).length;
    if (fixed >= available && flexible || fixed > available) {
      throw new DesignError(
        "CARD_CONTENT_OVERFLOW",
        "Content needs a taller card; refusing unreadable automatic shrink.",
      );
    }
    let y = frame.y + padding;
    return {
      frame,
      children: heights.map((preferred) => {
        const height = preferred === -1
          ? (available - fixed) / flexible
          : preferred;
        const child = {
          x: frame.x + padding,
          y,
          w: frame.w - 2 * padding,
          h: height,
        };
        y += height + gap;
        return child;
      }),
    };
  }
  return {
    frame,
    children: Array.from({ length: count }, (_, i) => ({
      x: frame.x + padding,
      y: frame.y + padding + i * (h + gap),
      w: frame.w - 2 * padding,
      h,
    })),
  };
}
export interface ComponentProjection {
  elements: Element[];
  ownershipByElement: Record<string, string[]>;
  bindingsByElement: Record<string, Record<string, string>>;
  decorativeIds: string[];
}
/** Each child is a semantic subtree already projected to native elements. */
export function applyComponentDesign(
  children: Element[][],
  declaration: DesignDeclaration,
  defaults: DesignDefaults = {},
  measuredComponents?: MeasuredComponents,
): ComponentProjection {
  const supported = new Set([
    "text",
    "code",
    "image",
    "shape",
    "table",
    "chart",
  ]);
  const unsupported = children.flat().find((element) =>
    !supported.has(element.type)
  );
  if (unsupported) {
    throw new DesignError(
      "COMPONENT_CONTENT_LAYOUT_UNSUPPORTED",
      `${unsupported.type} needs a measured component-layout adapter; refusing to rescale only its box.`,
    );
  }
  const clean = validateDesignDefaults(defaults);
  declaration = checkedDeclaration(declaration);
  if ("rotation" in declaration.properties) {
    throw new DesignError(
      "COMPONENT_ROTATION_UNSUPPORTED",
      "rotate individual elements; a faithful coupled group rotation is not implemented",
    );
  }
  if (
    !declaration.component ||
    !["card", "layout"].includes(declaration.component) || !declaration.sourceId
  ) {
    throw new DesignError(
      "COMPONENT_REQUIRED",
      "identified card/layout required",
    );
  }
  if (!children.length || children.some((c) => !c.length)) {
    throw new DesignError("EMPTY_COMPONENT", declaration.sourceId);
  }
  const theme = clean.theme ?? defaultTheme;
  const frame = { ...(clean.frame ?? { x: 80, y: 166, w: 1120, h: 470 }) };
  for (const key of ["x", "y", "w", "h"] as const) {
    if (declaration.properties[key] !== undefined) {
      frame[key] = Number(declaration.properties[key]);
    }
  }
  const result: ComponentProjection = {
    elements: [],
    ownershipByElement: {},
    bindingsByElement: {},
    decorativeIds: [],
  };
  const geometryOwned = ["x", "y", "w", "h"].some((k) =>
    k in declaration.properties
  );
  const bind = (e: Element, field: string, attr: string) => {
    (result.ownershipByElement[e.id] ??= []).push(field);
    (result.bindingsByElement[e.id] ??= {})[field] = attr;
  };
  if (declaration.component === "layout") {
    const layout = { ...builtinLayouts, ...clean.layouts }[declaration.layout!];
    if (!layout) throw new DesignError("UNKNOWN_LAYOUT", declaration.layout!);
    if (children.length !== layout.columns) {
      throw new DesignError(
        "LAYOUT_ARITY",
        `${declaration.layout} expects ${layout.columns} semantic children`,
      );
    }
    if (
      Object.keys(declaration.properties).some((k) => !genericFields.has(k))
    ) {
      throw new DesignError(
        "LAYOUT_STYLE_UNSUPPORTED",
        "declare typography/fill on child components",
      );
    }
    const width =
      (frame.w - 2 * layout.padding - (layout.columns - 1) * layout.gap) /
      layout.columns;
    const height = frame.h - 2 * layout.padding;
    if (width <= 0 || height <= 0) {
      throw new DesignError(
        "LAYOUT_OVERFLOW",
        "gap/padding exceed layout dimensions",
      );
    }
    children.forEach((child, i) =>
      result.elements.push(
        ...placed(child, {
          x: frame.x + layout.padding + i * (width + layout.gap),
          y: frame.y + layout.padding,
          w: width,
          h: height,
        }, measuredComponents),
      )
    );
  } else {
    const padding = 24, gap = 16;
    const height = (frame.h - 2 * padding - gap * (children.length - 1)) /
      children.length;
    if (height <= 0 || frame.w <= 2 * padding) {
      throw new DesignError("CARD_OVERFLOW", "card too small for its children");
    }
    const background: Element = {
      id: `${declaration.sourceId}/qb-card-background`,
      type: "shape",
      shape: "rect",
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      rotation: 0,
      opacity: 1,
      fill: theme.background,
      stroke: theme.accent,
      strokeWidth: 1,
      radius: 16,
      groupId: declaration.sourceId,
    };
    for (const [field, value] of Object.entries(declaration.properties)) {
      if (shapeFields.has(field)) {
        background[field] = value;
        bind(background, field, declaration.bindings[field]);
      }
    }
    result.elements.push(background);
    result.decorativeIds.push(background.id);
    const measured = children.map((child) => {
      const sized = bounds(child, measuredComponents);
      return Math.max(...sized.map((e) => Number(e.y) + Number(e.h))) -
        Math.min(...sized.map((e) => Number(e.y)));
    });
    const total = measured.reduce((sum, h) => sum + h, 0);
    const available = frame.h - 2 * padding - gap * (children.length - 1);
    if (total > available + .01) {
      throw new DesignError(
        "CARD_CONTENT_OVERFLOW",
        "Measured child groups exceed the card height; use a taller frame or less content.",
      );
    }
    const fit = 1;
    let childY = frame.y + padding;
    children.forEach((child, i) => {
      result.elements.push(
        ...placed(child, {
          x: frame.x + padding,
          y: childY,
          w: frame.w - 2 * padding,
          h: measured[i] * fit,
        }, measuredComponents),
      );
      childY += measured[i] * fit + gap;
    });
    if (
      Object.keys(declaration.properties).some((field) =>
        textFields.has(field)
      ) &&
      !result.elements.some((e) => e.type === "text" || e.type === "code")
    ) {
      throw new DesignError(
        "COMPONENT_STYLE_TARGET",
        "Card typography requires a text/code child; no declaration is silently ignored.",
      );
    }
    for (const e of result.elements) {
      if (e.type === "text" || e.type === "code") {
        e.color = theme.color;
        if (e.type === "text") e.fontFamily = theme.fontFamily;
        for (const [field, value] of Object.entries(declaration.properties)) {
          if (textFields.has(field)) {
            if (
              e.type === "code" &&
              ["fontWeight", "letterSpacing"].includes(field)
            ) {
              throw new DesignError(
                "DESIGN_TARGET_MISMATCH",
                `${field} does not apply to native code in this card.`,
              );
            }
            e[field] = value;
            bind(e, field, declaration.bindings[field]);
          }
        }
      }
    }
  }
  for (const element of result.elements) {
    element.groupId = declaration.sourceId;
    // Group transforms are coupled: reverse editing a child cannot safely infer a
    // parent frame attribute. Mark them source-owned but deliberately unbound.
    if (geometryOwned) {
      result.ownershipByElement[element.id] = [
        ...new Set([
          ...(result.ownershipByElement[element.id] ?? []),
          "x",
          "y",
          "w",
          "h",
        ]),
      ];
    }
    for (const field of ["opacity", "rotation"]) {
      if (field in declaration.properties) {
        element[field] = declaration.properties[field];
        bind(element, field, declaration.bindings[field]);
      }
    }
  }
  const ids = new Set<string>();
  for (const e of result.elements) {
    if (ids.has(e.id)) throw new DesignError("DUPLICATE_DESIGN_ID", e.id);
    ids.add(e.id);
  }
  return result;
}
/** Theme values are pure JSON defaults; native edits remain ordinary sidecar fields. */
export function designTheme(
  defaults: DesignDefaults = {},
): DesignTheme & Record<string, Json> {
  return { ...(validateDesignDefaults(defaults).theme ?? defaultTheme) };
}
