import { textOverflowDiagnostics } from "../src/render/text-overflow.ts";
import { designTheme } from "../src/render/design.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function doc(elements: Element[]): BentoDoc {
  return {
    format: "bento/slides",
    version: 1,
    docId: "native-overflow-test",
    title: "Bounds",
    size: { width: 1280, height: 720 },
    theme: designTheme(),
    slides: [{
      id: "slide",
      background: "#fff",
      transition: "fade",
      notes: "",
      elements,
    }],
  };
}
function text(
  id: string,
  html: string,
  fields: Record<string, number | string> = {},
): Element {
  return {
    id,
    type: "text",
    x: 80,
    y: 80,
    w: 300,
    h: 80,
    fontSize: 26,
    fontWeight: 400,
    lineHeight: 1.2,
    align: "left",
    valign: "top",
    color: "#000",
    html,
    ...fields,
  };
}
Deno.test("native content bounds detect wrapped text, code clipping, lists and math while preserving the document", async () => {
  const original = doc([
      text("short", "A short <b>finding</b>."),
      text(
        "long",
        "A longer conclusion with additional participants and confidence intervals. "
          .repeat(10),
      ),
      text("centered", "Long text with several lines. ".repeat(8), {
        valign: "middle",
        h: 40,
      }),
      text(
        "list",
        "<ul><li>First finding</li><li>Second finding</li><li>Third finding</li></ul>",
        { h: 30 },
      ),
      text("math", "$$\\frac{x^{2}+1}{y^{2}+1}$$", { h: 5 }),
      {
        id: "code",
        type: "code",
        x: 80,
        y: 80,
        w: 60,
        h: 20,
        fontSize: 20,
        lineHeight: 1.2,
        align: "left",
        valign: "top",
        color: "#000",
        fontFamily: "monospace",
        language: "r",
        content: "a_really_long_variable <- 100\nprint(a_really_long_variable)",
      },
      text("rotated", "Content", { rotation: 45 }),
      text("field", "Page {{page}}"),
    ]),
    before = JSON.stringify(original);
  const result = await textOverflowDiagnostics(original);
  assert(
    JSON.stringify(original) === before,
    "Measurement changed native document",
  );
  const warnings = result.filter((d) => d.code === "TEXT_OVERFLOW").map((d) =>
    d.elementId
  );
  assert(
    warnings.sort().join() ===
      ["long", "centered", "list", "math", "code"].sort().join(),
    JSON.stringify(result),
  );
  assert(
    result.filter((d) => d.code === "TEXT_MEASUREMENT_UNAVAILABLE").map((d) =>
      d.elementId
    ).sort().join() === "field,rotated",
    JSON.stringify(result),
  );
  assert(result.every((d) => d.slideId === "slide"));
  const fits = doc([
    text("long", "Shortened."),
    text("list", "<ul><li>One</li></ul>", { h: 150 }),
    text("math", "$$x^2+1$$", { h: 150, valign: "middle" }),
  ]);
  assert(
    !(await textOverflowDiagnostics(fits)).length,
    JSON.stringify(await textOverflowDiagnostics(fits)),
  );
});
Deno.test("native overflow preserves duplicate element IDs in separate slides and invalidates exact snapshot cache", async () => {
  const original = doc([text("shared", "Short.")]);
  original.slides.push({
    id: "other",
    elements: [text("shared", "Long conclusion. ".repeat(100))],
  });
  const first = await textOverflowDiagnostics(original);
  assert(
    first.length === 1 && first[0].slideId === "other",
    JSON.stringify(first),
  );
  first[0].message = "mutated external receipt";
  assert(
    (await textOverflowDiagnostics(original))[0].message !==
      "mutated external receipt",
  );
  original.slides[1].elements[0].html = "Short.";
  assert(
    (await textOverflowDiagnostics(original)).length === 0,
    "Cache ignored edited native snapshot",
  );
});

Deno.test("one invalid native probe does not hide another element's real overflow", async () => {
  const result = await textOverflowDiagnostics(
    doc([
      text("zero-width", "Content", { w: 0 }),
      text("long", "Long conclusion. ".repeat(100)),
    ]),
  );
  assert(
    result.some((d) =>
      d.code === "TEXT_MEASUREMENT_UNAVAILABLE" && d.elementId === "zero-width"
    ),
    JSON.stringify(result),
  );
  assert(
    result.some((d) => d.code === "TEXT_OVERFLOW" && d.elementId === "long"),
    JSON.stringify(result),
  );
});
