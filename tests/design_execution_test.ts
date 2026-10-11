import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import { projectAst } from "../src/render/project.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function assert(value: unknown): asserts value {
  if (!value) throw new Error("assertion failed");
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
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "source-owned visual fields sync with text using bounded CRLF patches and explicit conflict resolution",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-owned-design-" });
    try {
      const source = dir + "/deck.qmd";
      const original =
        '## Title {#slide font-size="38"}\r\n\r\n::: {#body x=84 color="teal"}\r\nTexto β.\r\n:::\r\n';
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      const body = edited.slides[0].elements[1];
      eq(body.x, 84);
      eq(body.color, "teal");
      eq(edited.slides[0].elements[0].fontSize, 38);
      eq(
        first.state
          .ownership[targetKey({ slideId: "slide", elementId: body.id })],
        ["x", "color"],
      );
      body.x = 122;
      body.y = 211;
      body.html = "Texto actualizado β.";
      edited.slides[0].elements[0].fontSize = 40;
      const saved = await saveProject(source, edited, first.state.revision);
      eq(saved.pending.length, 3);
      assert(
        saved.overrides.some((o) => o.fields.some((f) => f.path[0] === "y")),
      );
      eq(await Deno.readTextFile(source), original);
      const plan = await previewSync(source);
      eq(plan.attributes!.patches.length, 2);
      eq(plan.patch.patches.length, 1);
      const expected = original.replace('font-size="38"', 'font-size="40"')
        .replace("x=84", "x=122").replace("Texto β.", "Texto actualizado β.");
      eq(plan.result, expected);
      const tampered = structuredClone(plan);
      tampered.attributes!.patches[0].replacement = "999";
      await refuses(() => applySync(source, tampered), "INVALID_PLAN");
      await applySync(source, plan);
      const rendered = await renderProject(source);
      eq(rendered.state.pending.length, 0);
      eq(rendered.state.emitted.slides[0].elements[1].y, 211);
      const next = structuredClone(rendered.state.emitted);
      next.slides[0].elements[1].x = 150;
      await saveProject(source, next, rendered.state.revision);
      const external = expected.replace("x=122", "x=199");
      await Deno.writeTextFile(source, external);
      await refuses(() => previewSync(source), "SOURCE_CONFLICT");
      await refuses(() => renderProject(source), "MERGE_CONFLICT");
      const review = await previewReconcile(source),
        item = review.changes.find((i) => i.change.path[0] === "x")!;
      eq(item.change.source!.value, 199);
      eq(item.change.after.value, 150);
      await applyReconcile(source, review, [{
        changeId: item.change.id,
        action: "keep-bento",
      }]);
      eq(await Deno.readTextFile(source), external);
      await applySync(source, await previewSync(source));
      const final = await renderProject(source);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].elements[1].x, 150);
      eq(await Deno.readTextFile(source), external.replace("x=199", "x=150"));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "computed figure visual attributes belong to the authored wrapper and never reverse-write the producer",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-figure-design-" });
    try {
      const source = dir + "/deck.qmd";
      const chunk =
        '```{r}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nplot(read.csv("data.csv")$value)\n```';
      const original = '## Results {#results}\n\n::: {#plot-frame x="210"}\n' +
        chunk + "\n:::\n";
      await Deno.writeTextFile(source, original);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted),
        figure = edited.slides[0].elements.find((e) => e.id === "fig-values")!;
      eq(figure.x, 210);
      figure.x = 222;
      figure.w = 700;
      const saved = await saveProject(source, edited, first.state.revision);
      eq(saved.pending.length, 1);
      eq(saved.pending[0].origin, "authored");
      const plan = await previewSync(source);
      eq(plan.changes[0].blockId, "plot-frame");
      eq(plan.result, original.replace('x="210"', 'x="222"'));
      await applySync(source, plan);
      await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n30\n");
      const final = await renderProject(source),
        next = final.state.emitted.slides[0].elements.find((e) =>
          e.id === "fig-values"
        )!;
      eq(final.state.pending.length, 0);
      eq(next.x, 222);
      eq(next.w, 700);
      assert(next.src !== figure.src);
      assert((await Deno.readTextFile(source)).includes(chunk));
      const invalid = structuredClone(final.state.emitted);
      invalid.slides[0].elements.find((e) => e.id === "fig-values")!.src =
        figure.src;
      const pending = await saveProject(source, invalid, final.state.revision);
      eq(pending.pending[0].origin, "computed");
      eq(pending.pending[0].status, "conflict");
      await refuses(() => previewSync(source), "SYNC_CONFLICT");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "adding QMD ownership to retained visual design creates a recoverable conflict",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-ownership-change-" });
    try {
      const source = dir + "/deck.qmd",
        original = "## Title {#slide}\n\n::: {#body}\nBody.\n:::\n";
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source),
        edited = structuredClone(first.state.emitted);
      edited.slides[0].elements[1].x = 250;
      await saveProject(source, edited, first.state.revision);
      const external = original.replace("{#body}", '{#body x="300"}');
      await Deno.writeTextFile(source, external);
      await refuses(() => renderProject(source), "MERGE_CONFLICT");
      eq((await readProject(source)).emitted.slides[0].elements[1].x, 250);
      const review = await previewReconcile(source);
      eq(review.changes.length, 1);
      await applyReconcile(source, review, [{
        changeId: review.changes[0].change.id,
        action: "keep-source",
      }]);
      const final = await renderProject(source);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].elements[1].x, 300);
      eq(await Deno.readTextFile(source), external);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test("source visual attributes refuse ambiguous multi-object targets and competing parent ownership", async () => {
  await refuses(
    () =>
      projectAst(
        {
          meta: {},
          blocks: [{
            t: "Div",
            c: [["body", [], [["x", "12"]]], [{
              t: "Para",
              c: [{ t: "Str", c: "One" }],
            }, { t: "Para", c: [{ t: "Str", c: "Two" }] }]],
          }],
        },
        "doc",
        [],
      ),
    "AMBIGUOUS_DESIGN_TARGET",
  );
  await refuses(
    () =>
      projectAst(
        {
          meta: {},
          blocks: [{
            t: "Div",
            c: [["outer", [], [["x", "12"]]], [{
              t: "Div",
              c: [["inner", [], [["x", "20"]]], [{
                t: "Para",
                c: [{ t: "Str", c: "One" }],
              }]],
            }]],
          }],
        },
        "doc",
        [],
      ),
    "AMBIGUOUS_DESIGN_OWNERSHIP",
  );
});
