import { scanSource } from "../src/source/mod.ts";
import {
  outputOverflowDiagnostics,
  outputOverflowOption,
  outputOverflowTargets,
  outputViewportHeight,
} from "../src/render/output-overflow.ts";
import { targetKey } from "../src/state/mod.ts";
import { projectComponent } from "../src/render/components.ts";
import { parseDesignAttributes } from "../src/render/design.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function source(options: string) {
  return scanSource(
    "## Result {#result}\n\n```{r}\n#| label: results\n" + options +
      "print(1)\n```\n",
  );
}
Deno.test("overflow options require explicit literal original producer metadata", () => {
  const original = source(
    "#| bento-overflow: scroll\n#| bento-overflow-height: 180\n",
  );
  const producer = original.blocks.find((block) => block.kind === "chunk")!.id;
  assert(outputOverflowOption(original, producer)?.height === 180);
  assert(outputOverflowOption(original, "unknown") === undefined);
  assert(
    outputOverflowOption(source("#| bento-overflow: scroll\n"), producer)
      ?.height === 240,
  );
  for (const height of [80, 600]) {
    const bounded = source(
      `#| bento-overflow: scroll\n#| bento-overflow-height: ${height}\n`,
    );
    assert(outputViewportHeight(bounded, producer, 1200) === height);
    assert(outputViewportHeight(bounded, producer, 60) === 60);
  }
  assert(outputOverflowOption(source(""), producer) === undefined);
  for (
    const options of [
      "#| bento-overflow: auto\n",
      "#| bento-overflow: !expr 'scroll'\n",
      "#| bento-overflow-height: 180\n",
      "#| bento-overflow: scroll\n#| bento-overflow-height: 79\n",
      "#| bento-overflow: scroll\n#| bento-overflow-height: 601\n",
      "#| bento-overflow: scroll\n#| bento-overflow: scroll\n",
    ]
  ) {
    let failed = false;
    try {
      const invalid = source(options);
      outputOverflowOption(invalid, producer);
    } catch (error) {
      failed = String(error).includes("INVALID_OUTPUT_OVERFLOW");
    }
    assert(failed, options);
  }
  const literal = scanSource(
    "## Result {#result}\n\n```{r}\n#| label: results\nx <- 1\n#| bento-overflow: scroll\n```\n",
  );
  assert(outputOverflowOption(literal, producer) === undefined);
});

Deno.test("scroll targets retain computed provenance and suppress only their clipping diagnostics", () => {
  const original = source("#| bento-overflow: scroll\n");
  const producer = original.blocks.find((block) => block.kind === "chunk")!.id;
  const targets = outputOverflowTargets(original, {
    [targetKey({ slideId: "result", elementId: "code" })]: {
      origin: "computed",
      producer,
    },
    [targetKey({ slideId: "result", elementId: "detached" })]: {
      origin: "detached",
      producer,
    },
  }, {
    slides: [{
      id: "result",
      elements: [
        { id: "code", type: "code" },
        { id: "detached", type: "code" },
        { id: "authored", type: "code" },
      ],
    }],
  });
  assert(targets.length === 1 && targets[0].elementId === "code");
  const diagnostics = outputOverflowDiagnostics([
    {
      code: "TEXT_OVERFLOW",
      slideId: "result",
      elementId: "code",
      message: "",
    },
    {
      code: "TEXT_OVERFLOW",
      slideId: "result",
      elementId: "other",
      message: "",
    },
    { code: "OVERFLOW", slideId: "result", elementId: "code", message: "" },
  ], targets);
  assert(diagnostics.length === 2);
});

Deno.test("component natural code validation exempts only explicitly measured scroll identities", () => {
  const code = {
    id: "output",
    type: "code" as const,
    x: 0,
    y: 0,
    w: 400,
    h: 80,
    content: "line1\nline2\nline3\nline4",
    fontSize: 24,
    lineHeight: 1.25,
  };
  const declaration = parseDesignAttributes(["panel", ["bento-card"], []]);
  const measured = { fixed: new Set(["output"]), omitted: new Set<string>() };
  for (const viewports of [undefined, new Set(["other"])]) {
    let refused = false;
    try {
      projectComponent(
        [[code]],
        declaration,
        { x: 0, y: 0, w: 448, h: 128 },
        {},
        {},
        { ...measured, viewports },
      );
    } catch (error) {
      refused = String(error).includes("COMPONENT_CONTENT_OVERFLOW");
    }
    assert(
      refused,
      "Natural or unrelated code must retain its complete-content gate",
    );
  }
  const projected = projectComponent(
    [[code]],
    declaration,
    { x: 0, y: 0, w: 448, h: 128 },
    {},
    {},
    { ...measured, viewports: new Set(["output"]) },
  );
  const output = projected.elements.find((element) => element.id === "output")!;
  assert(
    output.h === 80 && output.fontSize === 24 &&
      output.content === code.content,
  );
});
