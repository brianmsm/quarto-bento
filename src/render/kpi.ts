import { measureNativeText, type NativeTextMeasurement } from "./measure.ts";
import { sourceComponentClass } from "./components.ts";
/** Native KPI text/rectangle composition, with no numeric conversion or count-up. */
import { type KpiSource, kpiSource } from "../source/kpi.ts";
import type { SourceDocument } from "../source/mod.ts";
import { renderInline } from "./inline.ts";
import {
  applyElementDesign,
  type DesignDefaults,
  DesignError,
  designTheme,
  type Frame,
  type PandocAttr,
} from "./design.ts";
import type {
  BentoDoc,
  Diagnostic,
  Element,
  Node,
  Origin,
  Projection,
} from "./types.ts";

type Fields = NonNullable<Projection["design"]>[string];
const geometry = new Set(["x", "y", "w", "h"]);
const shape = new Set(["fill", "stroke", "strokeWidth", "radius"]);
const generic = new Set(["rotation", "opacity"]);
const typography = [
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "align",
  "valign",
];
/** Source/slide provenance is verified by the caller before admitting appearance. */
export interface KpiAppearance {
  elements: ReadonlyMap<string, Element>;
  resources?: BentoDoc;
}
function fail(code: string, message: string): never {
  throw new DesignError(code, message);
}
function sameAttr(actual: PandocAttr, expected: PandocAttr): boolean {
  return actual[0] === expected[0] &&
    JSON.stringify([...actual[1]].sort()) ===
      JSON.stringify([...expected[1]].sort()) &&
    JSON.stringify([...actual[2]].sort()) ===
      JSON.stringify([...expected[2]].sort());
}
async function originalParagraphs(binding: KpiSource): Promise<Node[][]> {
  const output = await new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = output.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(
      binding.slots.map((slot) => slot.paragraph.content).join("\n\n"),
    ),
  );
  await writer.close();
  const result = await output.output();
  if (!result.success) {
    fail("KPI_SOURCE_INLINE", new TextDecoder().decode(result.stderr));
  }
  const ast = JSON.parse(new TextDecoder().decode(result.stdout));
  if (
    ast.blocks.length !== binding.slots.length ||
    ast.blocks.some((node: Node) => node.t !== "Para")
  ) {
    fail(
      "KPI_SOURCE_INLINE",
      "Original KPI slots must parse as exactly one paragraph each.",
    );
  }
  return ast.blocks.map((node: Node) => node.c as Node[]);
}
/** Outer height cannot correct glyph overhang on a fixed native edge, or
 * internally overlapping lines. Centered single-line text can use measured slack.
 */
function unsupportedTypography(
  element: Element,
  measurement: NativeTextMeasurement,
): boolean {
  const valign = element.valign ?? "top";
  return (valign === "top" && measurement.overhangTop > .1) ||
    (valign === "bottom" && measurement.overhangBottom > .1) ||
    (measurement.lineCount > 1 &&
      Math.max(measurement.overhangTop, measurement.overhangBottom) > .1);
}
export async function projectKpi(
  source: SourceDocument,
  attr: PandocAttr,
  children: Node[],
  base: Frame,
  defaults: DesignDefaults = {},
  appearance?: KpiAppearance,
  /** An enclosing QMD frame cannot adopt saved role boxes as visual overlays. */
  sourceFrameOwned = false,
): Promise<
  {
    elements: Element[];
    origins: Record<string, Origin>;
    fields: Fields;
    /** The consumer retains unowned member geometry when saved typography rescues projection. */
    appearanceRescued: boolean;
  }
