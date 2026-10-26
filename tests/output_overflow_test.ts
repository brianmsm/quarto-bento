import { scanSource } from "../src/source/mod.ts";
import {
  outputOverflowDiagnostics,
  outputOverflowOption,
  outputOverflowTargets,
} from "../src/render/output-overflow.ts";
import { targetKey } from "../src/state/mod.ts";

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
