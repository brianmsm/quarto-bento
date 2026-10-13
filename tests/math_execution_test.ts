import {
  readProject,
  renderProject,
  renderProjectFromAst,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { mathToNativeHtml } from "../src/render/math.ts";
import type { Ast } from "../src/render/types.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    if (
      String(error).includes(code) || (error as { code?: string }).code === code
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const sourceText =
  '## Fórmula {#formula}\r\n\r\n::: {#equation font-size="28"}\r\n\r\n<!-- qb:eq-main -->\r\n$$\r\nx^2 + α\r\n$$\r\n\r\n:::\r\n\r\n## Tail {#tail}\r\n';
Deno.test({
  name:
    "real display math preserves pending native edits and styles, then syncs the CRLF formula body and previews the optional design signal",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-math-loop-" });
    try {
      const source = dir + "/deck.qmd";
      await Deno.writeTextFile(source, sourceText);
      const first = await renderProject(source);
      const original = first.state.emitted.slides[0].elements.find((e) =>
        e.id === "eq-main"
      )!;
      eq(original.type, "text");
      eq(original.html, "$$x^2 + α$$");
      eq(original.fontSize, 28);
      eq(
        first.state
          .provenance[targetKey({ slideId: "formula", elementId: "eq-main" })]
          .source?.kind,
        "math",
      );
      eq(
        first.state
          .provenance[targetKey({ slideId: "formula", elementId: "eq-main" })]
          .source?.mathCodec,
        1,
      );
      const edited = structuredClone(first.state.emitted);
      const equation = edited.slides[0].elements.find((e) =>
        e.id === "eq-main"
      )!;
      const tex = String.raw`\frac{β + x^{2}}{1 + y}`;
      equation.html = `<div>$$</div><div>${tex}</div><div>$$</div>`;
      equation.x = 244;
      equation.fontSize = 34;
      const saved = await saveProject(source, edited, first.state.revision);
      eq(saved.pending.length, 2);
      eq(await Deno.readTextFile(source), sourceText);
      const fresh = await renderProject(source);
      eq(fresh.state.pending.length, 2);
      eq(fresh.state.docId, first.state.docId);
      const pending = fresh.state.emitted.slides[0].elements.find((e) =>
        e.id === "eq-main"
      )!;
      eq(pending.html, equation.html);
      eq(pending.x, 244);
      eq(pending.fontSize, 34);
      const plan = await previewSync(source);
      eq(plan.patch.patches.length, 1);
      eq(
        plan.changes.find((change) => change.kind === "math")!.after,
        tex + "\n",
      );
      eq(plan.normalizations.length, 1);
      eq(plan.normalizations[0].after.value, mathToNativeHtml(tex));
      const expected = sourceText.replace('font-size="28"', 'font-size="34"')
        .replace("x^2 + α\r\n", tex + "\r\n")
        .replace("{#formula}", "{#formula .qbento-design}");
      eq(plan.result, expected);
      await applySync(source, plan);
      const final = await renderProject(source);
      const rendered = final.state.emitted.slides[0].elements.find((e) =>
        e.id === "eq-main"
      )!;
      eq(final.state.pending.length, 0);
      eq(rendered.html, mathToNativeHtml(tex));
      eq(rendered.x, 244);
      eq(rendered.fontSize, 34);
      eq(await Deno.readTextFile(source), expected);
      for (
        const html of [
          "$$x$$<script>alert(1)</script>",
          "$$x$$ $$y$$",
          "$$x<b>2</b>$$",
          "$$x$$\n```{r}\nfile.create('must-not-exist')\n```\n$$y$$",
          String.raw`$$\input{file}$$`,
          "text $$x$$",
        ]
      ) {
        const state = await readProject(source),
          next = structuredClone(state.emitted);
        next.slides[0].elements.find((e) => e.id === "eq-main")!.html = html;
        await saveProject(source, next, state.revision);
        await refuses(() => previewSync(source), "UNSUPPORTED_MATH");
        eq(await Deno.readTextFile(source), expected);
      }
      await refuses(() => Deno.stat(dir + "/must-not-exist"), "No such file");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "independent QMD display-math edits conflict explicitly and keep-bento resolution patches the fresh source",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-math-conflict-" });
    try {
      const source = dir + "/deck.qmd";
      await Deno.writeTextFile(source, sourceText);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      edited.slides[0].elements.find((e) => e.id === "eq-main")!.html =
        "$$x^3 + β$$";
      await saveProject(source, edited, first.state.revision);
      const external = sourceText.replace("x^2 + α", "x^4 + γ");
      await Deno.writeTextFile(source, external);
      await refuses(() => previewSync(source), "SOURCE_CONFLICT");
      await refuses(() => renderProject(source), "MERGE_CONFLICT");
      eq(
        (await readProject(source)).emitted.slides[0].elements.find((e) =>
          e.id === "eq-main"
        )!.html,
        "$$x^3 + β$$",
      );
      eq(await Deno.readTextFile(source), external);
      const review = await previewReconcile(source);
      eq(review.changes.length, 1);
      eq(review.changes[0].change.source?.value, "$$x^4 + γ$$");
      await applyReconcile(source, review, [{
        changeId: review.changes[0].change.id,
        action: "keep-bento",
      }]);
      eq(await Deno.readTextFile(source), external);
      await applySync(source, await previewSync(source));
      const final = await renderProject(source);
      eq(final.state.pending.length, 0);
      eq(
        await Deno.readTextFile(source),
        external.replace("x^4 + γ", "x^3 + β"),
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real mixed or executable as-is math refuses publication without modifying the QMD",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-math-reject-" });
    try {
      const source = dir + "/deck.qmd";
      for (
        const [body, code] of [
          // Original-fragment proof now rejects mixed inline math before projection.
          ["Text $$x^2$$ more.", "UNSUPPORTED_INLINE: Math"],
          // Single-line math remains a paragraph slot; the authored inline proof refuses it.
          ["<!-- qb:eq-main -->\n$$x^2$$", "UNSUPPORTED_INLINE: Math"],
          [
            '```{r}\n#| label: producer\n#| results: asis\nfile.create("must-not-exist")\ncat("$$x^2$$")\n```',
            "UNMAPPED_PROVENANCE: chunk producer uses as-is output",
          ],
        ]
      ) {
        const original = "## Formula {#formula}\n\n" + body + "\n";
        await Deno.writeTextFile(source, original);
        await refuses(() => renderProject(source), code);
        eq(await Deno.readTextFile(source), original);
        await refuses(
          () => Deno.stat(dir + "/deck.bento.html"),
          "No such file",
        );
        await refuses(
          () => Deno.stat(dir + "/.qbento/state.json"),
          "No such file",
        );
        await refuses(() => Deno.stat(dir + "/must-not-exist"), "No such file");
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test("direct AST projection independently refuses text around a display formula", async () => {
  const ast: Ast = {
    meta: {},
    blocks: [
      {
        t: "Header",
        c: [2, ["formula", [], []], [{ t: "Str", c: "Formula" }]],
      },
      {
        t: "Para",
        c: [
          { t: "Str", c: "Text" },
          { t: "Space" },
          { t: "Math", c: [{ t: "DisplayMath" }, "x^2"] },
          { t: "Space" },
          { t: "Str", c: "more." },
        ],
      },
    ],
  };
  await refuses(
    () => projectAst(ast, "mixed-math-guard", []),
    "MIXED_MATH_TEXT",
  );
});

Deno.test("computed executed display math retains its producer and cannot be synchronized as authored LaTeX", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-computed-math-" });
  try {
    const source = dir + "/deck.qmd",
      original =
        "## Results {#results}\n\n```{r}\n#| label: producer\n#| echo: false\nx <- 1\n```\n";
    await Deno.writeTextFile(source, original);
    const ast: Ast = {
      meta: {},
      blocks: [
        {
          t: "Header",
          c: [2, ["results", [], []], [{ t: "Str", c: "Results" }]],
        },
        {
          t: "Div",
          c: [["producer", ["cell"], []], [{
            t: "Para",
            c: [{ t: "Math", c: [{ t: "DisplayMath" }, "x=1"] }],
          }]],
        },
      ],
    };
    const first = await renderProjectFromAst(source, {
      ast,
      sourceHash: hashSource(original),
      assetDirectories: [dir],
      expectedRevision: null,
    });
    const equation = first.state.emitted.slides[0].elements.find((e) =>
      e.id === "producer/math:1"
    )!;
    const origin = first.state
      .provenance[targetKey({ slideId: "results", elementId: equation.id })];
    eq(origin.origin, "computed");
    eq(origin.producer, "producer");
    const edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.find((e) => e.id === equation.id)!.html =
      "$$x=999$$";
    const saved = await saveProject(source, edited, first.state.revision);
    eq(saved.pending[0].origin, "computed");
    eq(saved.pending[0].status, "conflict");
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("an executed display equation must match its exact mapped authored formula", async () => {
  const source = scanSource(
    "## Formula {#formula}\n\n<!-- qb:eq-main -->\n$$\nx=1\n$$\n",
  );
  const ast: Ast = {
    meta: {},
    blocks: [
      {
        t: "Header",
        c: [2, ["formula", [], []], [{ t: "Str", c: "Formula" }]],
      },
      { t: "RawBlock", c: ["html", "<!-- qb:eq-main -->"] },
      { t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, "x=999"] }] },
    ],
  };
  await refuses(
    async () =>
      validateProjectionOrigins(
        source,
        await projectAst(ast, "doc", [], source),
      ),
    "UNMAPPED_PROVENANCE",
  );
});

Deno.test("ordinary text and new-slide conversions refuse to invent a display-math source block", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-unmapped-math-" });
  try {
    const source = dir + "/deck.qmd",
      original = "## Slide {#slide}\n\n<!-- qb:body -->\nPlain.\n";
    await Deno.writeTextFile(source, original);
    const first = await renderProjectFromAst(source, {
      sourceHash: hashSource(original),
      assetDirectories: [dir],
      expectedRevision: null,
      ast: {
        meta: {},
        blocks: [
          {
            t: "Header",
            c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]],
          },
          { t: "RawBlock", c: ["html", "<!-- qb:body -->"] },
          { t: "Para", c: [{ t: "Str", c: "Plain." }] },
        ],
      },
    });
    const changed = structuredClone(first.state.emitted);
    changed.slides[0].elements.find((e) => e.id === "body")!.html = "$$x=1$$";
    await saveProject(source, changed, first.state.revision);
    await refuses(() => previewSync(source), "UNSUPPORTED_MATH");
    eq(await Deno.readTextFile(source), original);
    const current = await readProject(source),
      created = structuredClone(first.state.emitted);
    const title = structuredClone(created.slides[0].elements[0]),
      equation = structuredClone(created.slides[0].elements[1]);
    title.id = "new-title";
    title.html = "New";
    equation.id = "new-equation";
    equation.html = "$$x=1$$";
    created.slides.push({ id: "new-slide", elements: [title, equation] });
    const saved = await saveProject(source, created, current.revision);
    const newSlide = saved.pending.find((change) =>
      change.kind === "create-slide"
    )!;
    await refuses(() => previewSync(source, [newSlide.id]), "UNSUPPORTED_MATH");
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("marked and ordinal math siblings bind distinct original formulas", async () => {
  const source = scanSource(
    "## Formula {#formula}\n\n::: {#equations}\n\n<!-- qb:eq-first -->\n$$\nx=1\n$$\n\n$$\ny=2\n$$\n\n:::\n",
  );
  const ast: Ast = {
    meta: {},
    blocks: [
      {
        t: "Header",
        c: [2, ["formula", [], []], [{ t: "Str", c: "Formula" }]],
      },
      {
        t: "Div",
        c: [["equations", [], []], [
          { t: "RawBlock", c: ["html", "<!-- qb:eq-first -->"] },
          { t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, "x=1"] }] },
          { t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, "y=2"] }] },
        ]],
      },
    ],
  };
  const projected = validateProjectionOrigins(
    source,
    await projectAst(ast, "doc", [], source),
  );
  eq(projected.origins.formula["eq-first"].sourceId, "eq-first");
  eq(
    projected.origins.formula["equations/math:2"].sourceId,
    "equations/math:2",
  );
});

Deno.test("a native equation ID remains distinct from the source math identity and wrapper design", async () => {
  const source = scanSource(
    '## Formula {#formula}\n\n::: {#equation bento-element-id="native-math" x="188"}\n\n$$\nx=1\n$$\n\n:::\n',
  );
  const ast: Ast = {
    meta: {},
    blocks: [
      {
        t: "Header",
        c: [2, ["formula", [], []], [{ t: "Str", c: "Formula" }]],
      },
      {
        t: "Div",
        c: [["equation", [], [["bento-element-id", "native-math"], [
          "x",
          "188",
        ]]], [
          { t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, "x=1"] }] },
        ]],
      },
    ],
  };
  const projected = validateProjectionOrigins(
    source,
    await projectAst(ast, "doc", [], source),
  );
  const equation = projected.document.slides[0].elements.find((element) =>
    element.id === "native-math"
  )!;
  eq(equation.x, 188);
  eq(projected.origins.formula["native-math"].sourceId, "equation/math:1");
  eq(projected.design?.formula["native-math"].bindings.x.sourceId, "equation");
});
