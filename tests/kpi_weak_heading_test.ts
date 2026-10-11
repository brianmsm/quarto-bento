import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { retainedKpiAppearances } from "../src/core/kpi-appearance.ts";
import { measureNativeText } from "../src/render/measure.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, clone, targetKey } from "../src/state/mod.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
function eq(actual: unknown, expected: unknown) {
  if (canonical(actual) !== canonical(expected)) {
    throw new Error(`${canonical(actual)} != ${canonical(expected)}`);
  }
}
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
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
function component(name: string) {
  return `:::: {#metric-${name} .bento-kpi}
::: {#label-${name} bento-role="label"}
Observed score ${name}
:::
::: {#value-${name} bento-role="value"}
\`r paste(readLines("${name}.txt"), collapse=" ")\`
:::
::: {#detail-${name} bento-role="detail"}
Literal detail
:::
::::

::: {#following-${name}}
Content after the indicator.
:::
`;
}
const original = `---
engine: knitr
qbento-annotations: none
---

\`\`\`{r}
#| label: counter
#| include: false
cat('x', file='executions.txt', append=TRUE)
\`\`\`

## Alpha

${component("alpha")}
## Beta

${component("beta")}`;
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-kpi-weak-heading-" }),
    source = dir + "/deck.qmd";
  await Deno.writeTextFile(source, original);
  for (const name of ["alpha", "beta"]) {
    await Deno.writeTextFile(dir + `/${name}.txt`, "123");
  }
  const first = await renderProject(source),
    edited = clone(first.state.emitted);
  for (const name of ["alpha", "beta"]) {
    const slide = edited.slides.find((slide) =>
      slide.elements.some((element) =>
        element.id === `metric-${name}/qb-kpi-background`
      )
    )!;
    const background = slide.elements.find((element) =>
      element.id === `metric-${name}/qb-kpi-background`
    )!;
    Object.assign(
      slide.elements.find((element) =>
        element.id === `label-${name}/paragraph:1`
      )!,
      { y: Number(background.y) + 24, h: 40 },
    );
    Object.assign(
      slide.elements.find((element) =>
        element.id === `value-${name}/paragraph:1`
      )!,
      {
        fontSize: 12,
        lineHeight: 1.6,
        y: Number(background.y) + 80,
        w: 700,
        h: 310,
      },
    );
    Object.assign(
      slide.elements.find((element) =>
        element.id === `detail-${name}/paragraph:1`
      )!,
      { y: Number(background.y) + 420, h: 40 },
    );
  }
  const state = await saveProject(source, edited, first.state.revision);
  return { dir, source, state, edited };
}
Deno.test("weak heading KPI data-only recompute and HTML-free rebuild keep exact native appearance and verified source scope", async () => {
  const f = await fixture();
  try {
    const mapping = scanSource(original),
      appearances = retainedKpiAppearances(f.state, mapping);
    ok(mapping.slides.every((slide) => !slide.stable));
    eq(
      [...appearances.keys()].sort(),
      f.state.emitted.slides.map((slide) => slide.id).sort(),
    );
    const expected = clone(f.edited);
    for (const [index, name] of ["alpha", "beta"].entries()) {
      const fresh = Array.from({ length: 200 + index * 10 }, () => "score")
        .join(" ");
      await Deno.writeTextFile(f.dir + `/${name}.txt`, fresh);
      const value = expected.slides.flatMap((slide) => slide.elements).find((
        element,
      ) => element.id === `value-${name}/paragraph:1`)!;
      value.html = fresh;
      const metric = (await measureNativeText(
        [value as Element],
        expected as unknown as BentoDoc,
      ))[0];
      ok(
        metric.height <= Number(value.h) && metric.width <= Number(value.w) + 1,
        "The retained native fixture must actually fit.",
      );
    }
    eq(await Deno.readTextFile(f.source), original);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "x");
    const recomputed = await renderProject(f.source);
    eq(recomputed.state.emitted, expected);
    eq(recomputed.state.docId, f.state.docId);
    eq(
      recomputed.diagnostics.filter((diagnostic) =>
        diagnostic.code === "KPI_CONTENT_OVERFLOW"
      ),
      [],
    );
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xx");
    for (const name of ["alpha", "beta"]) {
      const baseline = recomputed.state.generatedBaseline.slides.flatMap((
        slide,
      ) => slide.elements).find((element) =>
        element.id === `value-${name}/paragraph:1`
      )!;
      eq(baseline.fontSize, 52);
      eq(baseline.lineHeight, 1.25);
    }
    await Deno.remove(f.source.replace(".qmd", ".bento.html"));
    const rebuilt = await renderProject(f.source);
    eq(rebuilt.state.emitted, expected);
    eq(
      rebuilt.diagnostics.filter((diagnostic) =>
        diagnostic.code === "KPI_CONTENT_OVERFLOW"
      ),
      [],
    );
    eq(await Deno.readTextFile(f.source), original);
    eq(await Deno.readTextFile(f.dir + "/executions.txt"), "xxx");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("weak heading KPI scope refuses forged receipts and repeated native IDs on another slide without selecting by position", async () => {
  const f = await fixture();
  try {
    const mapping = scanSource(original), sourceSlide = mapping.slides[0];
    const nativeSlide = f.state.emitted.slides.find((slide) =>
      slide.elements.some((element) =>
        element.id === "metric-alpha/qb-kpi-background"
      )
    )!.id;
    const otherSlide = f.state.emitted.slides.find((slide) =>
      slide.id !== nativeSlide
    )!.id;
    const headingEntry = Object.entries(f.state.provenance).find(([, proof]) =>
      proof.source?.blockId === sourceSlide.headingId &&
      proof.source.kind === "heading"
    )!;
    for (
      const field of [
        "origin",
        "semanticId",
        "blockId",
        "kind",
        "hash",
        "content",
        "stable",
        "inlineCodec",
        "missing",
        "retyped",
        "duplicate",
      ]
    ) {
      const changed = clone(f.state),
        proof = changed.provenance[headingEntry[0]];
      if (field === "origin") proof.origin = "detached";
      else if (field === "semanticId") proof.semanticId = "foreign";
      else if (field === "missing") delete changed.provenance[headingEntry[0]];
      else if (field === "retyped") {
        const [, titleId] = JSON.parse(headingEntry[0]);
        changed.generatedBaseline.slides.find((slide) =>
          slide.id === nativeSlide
        )!.elements.find((element) => element.id === titleId)!.type = "shape";
      } else if (field === "duplicate") {
        changed
          .provenance[
            targetKey({ slideId: otherSlide, elementId: "forged-title" })
          ] = clone(proof);
      } else proof.source![field] = field === "stable" ? true : "foreign";
      eq(retainedKpiAppearances(changed, mapping).has(nativeSlide), false);
      eq(retainedKpiAppearances(changed, mapping).has(otherSlide), true);
    }
    const duplicate = clone(f.state), valueId = "value-alpha/paragraph:1";
    const foreignValue = clone(
      duplicate.emitted.slides.find((slide) => slide.id === nativeSlide)!
        .elements.find((element) => element.id === valueId)!,
    );
    Object.assign(foreignValue, {
      fontSize: 300,
      lineHeight: .01,
      html: "foreign",
      x: 999,
    });
    duplicate.emitted.slides.find((slide) => slide.id === otherSlide)!.elements
      .push(foreignValue);
    eq(
      retainedKpiAppearances(duplicate, mapping).get(nativeSlide)!.elements.get(
        valueId,
      )!.fontSize,
      12,
    );
    eq(
      retainedKpiAppearances(duplicate, mapping).get(otherSlide)!.elements.has(
        valueId,
      ),
      false,
    );
    duplicate.generatedBaseline.slides.reverse();
    duplicate.emitted.slides.reverse();
    eq(
      retainedKpiAppearances(duplicate, mapping).get(nativeSlide)!.elements.get(
        valueId,
      )!.fontSize,
      12,
    );
    const ambiguous = clone(duplicate),
      backgroundId = "metric-alpha/qb-kpi-background";
    ambiguous.generatedBaseline.slides.find((slide) => slide.id === otherSlide)!
      .elements.push(
        clone(
          ambiguous.generatedBaseline.slides.find((slide) =>
            slide.id === nativeSlide
          )!.elements.find((element) => element.id === backgroundId)!,
        ),
      );
    ambiguous
      .provenance[targetKey({ slideId: otherSlide, elementId: backgroundId })] =
        clone(
          ambiguous
            .provenance[
              targetKey({ slideId: nativeSlide, elementId: backgroundId })
            ],
        );
    eq(retainedKpiAppearances(ambiguous, mapping).has(nativeSlide), false);
    const staleBackground = clone(f.state);
    staleBackground
      .provenance[targetKey({ slideId: nativeSlide, elementId: backgroundId })]
      .source!.hash = "foreign";
    eq(
      retainedKpiAppearances(staleBackground, mapping).has(nativeSlide),
      false,
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("changed weak-heading source with short fresh text keeps the existing identity refusal and byte-exact saved state/output", async () => {
  const f = await fixture();
  try {
    const changed = original.replace(
      "Observed score alpha",
      "A source-authored changed label",
    );
    const before = await Deno.readTextFile(f.dir + "/.qbento/state.json"),
      output = await Deno.readTextFile(f.source.replace(".qmd", ".bento.html"));
    await Deno.writeTextFile(f.source, changed);
    eq(retainedKpiAppearances(f.state, scanSource(changed)).size, 0);
    await refuses(() => renderProject(f.source), "AMBIGUOUS_IDENTITY");
    eq(await Deno.readTextFile(f.source), changed);
    eq(await Deno.readTextFile(f.dir + "/.qbento/state.json"), before);
    eq(
      await Deno.readTextFile(f.source.replace(".qmd", ".bento.html")),
      output,
    );
    eq((await readProject(f.source)).revision, f.state.revision);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
