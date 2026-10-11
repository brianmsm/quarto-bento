import { measureNativeText } from "../src/render/measure.ts";
import type { BentoDoc } from "../src/render/types.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("Pinned native browser measurement matches wide glyph, accents, rich code and explicit breaks", async () => {
  const results = await measureNativeText([
    {
      id: "wide",
      type: "text",
      html: "WWWW",
      w: 150,
      fontSize: 52,
      fontFamily: "Arial",
      fontWeight: 700,
      lineHeight: 1.25,
    },
    {
      id: "rich",
      type: "text",
      html: "WWWW <code>12345</code><br>Éxito.",
      w: 150,
      fontSize: 52,
      fontFamily: "Arial",
      fontWeight: 700,
      lineHeight: 1.25,
    },
  ]);
  assert(results[0].height === 134, JSON.stringify(results));
  assert(
    results[1].height > 300 && results[1].height < 400,
    JSON.stringify(results),
  );
  assert(results.every((row) => row.width <= 150));
});

Deno.test("native text metrics load persisted built-in font faces before measuring", async () => {
  const element = {
    id: "font-alias",
    type: "text",
    html: "iiiiiiiiiiiiiiiiiiii",
    w: 120,
    fontSize: 52,
    fontFamily: "KpiBuiltinAlias",
    fontWeight: 900,
    lineHeight: 1.25,
  };
  const fallback = await measureNativeText([element]);
  const embedded = await measureNativeText(
    [element],
    {
      fonts: [{
        family: "KpiBuiltinAlias",
        asset: "builtin:fraunces-900",
        weight: "900",
      }],
    } as unknown as BentoDoc,
  );
  assert(
    fallback[0].height === 199 && embedded[0].height === 264,
    JSON.stringify({ fallback, embedded }),
  );
});

Deno.test("native text measurement refuses unfaithful automatic math and document fields", async () => {
  for (
    const html of [
      "$$x^2$$",
      "$x$",
      "\\(x\\)",
      "\\[x\\]",
      "{{page}}",
      "{{ title }}",
      "<code>{{date:yyyy}}</code>",
      "&#36;&#36;x&#36;&#36;",
      "&#123;&#123;page&#125;&#125;",
      '<a href="https://example.org/{{page}}">Click</a>',
    ]
  ) {
    let refused = false;
    try {
      await measureNativeText([{
        id: "transform",
        type: "text",
        html,
        w: 200,
        fontSize: 26,
      }]);
    } catch (error) {
      refused = String(error).includes("NATIVE_TEXT_TRANSFORM_UNSUPPORTED");
    }
    assert(refused, html);
  }
});
