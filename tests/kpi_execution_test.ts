import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { targetKey } from "../src/state/mod.ts";
import { assertBentoContract } from "../src/render/validate.ts";
import { installQuartoProject } from "../src/integration/install.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const body = `:::: {#metric .bento-kpi}
::: {#label bento-role="label"}
Observed mean
:::
::: {#value bento-role="value"}
\`r sprintf("%.2f", mean(values))\`
:::
::: {#detail bento-role="detail"}
Calculated from project data.
:::
::::
`;
const original = `---
qbento-annotations: none
execute:
  echo: false
---

\`\`\`{r}
#| label: prepare-metrics
count <- if (file.exists("counter.txt")) as.integer(readLines("counter.txt")) else 0L
writeLines(as.character(count + 1L), "counter.txt")
values <- read.csv("data.csv")$value
\`\`\`

## Mean {#slide}

${body}`;
async function setup() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-kpi-exec-" });
  const source = `${dir}/deck.qmd`;
  await Deno.writeTextFile(source, original);
  await Deno.writeTextFile(`${dir}/data.csv`, "value\n10\n20\n30\n");
  return { dir, source };
}
Deno.test("real KPI render, authored label sync and changed data preserve native design and exact inline provenance", async () => {
  const { dir, source } = await setup();
  try {
    const first = await renderProject(source);
    const elements = first.state.emitted.slides[0].elements;
    assert(await Deno.readTextFile(`${dir}/counter.txt`) === "1\n");
    assert(
      elements.find((el) => el.id === "value/paragraph:1")!.html === "20.00",
    );
    const proof = first.state
      .provenance[
        targetKey({ slideId: "slide", elementId: "value/paragraph:1" })
      ];
    assert(
      proof.origin === "computed" &&
        proof.source?.blockId === "value/paragraph:1" && !proof.producer,
    );
    assert(
      first.state
        .provenance[
          targetKey({ slideId: "slide", elementId: "metric/qb-kpi-background" })
        ].origin === "authored",
    );
    assert(await Deno.readTextFile(source) === original);
    assertBentoContract(first.state.emitted);
    const edited = structuredClone(first.state.emitted);
    const label = edited.slides[0].elements.find((el) =>
      el.id === "label/paragraph:1"
    )!;
    label.html = "Updated mean label";
    label.x = 180;
    label.h = 80;
    label.fontSize = 32;
    const value = edited.slides[0].elements.find((el) =>
      el.id === "value/paragraph:1"
    )!;
    value.x = 220;
    value.w = 900;
    value.h = 110;
    value.fontSize = 56;
    const background = edited.slides[0].elements.find((el) =>
      el.id === "metric/qb-kpi-background"
    )!;
    background.fill = "#eefaff";
    const saved = await saveProject(source, edited, first.state.revision);
    assert(saved.pending.length === 1);
    const plan = await previewSync(source);
    assert(
      plan.patch.patches.length === 1 &&
        plan.patch.patches[0].blockId === "label/paragraph:1",
    );
    assert(
      plan.result === original.replace("Observed mean", "Updated mean label"),
    );
    assert(await Deno.readTextFile(`${dir}/counter.txt`) === "1\n");
    await applySync(source, plan);
    await Deno.writeTextFile(`${dir}/data.csv`, "value\n100\n200\n300\n");
    const next = await renderProject(source);
    const nextElements = next.state.emitted.slides[0].elements;
    assert(await Deno.readTextFile(`${dir}/counter.txt`) === "2\n");
    const nextValue = nextElements.find((el) => el.id === value.id)!;
    assert(
      nextValue.html === "200.00" && nextValue.x === 220 &&
        nextValue.w === 900 && nextValue.h === 110 && nextValue.fontSize === 56,
    );
    assert(
      nextElements.find((el) => el.id === label.id)!.html ===
          "Updated mean label" &&
        nextElements.find((el) => el.id === label.id)!.x === 180,
    );
    assert(
      nextElements.find((el) => el.id === background.id)!.fill === "#eefaff",
    );
    assert(
      next.state.docId === first.state.docId &&
        next.state.pending.length === 0 && next.diagnostics.length === 0,
    );
    await installQuartoProject(source);
    const ordinary = await new Deno.Command("quarto", {
      cwd: dir,
      args: ["render", "deck.qmd"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(ordinary.success, new TextDecoder().decode(ordinary.stderr));
    assert(await Deno.readTextFile(`${dir}/counter.txt`) === "3\n");
    const reopened = await readProject(source);
    assert(
      reopened.docId === first.state.docId && reopened.pending.length === 0,
    );
    assert(await Deno.readTextFile(source) === plan.result);
    await Deno.remove(`${dir}/deck.bento.html`);
    const rebuilt = await renderProject(source);
    assert(
      rebuilt.state.docId === first.state.docId &&
        rebuilt.state.emitted.slides[0].elements.find((el) =>
            el.id === value.id
          )!.fontSize === 56,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("computed KPI edits refuse producer rewrites and retain explicit restore or detach choices", async () => {
  const { dir, source } = await setup();
  try {
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.find((el) => el.id === "value/paragraph:1")!
      .html = "999.999";
    const saved = await saveProject(source, edited, first.state.revision);
    assert(
      saved.pending.length === 1 && saved.pending[0].origin === "computed",
    );
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    let plan = await previewReconcile(source);
    const item = plan.changes.find((item) =>
      item.change.target.elementId === "value/paragraph:1"
    )!;
    assert(
      item.actions.includes("keep-source") && item.actions.includes("detach") &&
        !item.actions.includes("keep-bento"),
    );
    await applyReconcile(source, plan, [{
      changeId: item.change.id,
      action: "keep-source",
    }]);
    const restored = await renderProject(source);
    assert(
      restored.state.pending.length === 0 &&
        restored.state.emitted.slides[0].elements.find((el) =>
            el.id === "value/paragraph:1"
          )!.html === "20.00",
    );
    const second = structuredClone(restored.state.emitted);
    second.slides[0].elements.find((el) => el.id === "value/paragraph:1")!
      .html = "Manual detached value";
    await saveProject(source, second, restored.state.revision);
    plan = await previewReconcile(source);
    const pending = plan.changes.find((item) =>
      item.change.target.elementId === "value/paragraph:1"
    )!;
    await applyReconcile(source, plan, [{
      changeId: pending.change.id,
      action: "detach",
    }]);
    const detached = await renderProject(source);
    assert(
      detached.state.emitted.slides[0].elements.find((el) =>
        el.id === "value/paragraph:1"
      )!.html === "Manual detached value",
    );
    assert(await Deno.readTextFile(source) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("KPI initial overflow refuses publication; saved small text boxes retain design and emit measured diagnostics", async () => {
  const { dir, source } = await setup();
  try {
    const first = await renderProject(source),
      output = await Deno.readTextFile(`${dir}/deck.bento.html`);
    const small = original.replace(
      "{#metric .bento-kpi}",
      '{#metric .bento-kpi w="198" h="120"}',
    ).replace('`r sprintf("%.2f", mean(values))`', "WWWW");
    await Deno.writeTextFile(source, small);
    await refuses(() => renderProject(source), "KPI_CONTENT_OVERFLOW");
    assert(
      await Deno.readTextFile(source) === small &&
        await Deno.readTextFile(`${dir}/deck.bento.html`) === output &&
        (await readProject(source)).revision === first.state.revision,
    );
    await Deno.writeTextFile(source, original);
    const edited = structuredClone(first.state.emitted);
    const value = edited.slides[0].elements.find((el) =>
      el.id === "value/paragraph:1"
    )!;
    value.w = 110;
    value.h = 15;
    await saveProject(source, edited, first.state.revision);
    const next = await renderProject(source);
    assert(
      next.diagnostics.some((d) =>
        d.code === "KPI_CONTENT_OVERFLOW" && d.elementId === value.id
      ),
    );
    assert(
      next.state.emitted.slides[0].elements.find((el) => el.id === value.id)!
            .h === 15 &&
        next.state.emitted.slides[0].elements.find((el) => el.id === value.id)!
            .w === 110,
    );
    assert(await Deno.readTextFile(source) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("KPI explicit source fields retain ownership; single-child parent transforms cannot sync", async () => {
  const { dir, source } = await setup();
  try {
    const text = original.replace(
      "{#metric .bento-kpi}",
      '{#metric .bento-kpi fill="#ffeeaa" x="80"}',
    );
    await Deno.writeTextFile(source, text);
    const first = await renderProject(source),
      edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.find((el) =>
      el.id === "metric/qb-kpi-background"
    )!.fill = "#eefaff";
    await saveProject(source, edited, first.state.revision);
    const plan = await previewSync(source);
    assert(
      plan.attributes?.patches.length === 1 &&
        plan.result === text.replace('fill="#ffeeaa"', 'fill="#eefaff"'),
    );
    await applySync(source, plan);
    const next = await renderProject(source),
      moved = structuredClone(next.state.emitted);
    moved.slides[0].elements.find((el) => el.id === "value/paragraph:1")!.x =
      350;
    const saved = await saveProject(source, moved, next.state.revision);
    assert(saved.pending.some((p) => p.path[0] === "x"));
    await refuses(() => previewSync(source), "UNMAPPED_DESIGN");
    const retained = await renderProject(source);
    assert(
      retained.state.emitted.slides[0].elements.find((el) =>
            el.id === "value/paragraph:1"
          )!.x === 350 &&
        retained.state.pending.length === saved.pending.length,
    );
    assert(await Deno.readTextFile(source) === plan.result);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("real Quarto KPI unsupported inline and nested component projections refuse without publishing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-kpi-negative-" });
  try {
    for (
      const [name, content, code] of [
        [
          "inline",
          body.replace('`r sprintf("%.2f", mean(values))`', "$x$"),
          "UNSUPPORTED_INLINE",
        ],
        [
          "nested",
          `::::: {#card .bento-card}\n${body}\n:::::\n`,
          "KPI_SOURCE_CONTEXT",
        ],
        [
          "roles",
          body.replace('bento-role="label"', 'bento-role="value"'),
          "KPI_SLOT_ROLE",
        ],
        [
          "attrs",
          body.replace(
            'bento-role="label"',
            'bento-role="label" foo="discarded"',
          ),
          "KPI_SLOT_ATTRIBUTE",
        ],
        ["ids", body.replace("#detail ", "#label "), "KPI_SOURCE_IDENTITY"],
      ]
    ) {
      const project = `${dir}/${name}`;
      await Deno.mkdir(project);
      const source = `${project}/deck.qmd`,
        text = `## Metric {#slide}\n\n${content}`;
      await Deno.writeTextFile(source, text);
      await refuses(() => renderProject(source), code);
      assert(await Deno.readTextFile(source) === text);
      await refuses(
        () => Deno.stat(`${project}/deck.bento.html`),
        "No such file",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("KPI executed inline and retained native text refuse automatic math/field transformation", async () => {
  const { dir, source } = await setup();
  try {
    const first = await renderProject(source),
      output = await Deno.readTextFile(`${dir}/deck.bento.html`);
    for (
      const [expression, code] of [['`r "$$x^2$$"`', "UNSUPPORTED_INLINE"], [
        '`r "{{page}}"`',
        "NATIVE_TEXT_TRANSFORM_UNSUPPORTED",
      ]]
    ) {
      const changed = original.replace(
        '`r sprintf("%.2f", mean(values))`',
        expression,
      );
      await Deno.writeTextFile(source, changed);
      await refuses(
        () => renderProject(source),
        code,
      );
      assert(
        await Deno.readTextFile(source) === changed &&
          await Deno.readTextFile(`${dir}/deck.bento.html`) === output &&
          (await readProject(source)).revision === first.state.revision,
      );
    }
    await Deno.writeTextFile(source, original);
    const edited = structuredClone(first.state.emitted);
    edited.slides[0].elements.find((el) => el.id === "label/paragraph:1")!
      .html = "{{page}}";
    const saved = await saveProject(source, edited, first.state.revision);
    await refuses(
      () => renderProject(source),
      "NATIVE_TEXT_TRANSFORM_UNSUPPORTED",
    );
    const retained = await readProject(source);
    assert(
      retained.revision === saved.revision && retained.pending.length === 1 &&
        retained.emitted.slides[0].elements.find((el) =>
            el.id === "label/paragraph:1"
          )!.html === "{{page}}",
    );
    assert(
      await Deno.readTextFile(source) === original &&
        await Deno.readTextFile(`${dir}/deck.bento.html`) === output,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("KPI glyph overhang refuses initial anchored typography and diagnoses retained native metrics", async () => {
  const { dir, source } = await setup();
  try {
    const first = await renderProject(source),
      output = await Deno.readTextFile(`${dir}/deck.bento.html`);
    const literal = original.replace('`r sprintf("%.2f", mean(values))`', "A");
    for (
      const attributes of [
        'font-size="300" line-height="0.01"',
        'font-size="300" line-height="0.01" valign="bottom"',
      ]
    ) {
      const unsafe = literal.replace(
        'bento-role="value"',
        `bento-role="value" ${attributes}`,
      );
      await Deno.writeTextFile(source, unsafe);
      await refuses(() => renderProject(source), "KPI_TYPOGRAPHY_UNSUPPORTED");
      assert(
        await Deno.readTextFile(source) === unsafe &&
          await Deno.readTextFile(`${dir}/deck.bento.html`) === output &&
          (await readProject(source)).revision === first.state.revision,
      );
    }
    const multiline = literal.replace(
      'bento-role="value"',
      'bento-role="value" font-size="100" line-height="0.01" valign="middle"',
    ).replace("\nA\n", "\nA  \nB\n");
    await Deno.writeTextFile(source, multiline);
    await refuses(() => renderProject(source), "KPI_TYPOGRAPHY_UNSUPPORTED");
    assert(await Deno.readTextFile(`${dir}/deck.bento.html`) === output);
    await Deno.writeTextFile(source, original);
    const edited = structuredClone(first.state.emitted),
      label = edited.slides[0].elements.find((el) =>
        el.id === "label/paragraph:1"
      )!;
    label.html = "A";
    label.fontSize = 300;
    label.lineHeight = .01;
    label.w = 264;
    label.h = 124;
    delete label.valign; // Pinned native default is top when this field is absent.
    const saved = await saveProject(source, edited, first.state.revision),
      retained = await renderProject(source);
    assert(
      retained.diagnostics.some((d) =>
        d.code === "KPI_CONTENT_OVERFLOW" && d.elementId === label.id
      ),
    );
    const kept = retained.state.emitted.slides[0].elements.find((el) =>
      el.id === label.id
    )!;
    assert(
      kept.html === "A" && kept.h === 124 && kept.lineHeight === .01 &&
        kept.fontSize === 300 && !Object.hasOwn(kept, "valign") &&
        retained.state.pending.length === saved.pending.length,
    );
    assert(await Deno.readTextFile(source) === original);
    let previous = retained.state;
    for (const lineHeight of [.00001, 0]) {
      const collapsed = structuredClone(previous.emitted);
      const collapsedLabel = collapsed.slides[0].elements.find((el) =>
        el.id === label.id
      )!;
      collapsedLabel.html = "A<br>B";
      collapsedLabel.fontSize = 100;
      collapsedLabel.lineHeight = lineHeight;
      collapsedLabel.valign = "middle";
      collapsedLabel.h = 116;
      const savedCollapsed = await saveProject(
        source,
        collapsed,
        previous.revision,
      );
      const rerendered = await renderProject(source);
      assert(
        rerendered.diagnostics.some((diagnostic) =>
          diagnostic.code === "KPI_CONTENT_OVERFLOW" &&
          diagnostic.elementId === label.id
        ),
      );
      const keptCollapsed = rerendered.state.emitted.slides[0].elements.find((
        el,
      ) => el.id === label.id)!;
      assert(
        keptCollapsed.html === "A<br>B" && keptCollapsed.fontSize === 100 &&
          keptCollapsed.lineHeight === lineHeight &&
          keptCollapsed.valign === "middle" &&
          keptCollapsed.h === 116 &&
          rerendered.state.pending.length === savedCollapsed.pending.length,
      );
      assert(await Deno.readTextFile(source) === original);
      previous = rerendered.state;
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("centered single-line KPI typography receives enough native space for measured glyph bounds", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-kpi-centered-" }),
    source = `${dir}/deck.qmd`;
  try {
    const text = `## KPI {#slide}\n\n` +
      body.replace('`r sprintf("%.2f", mean(values))`', "A").replace(
        'bento-role="value"',
        'bento-role="value" font-size="100" line-height="0.01" valign="middle"',
      );
    await Deno.writeTextFile(source, text);
    const first = await renderProject(source),
      value = first.state.emitted.slides[0].elements.find((el) =>
        el.id === "value/paragraph:1"
      )!;
    assert(
      Number(value.h) > 100 && value.lineHeight === .01 &&
        value.fontSize === 100 && value.valign === "middle" &&
        first.diagnostics.length === 0,
    );
    assert(await Deno.readTextFile(source) === text);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
