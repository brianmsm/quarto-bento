import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { canonical, clone, targetKey } from "../src/state/mod.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (String(error).includes(code)) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const original = `---
qbento-annotations: none
---

## A {#a}

:::: {#metric .bento-kpi}
::: {#label bento-role="label"}
Participants
:::
::: {#value bento-role="value"}
123
:::
::: {#detail bento-role="detail"}
Complete cases
:::
::::

::: {#following}
Content after the indicator.
:::
`;
Deno.test("retained KPI typography fits long fresh text without moving subsequent source content or changing baseline authority", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-kpi-flow-" }),
    source = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(source, original);
    let state = (await renderProject(source)).state;
    const edited = clone(state.emitted), elements = edited.slides[0].elements;
    const label = elements.find((element) =>
      element.id === "label/paragraph:1"
    )!;
    const value = elements.find((element) =>
      element.id === "value/paragraph:1"
    )!;
    const detail = elements.find((element) =>
      element.id === "detail/paragraph:1"
    )!;
    const following = elements.find((element) =>
      element.id === "following/paragraph:1"
    )!;
    Object.assign(label, {
      html: "Participants ".repeat(160).trim(),
      fontSize: 12,
      lineHeight: 1.6,
      h: 260,
    });
    Object.assign(value, { y: 456, h: 95 });
    Object.assign(detail, { y: 560, h: 40 });
    state = await saveProject(source, edited, state.revision);
    await applySync(source, await previewSync(source));
    const rendered = await renderProject(source);
    state = rendered.state;
    eq(
      rendered.diagnostics.filter((diagnostic) =>
        diagnostic.code === "KPI_CONTENT_OVERFLOW"
      ),
      [],
    );
    eq(state.emitted, edited);
    eq(
      state.emitted.slides[0].elements.find((element) =>
        element.id === following.id
      ),
      following,
    );
    eq(
      state.generatedBaseline.slides[0].elements.find((element) =>
        element.id === label.id
      )!.fontSize,
      26,
    );
    eq(
      state.generatedBaseline.slides[0].elements.find((element) =>
        element.id === label.id
      )!.lineHeight,
      1.25,
    );
    eq(
      state.ownership[targetKey({ slideId: "a", elementId: label.id })]
        ?.includes("fontSize") ?? false,
      false,
    );
    eq(state.pending, []);
    await Deno.remove(source.replace(".qmd", ".bento.html"));
    const rebuilt = await renderProject(source);
    state = rebuilt.state;
    eq(
      rebuilt.diagnostics.filter((diagnostic) =>
        diagnostic.code === "KPI_CONTENT_OVERFLOW"
      ),
      [],
    );
    eq(state.emitted, edited);
    const qmd = await Deno.readTextFile(source),
      saved = await Deno.readTextFile(dir + "/.qbento/state.json");
    // The same retained typography cannot rescue an explicit source frame's capacity.
    await Deno.writeTextFile(
      source,
      qmd.replace(".bento-kpi}", '.bento-kpi h="470"}'),
    );
    await refuses(() => renderProject(source), "KPI_CONTENT_OVERFLOW");
    eq(await Deno.readTextFile(dir + "/.qbento/state.json"), saved);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