> {
  const binding = kpiSource(source, attr[0]), declaration = binding.design;
  if (
    !sameAttr(attr, binding.attr) || children.length !== binding.slots.length
  ) {
    fail(
      "KPI_EXECUTION_MISMATCH",
      "Executed KPI declaration must match its original identified roles and design.",
    );
  }
  const frame = { ...base };
  for (const key of geometry) {
    if (key in declaration.properties) {
      frame[key as keyof Frame] = Number(declaration.properties[key]);
    }
  }
  if ("rotation" in declaration.properties) {
    fail(
      "COMPONENT_ROTATION_UNSUPPORTED",
      "Rotate individual KPI objects; no coupled parent rotation is inferred.",
    );
  }
  const theme = designTheme(defaults),
    fields: Fields = {},
    origins: Record<string, Origin> = {};
  const background: Element = {
    id: `${attr[0]}/qb-kpi-background`,
    type: "shape",
    shape: "rect",
    ...frame,
    rotation: 0,
    opacity: 1,
    fill: theme.background,
    stroke: theme.accent,
    strokeWidth: 1,
    radius: 16,
    groupId: attr[0],
  };
  const elements = [background];
  fields[background.id] = { ownedPaths: [], bindings: {} };
  origins[background.id] = {
    origin: "authored",
    sourceId: attr[0],
    designOnly: true,
  };
  for (const [field, value] of Object.entries(declaration.properties)) {
    if (shape.has(field)) {
      background[field] = value;
      fields[background.id].ownedPaths.push(field);
      fields[background.id].bindings[field] = {
        sourceId: attr[0],
        attribute: declaration.bindings[field],
      };
    }
  }
  const paragraphs = await originalParagraphs(binding);
  let y = frame.y + 24;
  for (const [index, slot] of binding.slots.entries()) {
    const child = children[index];
    if (child.t !== "Div") {
      fail(
        "KPI_EXECUTION_MISMATCH",
        "Executed KPI roles must remain direct div children.",
      );
    }
    const [childAttr, blocks] = child.c as [PandocAttr, Node[]];
    if (
      !sameAttr(childAttr, slot.attr) || blocks.length !== 1 ||
      blocks[0].t !== "Para"
    ) {
      fail(
        "KPI_EXECUTION_MISMATCH",
        "Executed KPI role, identity and paragraph must match original source.",
      );
    }
    const html = renderInline(blocks[0].c as Node[]);
    if (
      slot.paragraph.origin !== "computed" &&
      renderInline(paragraphs[index]) !== html
    ) {
      fail(
        "KPI_EXECUTION_MISMATCH",
        "Executed literal KPI text differs from its original paragraph.",
      );
    }
    // Parsing original inline nodes also rejects unsupported source formatting.
    if (slot.paragraph.origin === "computed") renderInline(paragraphs[index]);
    let element: Element = {
      id: slot.paragraph.id,
      type: "text",
      x: frame.x + 24,
      y,
      w: frame.w - 48,
      h: 1,
      rotation: 0,
      opacity: 1,
      html,
      fontSize: [26, 52, 22][index],
      fontFamily: theme.fontFamily,
      fontWeight: index === 1 ? 700 : 400,
      color: theme.color,
      align: "left",
      valign: "top",
      lineHeight: 1.25,
      groupId: attr[0],
    };
    if (
      Object.keys(slot.design.properties).some((field) => geometry.has(field))
    ) {
      fail(
        "COMPONENT_CHILD_GEOMETRY",
        "Declare KPI geometry on the outer component; child boxes are measured together.",
      );
    }
    const applied = applyElementDesign(element, slot.design);
    element = applied.element;
    fields[element.id] = {
      ownedPaths: applied.ownedPaths,
      bindings: Object.fromEntries(
        Object.entries(applied.bindings).map((
          [field, attribute],
        ) => [field, { sourceId: slot.wrapper.id, attribute }]),
      ),
    };
    for (const [field, value] of Object.entries(declaration.properties)) {
      if (!geometry.has(field) && !shape.has(field) && !generic.has(field)) {
        if (field in slot.design.properties) {
          fail(
            "AMBIGUOUS_DESIGN_OWNERSHIP",
            "A KPI and role declare the same native visual field.",
          );
        }
        element[field] = value;
        fields[element.id].ownedPaths.push(field);
        // Inherited typography affects several slots, so a child's inverse is ambiguous.
      }
    }
    elements.push(element);
    // Keep the ordinary inline paragraph source path: validation classifies
    // the source-bound rendered value as computed, without a fake chunk.
    origins[element.id] = { origin: "authored", sourceId: slot.paragraph.id };
  }
  // A valid source baseline keeps normal flow. Only a baseline refusal may
  // use retained typography with fresh HTML; unsafe saved styles remain final
  // composed diagnostics rather than new initial-source refusals.
  const geometryOwned = [...geometry].some((field) =>
    field in declaration.properties
  );
  const text = elements.slice(1);
  const measured = await measureNativeText(text, appearance?.resources);
  let appearanceRescued = false;
  const retained = text.map((element) => {
    const saved = appearance?.elements.get(element.id);
    if (!saved || saved.id !== element.id || saved.type !== "text") {
      return undefined;
    }
    const effective = { ...element };
    for (const field of typography) {
      if (fields[element.id].ownedPaths.includes(field)) continue;
      if (Object.hasOwn(saved, field)) effective[field] = saved[field];
      else delete effective[field];
    }
    return effective;
  });
  let retainedMeasurements: NativeTextMeasurement[] | undefined;
  async function effectiveMeasurements(): Promise<NativeTextMeasurement[]> {
    return retainedMeasurements ??= await measureNativeText(
      text.map((element, index) => retained[index] ?? element),
      appearance?.resources,
    );
  }
  async function rescue(index: number): Promise<boolean> {
    const effective = retained[index];
    if (!effective) return false;
    const measurement = (await effectiveMeasurements())[index];
    return !unsupportedTypography(effective, measurement) &&
      measurement.width <= Number(effective.w) + 1;
  }
  for (const [index, element] of text.entries()) {
    if (unsupportedTypography(element, measured[index])) {
      if (await rescue(index)) appearanceRescued = true;
      else {fail(
          "KPI_TYPOGRAPHY_UNSUPPORTED",
          "KPI font bounds exceed the native line boxes or overlap adjacent lines; increase explicit line-height, or center a single-line role with enough space. A taller top/bottom-aligned box alone cannot correct glyph overhang.",
        );}
    }
    if (measured[index].width > Number(element.w) + 1) {
      if (await rescue(index)) appearanceRescued = true;
      else {fail(
          "KPI_CONTENT_OVERFLOW",
          "A KPI glyph or inline token exceeds its final width; increase the frame or explicitly change typography.",
        );}
    }
    element.y = y;
    element.h = measured[index].height;
    y += Number(element.h) + 16;
  }
  if (frame.w <= 48 || y - 16 > frame.y + frame.h - 24 + .01) {
    // Unowned frame capacity can use verified saved typography for every role.
    // Source-coupled geometry remains strict, and baseline boxes stay unchanged:
    // the consumer preserves saved geometry and checks the actual composed boxes.
    let fitsRetained = false;
    if (
      !geometryOwned && !sourceFrameOwned && frame.w > 48 &&
      retained.every(Boolean)
    ) {
      const measurements = await effectiveMeasurements();
      const height = measurements.reduce((sum, result) =>
        sum + result.height, 0) +
        48 + 16 * (text.length - 1);
      fitsRetained = height <= frame.h + .01 &&
        retained.every((element, index) =>
          element && !unsupportedTypography(element, measurements[index]) &&
          measurements[index].width <= Number(element.w) + 1
        );
    }
    if (fitsRetained) appearanceRescued = true;
    else {fail(
        "KPI_CONTENT_OVERFLOW",
        "KPI text exceeds the frame; increase the dimensions or explicitly change typography. Automatic shrink and clipping refuse.",
      );}
  }
  for (const element of elements) {
    if (geometryOwned) fields[element.id].ownedPaths.push(...geometry);
    for (const field of generic) {
      if (field in declaration.properties) {
        element[field] = declaration.properties[field];
        fields[element.id].ownedPaths.push(field);
        // Parent effects are coupled and deliberately have no single-child binding.
      }
    }
  }
  return { elements, origins, fields, appearanceRescued };
}
/** Diagnose the actual composed text, preserving the owner's saved geometry. */
export async function kpiReadabilityDiagnostics(
  source: SourceDocument,
  document: BentoDoc,
): Promise<Diagnostic[]> {
  const targets: { element: Element; slideId: string }[] = [];
  for (
    const block of source.blocks.filter((block) =>
      block.kind === "div" && sourceComponentClass(block.raw) === ".bento-kpi"
    )
  ) {
    const binding = kpiSource(source, block.id);
    for (const slot of binding.slots) {
      for (const slide of document.slides) {
        const element = slide.elements.find((element) =>
          element.id === slot.paragraph.id
        );
        if (element) targets.push({ element, slideId: slide.id });
      }
    }
  }
  const measurements = await measureNativeText(
    targets.map((target) => target.element),
    document,
  );
  return targets.flatMap(({ element, slideId }, index) =>
    element.type !== "text" ||
      unsupportedTypography(element, measurements[index]) ||
      measurements[index].height > Number(element.h) + .01 ||
      measurements[index].width > Number(element.w) + 1
      ? [{
        code: "KPI_CONTENT_OVERFLOW",
        message:
          `Saved KPI text ${element.id} exceeds its native box or line metrics; increase dimensions or line-height, or use suitable single-line alignment. Saved geometry is not adjusted automatically. Saved design and pending content remain retained.`,
        elementId: element.id,
        slideId,
      }]
      : []
  );
}
