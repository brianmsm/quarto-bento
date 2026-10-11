import {
  canonicalInlineHtml,
  inlineHtmlToMarkdown,
  renderInline,
} from "../src/render/inline.ts";
import { applyComponentAction } from "../src/core/component-actions.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical } from "../src/state/mod.ts";
import type { Node } from "../src/render/types.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => unknown) {
  try {
    await action();
  } catch (error) {
    if ((error as { code?: string }).code === "UNSUPPORTED_HTML") return;
    throw error;
  }
  throw new Error("Expected UNSUPPORTED_HTML");
}
const cases = [
  ["<span>123</span>", "123", "123"],
  ["<SPAN >β &amp; café</SPAN>", "β & café", "β &amp; café"],
  ["a <span>b</span> c", "a b c", "a b c"],
  ["a<span>b</span>c", "abc", "abc"],
  ["<span>a\n b\t c</span>", "a b c", "a b c"],
  ["<p><span>123</span></p>", "123", "123"],
  ["<span>1. item</span>", "1\\. item", "1. item"],
  ["<span>2</span><span>. item</span>", "2\\. item", "2. item"],
  [
    "<span>&lt;x&gt; &#x1f600;&nbsp;ß</span>",
    "\\<x\\> 😀\u00a0ß",
    "&lt;x&gt; 😀\u00a0ß",
  ],
  [
    '<span>A</span> <b>B</b><br><code>fit(x)</code> <a href="https://example.org/Case?q=One&amp;b=Two">Docs</a>',
    "A **B**  \n`fit(x)` [Docs](<https://example.org/Case?q=One&b=Two>)",
    'A <b>B</b><br><code>fit(x)</code> <a href="https://example.org/Case?q=One&amp;b=Two">Docs</a>',
  ],
];
Deno.test("native attribute-free spans canonicalize to literal text while preserving adjacent inline syntax and escaping", () => {
  for (const [html, markdown, canonicalHtml] of cases) {
    eq(inlineHtmlToMarkdown(html), markdown);
    eq(canonicalInlineHtml(html), canonicalHtml);
  }
  eq(
    renderInline([{ t: "Span", c: [["", [], []], [{ t: "Str", c: "123" }]] }]),
    canonicalInlineHtml("<span>123</span>"),
  );
  // This previously supported native strike form remains its exact exception.
  eq(
    canonicalInlineHtml(
      '<span style="text-decoration:line-through">old</span>',
    ),
    "<s>old</s>",
  );
});
Deno.test("transparent-span acceptance preserves attributed, nested, malformed, empty, spacing, code and link refusals", async () => {
  for (
    const attribute of [
      'style=""',
      'style="color:red"',
      'style="font-weight:700"',
      'class=""',
      'class="native"',
      'id="value"',
      'title=""',
      'href="https://example.org"',
      'lang="es"',
      'data-value="123"',
      'onclick="evil()"',
      'contenteditable="true"',
      'aria-label="123"',
    ]
  ) {
    await refuses(() => inlineHtmlToMarkdown(`<span ${attribute}>123</span>`));
    await refuses(() => canonicalInlineHtml(`<span ${attribute}>123</span>`));
  }
  for (
    const html of [
      "<span><span>123</span></span>",
      "<span><b>123</b></span>",
      "<b><span>123</span></b>",
      "<span><code>x</code></span>",
      '<span><a href="https://example.org">x</a></span>',
      "<span>1<br>2</span>",
      "<span>123</div>",
      "<span>123",
      "123</span>",
      "<span/>",
      "<span></span>",
      "<span> </span>",
      "<span>&nbsp;</span>",
      "a<span> </span>b",
      "a <span> b </span> c",
      "<span> 123</span>",
      "<span>123 </span>",
      "<span>x</span><code> leading </code>",
      "<span>x</span><code>x  y</code>",
      '<span>x</span><a href="javascript:evil()">y</a>',
      "<span>x<script>evil()</script></span>",
      "<span>&unknown;</span>",
      "<b>x</b><span></span><b>y</b>",
    ]
  ) {
    await refuses(() => inlineHtmlToMarkdown(html));
    await refuses(() => canonicalInlineHtml(html));
  }
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "attribute-free native span Markdown remains equivalent under the installed Pandoc reader",
  ignore: !canRun,
  fn: async () => {
    const process = new Deno.Command("quarto", {
      args: ["pandoc", "--from", "markdown", "--to", "json"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = process.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        cases.map(([html]) => inlineHtmlToMarkdown(html)).join("\n\n"),
      ),
    );
    await writer.close();
    const output = await process.output();
    ok(output.success, new TextDecoder().decode(output.stderr));
    const ast = JSON.parse(new TextDecoder().decode(output.stdout));
    eq(ast.blocks.length, cases.length);
    ast.blocks.forEach((block: Node, index: number) => {
      eq(block.t, "Para");
      eq(renderInline(block.c as Node[]), cases[index][2]);
    });
  },
});
Deno.test({
  name:
    "public KPI creation and later authored sync accept the native plain span without changing source before apply or losing typography",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-native-span-" }),
      source = dir + "/deck.qmd";
    try {
      const original =
        "---\nengine: knitr\nqbento-annotations: none\n---\n\n```{r}\n#| label: counter\n#| include: false\ncat('x', file='executions.txt', append=TRUE)\n```\n\n## Native {#native}\n\n::: {#body}\nSource paragraph.\n:::\n";
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source);
      let state = await applyComponentAction(source, {
        action: "create",
        kind: "kpi",
        slideId: "native",
        fields: {
          label: "Participantes",
          value: "123",
          detail: "Casos completos",
        },
        revision: first.state.revision,
        expectedDocId: first.state.docId,
      });
      const intent = state.componentCreations![0],
        nativeId = intent.members.find((member) =>
          member.role === "value"
        )!.nativeId;
      const edited = structuredClone(state.emitted),
        value = edited.slides[0].elements.find((element) =>
          element.id === nativeId
        )!;
      eq(value.fontWeight, 700);
      // Exact attribute-free HTML observed from the pinned native Ctrl+B workflow.
      value.html = "<span>123</span>";
      value.lineHeight = 1.6;
      value.h = 100;
      value.w = 420;
      value.x = 350;
      value.y = 300;
      state = await saveProject(source, edited, state.revision);
      eq(await readProject(source), state);
      eq(
        state.emitted.slides[0].elements.find((element) =>
          element.id === nativeId
        )!.html,
        "<span>123</span>",
      );
      eq(await Deno.readTextFile(source), original);
      eq(await Deno.readTextFile(dir + "/executions.txt"), "x");
      const plan = await previewSync(source);
      eq(plan.componentApprovals?.length, 1);
      ok(plan.result.includes('bento-role="value"}\n123\n'));
      ok(!plan.result.includes("<span>") && !plan.result.includes("**123**"));
      eq(await Deno.readTextFile(source), original);
      await applySync(source, plan);
      eq(await Deno.readTextFile(source), plan.result);
      eq(await Deno.readTextFile(dir + "/executions.txt"), "x");
      let rebuilt = await renderProject(source);
      const retained = () =>
        rebuilt.state.emitted.slides[0].elements.find((element) =>
          element.id === nativeId
        )!;
      eq(rebuilt.state.docId, first.state.docId);
      eq(rebuilt.state.pending.length, 0);
      eq(retained().html, "123");
      eq([
        retained().fontWeight,
        retained().lineHeight,
        retained().x,
        retained().y,
        retained().w,
        retained().h,
      ], [700, 1.6, 350, 300, 420, 100]);
      eq(await readProject(source), rebuilt.state);
      const later = structuredClone(rebuilt.state.emitted);
      later.slides[0].elements.find((element) => element.id === nativeId)!
        .html = "<span>124</span>";
      state = await saveProject(source, later, rebuilt.state.revision);
      const before = await Deno.readTextFile(source),
        update = await previewSync(source);
      eq(update.patch.patches.length, 1);
      eq(update.patch.patches[0].blockId, nativeId);
      eq(update.patch.patches[0].replacement, "124");
      eq(await Deno.readTextFile(source), before);
      await applySync(source, update);
      rebuilt = await renderProject(source);
      eq(rebuilt.state.pending.length, 0);
      eq(retained().html, "124");
      eq([
        retained().fontWeight,
        retained().lineHeight,
        retained().x,
        retained().y,
        retained().w,
        retained().h,
      ], [700, 1.6, 350, 300, 420, 100]);
      eq(await Deno.readTextFile(dir + "/executions.txt"), "xxx");
      const unsupported = structuredClone(rebuilt.state.emitted);
      unsupported.slides[0].elements.find((element) => element.id === nativeId)!
        .html = '<span style="color:red">125</span>';
      const saved = await saveProject(
          source,
          unsupported,
          rebuilt.state.revision,
        ),
        exactSource = await Deno.readTextFile(source),
        exactOutput = await Deno.readTextFile(dir + "/deck.bento.html");
      await refuses(() => previewSync(source));
      eq(await readProject(source), saved);
      eq(await Deno.readTextFile(source), exactSource);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), exactOutput);
      eq(await Deno.readTextFile(dir + "/executions.txt"), "xxx");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
