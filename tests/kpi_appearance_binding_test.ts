import {
  preserveRescuedKpiGeometry,
  retainedKpiAppearances,
} from "../src/core/kpi-appearance.ts";
import { scanSource } from "../src/source/mod.ts";
import { kpiSource } from "../src/source/kpi.ts";
import {
  canonical,
  clone,
  createState,
  type ProvenanceMap,
  targetKey,
} from "../src/state/mod.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
const text = `## A {#a}

:::: {#metric .bento-kpi}
::: {#label bento-role="label"}
Participants
:::
::: {#value bento-role="value"}
123
:::
::::

## B {#b}
`;
function fixture() {
  const source = scanSource(text), binding = kpiSource(source, "metric");
  const background = {
    id: "metric/qb-kpi-background",
    type: "shape",
    shape: "rect",
    groupId: "metric",
    x: 80,
    y: 160,
    w: 1120,
    h: 470,
  };
  const elements = binding.slots.map((slot) => ({
    id: slot.paragraph.id,
    type: "text",
    groupId: "metric",
    html: slot.paragraph.content,
    x: 104,
    y: 200,
    w: 1072,
    h: 100,
    lineHeight: 1.6,
  }));
  const provenance: ProvenanceMap = {
    [targetKey({ slideId: "a", elementId: background.id })]: {
      origin: "authored",
      semanticId: "metric",
      source: {
        kind: "div",
        blockId: "metric",
        hash: source.hash,
        stable: true,
      },
    },
  };
  for (const slot of binding.slots) {
    provenance[targetKey({ slideId: "a", elementId: slot.paragraph.id })] = {
      origin: "authored",
      semanticId: slot.paragraph.id,
      source: {
        kind: "paragraph",
        blockId: slot.paragraph.id,
        parentId: slot.wrapper.id,
        siblings: 1,
        hash: source.hash,
      },
    };
  }
  const state = createState({
    docId: "appearance-binding",
    slides: [
      { id: "a", elements: [background, ...elements] },
      // Morph can repeat a native identity on another slide. It is not this role.
      {
        id: "b",
        elements: elements.map((element) => ({
          ...element,
          x: 999,
          lineHeight: .01,
          html: "foreign",
        })),
      },
    ],
  }, provenance);
  return { source, state, valueId: elements[1].id };
}
Deno.test("retained KPI appearance requires the exact source role receipt on its slide", () => {
  const { source, state, valueId } = fixture();
  const before = canonical(state);
  const appearances = retainedKpiAppearances(state, source);
  eq([...appearances.keys()], ["a"]);
  eq(appearances.get("a")!.elements.get(valueId)!.lineHeight, 1.6);
  appearances.get("a")!.elements.get(valueId)!.x = 777;
  eq(canonical(state), before);
  const key = targetKey({ slideId: "a", elementId: valueId });
  for (
    const field of [
      "origin",
      "semanticId",
      "kind",
      "blockId",
      "parentId",
      "siblings",
      "hash",
      "nativeType",
      "missing",
    ]
  ) {
    const changed = clone(state), proof = changed.provenance[key];
    const slide = changed.emitted.slides[0];
    if (field === "origin") proof.origin = "detached";
    else if (field === "semanticId") proof.semanticId = "foreign";
    else if (field === "nativeType") {
      slide.elements.find((el) => el.id === valueId)!.type = "shape";
    } else if (field === "missing") {
      slide.elements = slide.elements.filter((el) => el.id !== valueId);
    } else proof.source![field] = field === "siblings" ? 2 : "foreign";
    eq(
      retainedKpiAppearances(changed, source).get("a")?.elements.has(valueId),
      false,
    );
    eq(retainedKpiAppearances(changed, source).has("b"), false);
  }
  eq(
    retainedKpiAppearances(
      state,
      scanSource(text.replace("## A {#a}", "## A {#c}")),
    ).size,
    0,
  );
});
Deno.test("rescued KPI geometry stays a scoped visual overlay and respects fresh source ownership", () => {
  const { source, state, valueId } = fixture();
  const appearances = retainedKpiAppearances(state, source);
  const before = clone(state);
  const target = { slideId: "a", elementId: valueId }, key = targetKey(target);
  preserveRescuedKpiGeometry(state, appearances, [{
    slideId: "a",
    elementIds: [valueId],
  }], { [key]: ["x", "w", "color"] });
  eq(state.emitted, before.emitted);
  eq(state.generatedBaseline, before.generatedBaseline);
  eq(state.provenance, before.provenance);
  eq(state.overrides, [{
    target,
    fields: [
      { path: ["y"], value: { present: true, value: 200 } },
      { path: ["h"], value: { present: true, value: 100 } },
    ],
  }]);
  const wrongSlide = clone(before);
  preserveRescuedKpiGeometry(wrongSlide, appearances, [{
    slideId: "b",
    elementIds: [valueId],
  }], {});
  eq(wrongSlide, before);
});
