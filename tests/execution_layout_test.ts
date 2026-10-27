import {
  executionFrames,
  executionLayout,
  executionUnits,
} from "../src/render/execution-layout.ts";
import { scanSource } from "../src/source/mod.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function option(text: string) {
  return executionLayout(
    scanSource("## Slide {#slide}\n\n```{r}\n" + text + "\nprint(1)\n```\n")
      .blocks.find((block) => block.kind === "chunk")!,
  );
}
Deno.test("execution layout validates original scalar options and preserves unsupported raw output", () => {
  const layout = option(
    "#| output-location: column\n#| bento-code-width: 40\n#| layout-ncol: 2",
  );
  assert(
    layout.location === "column" && layout.codeWidth === 40 &&
      layout.columns === 2,
  );
  for (
    const text of [
      "#| output-location: fragment",
      "#| layout-ncol: 0",
      "#| layout-ncol: !expr 2",
      "#| bento-code-width: 91",
      "#| bento-code-width: 9",
      "#| layout-ncol: 2\n#| layout-ncol: 3",
    ]
  ) {
    let refused = false;
    try {
      option(text);
    } catch (error) {
      refused = String(error).includes("EXECUTION_LAYOUT");
    }
    assert(refused, text);
  }
  const bodyOption = scanSource(
    '## Slide {#slide}\n\n```{r}\nx <- "text"\n#| output-location: fragment\n```\n',
  ).blocks.find((block) => block.kind === "chunk")!;
  assert(
    executionLayout(bodyOption).location === "default",
    "A code-body comment is not a chunk option",
  );
  const units = executionUnits([{
    t: "RawBlock",
    c: ["html", "<script>unreviewed()</script>"],
  }]);
  assert(
    units.length === 1,
    "Unknown raw output must still reach the rejecting renderer",
  );
});
Deno.test("execution layout reserves code height and divides only flexible figure rows", () => {
  const code = { t: "CodeBlock", c: [["", ["cell-code"], []], "plot(1:3)"] };
  const image = { t: "Para", c: [] };
  const units = [{ node: code, code: true }, { node: image, code: false }];
  const frames = executionFrames(units, option(""), {
    x: 10,
    y: 20,
    w: 500,
    h: 400,
  }, (node) => node === code ? 90 : -1);
  assert(frames[0].h === 90 && frames[1].h === 290 && frames[1].y === 130);
  let refused = false;
  try {
    executionFrames(
      units,
      option(""),
      { x: 0, y: 0, w: 500, h: 100 },
      (node) => node === code ? 90 : -1,
    );
  } catch (error) {
    refused = String(error).includes("EXECUTION_CONTENT_OVERFLOW");
  }
  assert(refused);
});

Deno.test("mixed figure grid rows reserve fixed-content minima and measure each unit once", () => {
  const text = { t: "CodeBlock", c: [["", [], []], "stdout"] };
  const figures = Array.from({ length: 3 }, () => ({ t: "Para", c: [] }));
  const units = [text, ...figures].map((node) => ({ node, code: false }));
  let calls = 0;
  const frames = executionFrames(
    units,
    option("#| layout-ncol: 2"),
    { x: 0, y: 0, w: 1120, h: 504 },
    (node) => {
      calls++;
      return node === text ? 330 : -1;
    },
  );
  assert(calls === units.length);
  assert(frames[0].h >= 330 && frames[1].h === frames[0].h);
  assert(frames[2].y >= frames[0].y + frames[0].h + 20);
  assert(frames[2].h >= 100 && frames[2].y + frames[2].h <= 504);
  let refused = false;
  try {
    executionFrames(
      units,
      option("#| layout-ncol: 2"),
      { x: 0, y: 0, w: 1120, h: 400 },
      (node) => node === text ? 330 : -1,
    );
  } catch (error) {
    refused = String(error).includes("EXECUTION_CONTENT_OVERFLOW");
  }
  assert(
    refused,
    "An impossible mixed row must not overlap or shrink its text",
  );
});
