import {
  canonicalInlineHtml,
  inlineHtmlToMarkdown,
  renderInline,
} from "../src/render/inline.ts";
import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import type { Node } from "../src/render/types.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (String(e).includes(code) || (e as { code?: string }).code === code) {
      return;
    }
    throw e;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test("native inline vocabulary retains code, case-sensitive href and strikeout", () => {
  const nodes: Node[] = [
    { t: "Code", c: [["", [], []], "fit(x < 2)"] },
    { t: "Space" },
    {
      t: "Link",
      c: [["", [], []], [{ t: "Str", c: "Docs" }], [
        "https://example.org/Case?q=One&b=Two",
        "",
      ]],
    },
    { t: "Space" },
    { t: "Strikeout", c: [{ t: "Str", c: "old" }] },
  ];
  const html =
    '<code>fit(x &lt; 2)</code> <a href="https://example.org/Case?q=One&amp;b=Two">Docs</a> <s>old</s>';
  eq(renderInline(nodes), html);
  eq(canonicalInlineHtml(html), html);
  eq(
    inlineHtmlToMarkdown(html),
    "`fit(x < 2)` [Docs](<https://example.org/Case?q=One&b=Two>) ~~old~~",
  );
  eq(
    canonicalInlineHtml(
      '<span style="text-decoration:line-through">old</span>',
    ),
    "<s>old</s>",
  );
  eq(inlineHtmlToMarkdown("<code>x `tick` &amp; y</code>"), "``x `tick` & y``");
  eq(inlineHtmlToMarkdown("<code>`edge`</code>"), "`` `edge` ``");
});
Deno.test("inline conversion refuses unsafe links, extra attributes and unfaithful formatting", async () => {
  for (
    const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///tmp/a",
      "#slide",
      "//example.org",
      "https://host/a\nb",
      "https://host/\\a",
      "https://",
    ]
  ) {
    await refuses(
      () =>
        renderInline([{
          t: "Link",
          c: [["", [], []], [{ t: "Str", c: "x" }], [href, ""]],
        }]),
      "UNSUPPORTED_HTML",
    );
  }
  for (
    const html of [
      "<code> leading </code>",
      "<code>  </code>",
      "<code>x  y</code>",
      '<a href="https://host" onclick="evil()">x</a>',
      '<a href="javascript:evil()">x</a>',
      "<code>x\ny</code>",
      "<code>x<b>y</b></code>",
      '<a href="https://host">x</code>',
      "<code>x</code><code>y</code>",
      "<s> leading</s>",
      '<a href="https://host"><b>x</b></a>',
    ]
  ) await refuses(() => inlineHtmlToMarkdown(html), "UNSUPPORTED_HTML");
  await refuses(
    () =>
      renderInline([{
        t: "Link",
        c: [["", [], []], [{ t: "Str", c: "x" }], [
          "https://host",
          "hidden title",
        ]],
      }]),
    "UNSUPPORTED_HTML",
  );
  await refuses(
    () => renderInline([{ t: "Code", c: [["id", [], []], "x"] }]),
    "UNSUPPORTED_HTML",
  );
  eq(
    renderInline([{
      t: "Span",
      c: [["", [], []], [{ t: "Str", c: "plain" }]],
    }]),
    "plain",
  );
  for (
    const attr of [["id", [], []], ["", ["important"], []], ["", [], [[
      "style",
      "color:red",
    ]]]]
  ) {
    await refuses(
      () =>
        renderInline([{ t: "Span", c: [attr, [{ t: "Str", c: "Warning" }]] }]),
      "UNSUPPORTED_HTML",
    );
  }
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "attributed inline spans refuse real projection instead of silently losing source design",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-inline-span-" });
    try {
      const source = dir + "/deck.qmd";
      const text =
        '## Slide {#slide}\n\n::: {#body}\n[Warning]{.important style="color:red"}\n:::\n';
      await Deno.writeTextFile(source, text);
      await refuses(() => renderProject(source), "UNSUPPORTED_HTML");
      eq(await Deno.readTextFile(source), text);
      await refuses(() => Deno.stat(dir + "/deck.bento.html"), "No such file");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "executed link/code/strikeout edit safely patches only the original paragraph and reopens cleanly",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-rich-inline-" });
    try {
      const source = dir + "/deck.qmd";
      const text =
        "## Inline {#inline}\r\n\r\n::: {#body}\r\nUse `fit(x)` and [Docs](https://example.org/Case?q=One&b=Two), ~~old~~.\r\n:::\r\n\r\n## Last {#last}\r\n\r\n<!-- qb:tail -->\r\nUntouched.\r\n";
      await Deno.writeTextFile(source, text);
      const initial = await renderProject(source);
      eq(
        initial.state.emitted.slides[0].elements[1].html,
        'Use <code>fit(x)</code> and <a href="https://example.org/Case?q=One&amp;b=Two">Docs</a>, <s>old</s>.',
      );
      const edited = structuredClone(initial.state.emitted);
      const html =
        'Use <code>fit(y)</code> and <a href="https://example.org/Case?q=New&amp;b=Two">Guide</a>, <s>old</s>.';
      edited.slides[0].elements[1].html = html;
      edited.slides[0].elements[1].x = 222;
      await saveProject(source, edited, initial.state.revision);
      const plan = await previewSync(source);
      eq(plan.changes.length, 1);
      eq(
        plan.changes[0].after,
        "Use `fit(y)` and [Guide](<https://example.org/Case?q=New&b=Two>), ~~old~~.",
      );
      eq(
        plan.result,
        text.replace(
          "Use `fit(x)` and [Docs](https://example.org/Case?q=One&b=Two), ~~old~~.",
          plan.changes[0].after,
        ),
      );
      await applySync(source, plan);
      const rendered = await renderProject(source);
      eq(rendered.state.pending.length, 0);
      eq(rendered.state.emitted.slides[0].elements[1].html, html);
      eq(rendered.state.emitted.slides[0].elements[1].x, 222);
      const unsafe = structuredClone(rendered.state.emitted);
      unsafe.slides[0].elements[1].html =
        '<code>r stop("must not execute")</code>';
      await saveProject(source, unsafe, rendered.state.revision);
      await refuses(() => previewSync(source), "computed-replacement");
      eq(await Deno.readTextFile(source), plan.result);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "inline codec matches installed Pandoc for literal code delimiters and web URL syntax",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-inline-codec-" });
    try {
      const cases = [
        "<code>`edge`</code>",
        "<code>x ``ticks`` y</code>",
        "<code>x &lt; y &amp; z</code>",
        '<a href="https://example.org/Case_(One)?q=Two&amp;x=3#Frag">Docs [v2]</a>',
        '<a href="https://example.org/%C3%B1">ñ</a>',
        "<s>old &amp; escaped *stars*</s>",
        "1. A literal *star* costs $2.",
      ];
      const path = dir + "/cases.md";
      await Deno.writeTextFile(
        path,
        cases.map(inlineHtmlToMarkdown).join("\n\n"),
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
      eq(ast.blocks.length, cases.length);
      ast.blocks.forEach((block: Node, i: number) => {
        eq(block.t, "Para");
        eq(renderInline(block.c as Node[]), canonicalInlineHtml(cases[i]));
      });
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
