import {
  mathToNativeHtml,
  nativeDisplayMathToSource,
  parseNativeDisplayMath,
} from "../src/render/math.ts";
import { canonical, StateError } from "../src/state/mod.ts";
import { applyPatches, previewPatches, scanSource } from "../src/source/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function refuses(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof StateError && error.code === "UNSUPPORTED_MATH") {
      return;
    }
    throw error;
  }
  throw new Error("Expected UNSUPPORTED_MATH");
}
const examples = [
  "E = mc^2",
  String.raw`\frac{\alpha + x^{2}}{1 + \sqrt{y}}`,
  String.raw`\sum_{i=1}^{n} x_i \leq \infty`,
  String.raw`\left(\frac{a}{b}\right)^2`,
  String.raw`\text{Málaga: a < b & c > d, "x"} + \$5`,
  String.raw`\begin{aligned}a &= b \\` + "\n" + String.raw`c &= d\end{aligned}`,
  String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`,
  String.raw`x^{{2}} + \{a\}`,
];
Deno.test("display math stores escaped literal LaTeX and preserves a bounded standalone expression", () => {
  for (const tex of examples) {
    const html = mathToNativeHtml(tex);
    eq(parseNativeDisplayMath(html).tex, tex);
    eq(parseNativeDisplayMath(html).html, html);
    eq(parseNativeDisplayMath(html).normalized, false);
    eq(nativeDisplayMathToSource(html), `$$\n${tex}\n$$`);
    eq(
      parseNativeDisplayMath(
        String.raw`\[` + html.slice(2, -2) + String.raw`\]`,
      ).tex,
      tex,
    );
  }
  eq(
    mathToNativeHtml(String.raw`\text{<script>alert("x")</script>}`),
    "$$\\text{&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;}$$",
  );
  eq(parseNativeDisplayMath("$$x &lt; y + z$$").tex, "x < y + z");
  eq(parseNativeDisplayMath("$$&#x03B1; + &#946;$$").tex, "α + β");
});
Deno.test("native editor line breaks remain one formula with balanced attribute-free markup", () => {
  const tex = String.raw`\begin{aligned}a &= b \\` + "\n" +
    String.raw`c &= d\end{aligned}`;
  for (
    const html of [
      "<div>" + mathToNativeHtml(tex) + "</div>",
      "<p>" + mathToNativeHtml(tex).replace("<br>", "</p><p>") + "</p>",
      mathToNativeHtml(tex).replace("<br>", "<div>") + "</div>",
    ]
  ) eq(parseNativeDisplayMath(html).tex, tex);
  eq(
    parseNativeDisplayMath(" <div>$$</div><div>x^2</div><div>$$</div> ").tex,
    "x^2",
  );
  eq(parseNativeDisplayMath("$$\r\nx^2\r\n$$").normalized, true);
});
Deno.test("display math refuses HTML injection, additional prose and expanded source structure", () => {
  for (
    const html of [
      "",
      "$x$",
      "text $$x$$",
      "$$x$$ text",
      "$$x$$ $$y$$",
      "$$x$$<br>$$y$$",
      "$$x<b>2</b>$$",
      "<math><mi>x</mi></math>",
      "$$x<img src='x'>$$",
      '<div onclick="x()">$$x$$</div>',
      "$$x<div>y</p>$$",
      "<div><div>$$x$$</div></div>",
      "$$x<br><p>y</p><div>z$$</div>",
      "$$x</div>$$",
      "<div>$$x$$",
      "$$x &invalid;$$",
      "$$x &amp$$",
      "$$&#0;$$",
      "$$&#xD800;$$",
      "$$&#1114112;$$",
      "$$x$$\n```{r}\nstop('no')\n```\n$$z$$",
      String.raw`\[x\] \[y\]`,
      String.raw`$$\(x\)$$`,
      String.raw`$$\[x\]$$`,
    ]
  ) refuses(() => parseNativeDisplayMath(html));
});
Deno.test("display math refuses incomplete or unsupported LaTeX instead of guessing", () => {
  for (
    const tex of [
      "",
      " ",
      "x{",
      "x}",
      "x^",
      "x__1",
      "x & y",
      String.raw`\left({a\right)}`,
      String.raw`{\left(a}\right)`,
      String.raw`\begin{matrix}\frac{a&b}{c}\end{matrix}`,
      String.raw`\begin{matrix}\left(a&b\right)\end{matrix}`,
      "^2",
      String.raw`\frac{x}`,
      String.raw`\frac{x}{}`,
      String.raw`\sqrt[3]{x}`,
      String.raw`\left(x`,
      String.raw`x\right)`,
      String.raw`\left x`,
      String.raw`\begin{matrix}x\end{aligned}`,
      String.raw`\begin{matrix}x`,
      String.raw`\end{matrix}`,
      String.raw`\begin{unknown}x\end{unknown}`,
      String.raw`x \\ y`,
      String.raw`\href{javascript:alert(1)}{x}`,
      String.raw`\input{file}`,
      String.raw`\newcommand{\x}{1}`,
      "typst: a/b",
      "{{page}}",
      "{{ title }}",
      "{{date:YYYY}}",
      "{{< var value >}}",
      "{{% include /tmp/file %}}",
      "x $ y",
      "x % comment",
      "x\\",
      "x\u0000",
      "x\uE000",
      "x\uD800",
      "x\u00a0y",
      "`r stop('no')`",
      "x".repeat(16_001),
      "x\n".repeat(17),
      "{".repeat(65) + "x" + "}".repeat(65),
    ]
  ) refuses(() => mathToNativeHtml(tex));
  refuses(() => mathToNativeHtml("x", false));
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "display codec matches installed Pandoc math AST and yields bounded UTF-8/CRLF body patches",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-math-codec-" });
    try {
      const path = dir + "/cases.qmd";
      await Deno.writeTextFile(
        path,
        examples.map((tex) => nativeDisplayMathToSource(mathToNativeHtml(tex)))
          .join("\n\n"),
      );
      const output = await new Deno.Command("quarto", {
        args: ["pandoc", "--from", "markdown", "--to", "json", path],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
      }
      const ast = JSON.parse(new TextDecoder().decode(output.stdout));
      eq(ast.blocks.length, examples.length);
      for (const [index, block] of ast.blocks.entries()) {
        eq(block.t, "Para");
        eq(block.c.length, 1);
        eq(block.c[0].t, "Math");
        eq(block.c[0].c[0].t, "DisplayMath");
        eq(block.c[0].c[1], `\n${examples[index]}\n`);
        eq(
          mathToNativeHtml(block.c[0].c[1]),
          mathToNativeHtml(examples[index]),
        );
      }
      const source =
        "## Fórmula {#formula}\r\n\r\n<!-- qb:eq-main -->\r\n$$\r\nx^2\r\n$$\r\n\r\n## Tail {#tail}\r\n\r\nUnchanged.\r\n";
      const mapped = scanSource(source);
      const block = mapped.blocks.find((block) => block.kind === "math")!;
      const edited = parseNativeDisplayMath("$$\\frac{α + x^{2}}{1 + y}$$");
      const plan = previewPatches(mapped, [{
        blockId: block.id,
        expected: block.content,
        replacement: edited.tex,
      }]);
      eq(plan.result, source.replace("x^2\r\n", edited.tex + "\r\n"));
      eq(applyPatches(source, plan), plan.result);
      eq(
        scanSource(plan.result).blocks.filter((block) => block.kind === "math")
          .length,
        1,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "real Quarto execution keeps an authored display formula inside its explicit source anchor",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-math-quarto-" });
    try {
      const tex = String.raw`\frac{\alpha + x^{2}}{1 + \sqrt{y}}`;
      await Deno.writeTextFile(
        dir + "/deck.qmd",
        "## Formula {#formula}\n\n::: {#equation}\n\n<!-- qb:eq-main -->\n" +
          nativeDisplayMathToSource(mathToNativeHtml(tex)) + "\n\n:::\n",
      );
      await Deno.writeTextFile(
        dir + "/capture.lua",
        'function Pandoc(doc) local f = assert(io.open("executed.json", "w")); f:write(pandoc.write(doc, "json")); f:close(); return doc end',
      );
      const output = await new Deno.Command("quarto", {
        cwd: dir,
        env: { XDG_CACHE_HOME: dir + "/cache" },
        args: [
          "render",
          "deck.qmd",
          "--to",
          "html",
          "--lua-filter",
          "capture.lua",
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
      }
      const ast = JSON.parse(await Deno.readTextFile(dir + "/executed.json"));
      const anchored = ast.blocks.find((block: { t: string; c: unknown[][] }) =>
        block.t === "Div" && block.c[0][0] === "equation"
      );
      if (!anchored) {
        throw new Error("Executed math lost its explicit source anchor.");
      }
      const paragraphs = anchored.c[1].filter((block: { t: string }) =>
        block.t === "Para"
      );
      eq(paragraphs.length, 1);
      eq(paragraphs[0].c.length, 1);
      const math = paragraphs[0].c[0];
      eq(math.t, "Math");
      eq(math.c[0].t, "DisplayMath");
      eq(mathToNativeHtml(math.c[1]), mathToNativeHtml(tex));
      const block = scanSource(await Deno.readTextFile(dir + "/deck.qmd"))
        .blocks.find((block) => block.kind === "math")!;
      eq(block.stable, true);
      eq(block.origin, "authored");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
