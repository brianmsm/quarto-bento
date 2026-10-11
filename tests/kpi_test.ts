import { kpiSource } from "../src/source/kpi.ts";
import { scanSource } from "../src/source/mod.ts";
import { projectKpi } from "../src/render/kpi.ts";
import { parseDesignAttributes } from "../src/render/design.ts";
import { assertBentoContract } from "../src/render/validate.ts";
import type { Ast, Node } from "../src/render/types.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const literal = `## Metric {#slide}

:::: {#metric .bento-kpi}
::: {#label bento-role="label"}
Observed effect
:::
::: {#value bento-role="value"}
β = .32
:::
::: {#detail bento-role="detail"}
IC 95% [.18, .47]
:::
::::
`;
function nodes(source: ReturnType<typeof kpiSource>): Node[] {
  return source.slots.map((slot) => ({
    t: "Div",
    c: [slot.attr, [{
      t: "Para",
      c: [{ t: "Str", c: slot.paragraph.content }],
    }]],
  }));
}
Deno.test("KPI original-source role slots require globally unique IDs, exact order and literal labels", async () => {
  const binding = kpiSource(scanSource(literal), "metric");
  const twoSlots = literal.replace(/::: \{#detail[^}]*\}\n[^\n]*\n:::\n/, "");
  assert(kpiSource(scanSource(twoSlots), "metric").slots.length === 2);
  const stale = scanSource(literal);
  stale.text += "\n";
  await refuses(() => kpiSource(stale, "metric"), "KPI_SOURCE_CHANGED");
  assert(
    binding.slots.map((slot) => slot.role).join() === "label,value,detail",
  );
  assert(binding.slots[1].paragraph.id === "value/paragraph:1");
  assert(parseDesignAttributes(binding.attr).component === "kpi");
  for (
    const [source, code] of [
      [literal.replace("#metric ", ""), "KPI_SOURCE_IDENTITY"],
      [literal.replace("#label ", ""), "KPI_SLOT_STRUCTURE"],
      [literal.replace("#detail ", "#label "), "KPI_SOURCE_IDENTITY"],
      [
        literal.replace('bento-role="label"', 'bento-role="value"'),
        "KPI_SLOT_ROLE",
      ],
      [
        literal.replace('bento-role="value"', 'bento-role="other"'),
        "KPI_SLOT_ROLE",
      ],
      [
        literal.replace(
          'bento-role="label"',
          'bento-role="label" bento-role="detail"',
        ),
        "KPI_SLOT_ROLE",
      ],
      [
        literal.replace("Observed effect", "`r 42`"),
        "KPI_LITERAL_ROLE_REQUIRED",
      ],
      [
        literal.replace(
          "Observed effect",
          "Observed effect\n\nSecond paragraph.",
        ),
        "KPI_SLOT_PARAGRAPH",
      ],
      [
        literal.replace(
          'bento-role="label"',
          'bento-role="label" foo="ignored"',
        ),
        "KPI_SLOT_ATTRIBUTE",
      ],
      [
        literal.replace("β = .32", "{{< var value >}}"),
        "KPI_INLINE_SOURCE_UNSUPPORTED",
      ],
    ]
  ) {
    await refuses(() =>
      kpiSource(
        scanSource(source),
        source.includes("#metric ") ? "metric" : "div@22",
      ), code);
  }
});
Deno.test("KPI native projection preserves exact literal value, role typography and validated authored background", async () => {
  const source = scanSource(literal), binding = kpiSource(source, "metric");
  const result = await projectKpi(source, binding.attr, nodes(binding), {
    x: 80,
    y: 166,
    w: 1120,
    h: 470,
  });
  assert(
    result.elements.map((el) => el.id).join() ===
      "metric/qb-kpi-background,label/paragraph:1,value/paragraph:1,detail/paragraph:1",
  );
  assert(
    result.elements.slice(1).map((el) => el.fontSize).join() === "26,52,22",
  );
  assert(result.elements[2].html === "β = .32" && !result.elements[2].fx);
  assert(result.elements.every((el) => el.groupId === "metric"));
  const ast: Ast = {
    meta: {},
    blocks: [{
      t: "Header",
      c: [2, ["slide", [], []], [{ t: "Str", c: "Metric" }]],
    }, { t: "Div", c: [binding.attr, nodes(binding)] }],
  };
  const projection = validateProjectionOrigins(
    source,
    await projectAst(ast, "kpi-contract", [], source),
  );
  assertBentoContract(projection.document);
  assert(projection.origins.slide["metric/qb-kpi-background"].designOnly);
  await refuses(
    () =>
      projectKpi(source, binding.attr, [...nodes(binding)].reverse(), {
        x: 80,
        y: 166,
        w: 1120,
        h: 470,
      }),
    "KPI_EXECUTION_MISMATCH",
  );
  const wrongGroup = structuredClone(projection);
  wrongGroup.document.slides[0].elements[1].groupId = "unrelated";
  await refuses(
    () => validateProjectionOrigins(source, wrongGroup),
    "UNMAPPED_COMPONENT_DESIGN",
  );
  const forged = structuredClone(projection);
  forged.document.slides[0].elements[1].id = "metric/fake-background";
  delete forged.origins.slide["metric/qb-kpi-background"];
  forged.origins.slide["metric/fake-background"] = {
    origin: "authored",
    sourceId: "metric",
    designOnly: true,
  };
  await refuses(
    () => validateProjectionOrigins(source, forged),
    "UNMAPPED_COMPONENT_DESIGN",
  );
});
