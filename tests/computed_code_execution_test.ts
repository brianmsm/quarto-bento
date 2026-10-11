import { renderProject } from "../src/core/project.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
Deno.test("real R echoed code and stdout have stable distinct IDs across nested execution wrappers", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-r-stdout-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(
      source,
      '## Results {#results}\n\n```{r}\n#| label: total\n#| echo: true\nvalues <- read.csv("data.csv")$value\nprint(sum(values))\nprint(max(values))\n```\n',
    );
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
    const first = (await renderProject(source)).state;
    const codes = first.emitted.slides[0].elements.filter((e) =>
      e.type === "code"
    );
    assert(
      codes.length === 4 && codes[0].id === "total/code:1" &&
        codes[1].id === "total/code:2",
    );
    assert(
      codes[1].content === "[1] 6" &&
        codes[2].content === "print(max(values))" &&
        codes[3].content === "[1] 3",
    );
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n20\n30\n");
    const next = (await renderProject(source)).state;
    assert(
      next.emitted.slides[0].elements.find((e) => e.id === "total/code:2")!
        .content === "[1] 51",
    );
    assert(next.docId === first.docId);
    assert(
      next.emitted.slides[0].elements.find((e) => e.id === "total/code:4")!
        .content === "[1] 30",
    );
    for (const e of codes) {
      assert(
        next.provenance[targetKey({ slideId: "results", elementId: e.id })]
          .producer === "total",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("hidden code figure plus stdout uses the actual original execution boundary", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-hidden-stdout-" });
  try {
    const source = dir + "/deck.qmd",
      original =
        "## Results {#results}\n\n```{r}\n#| label: fig-values\n#| echo: false\n#| dev: svg\nplot(1:3)\nprint(6)\n```\n";
    await Deno.writeTextFile(source, original);
    const state = (await renderProject(source)).state;
    const slide = state.emitted.slides[0];
    assert(
      slide.elements.some((e) => e.type === "image" && e.id === "fig-values"),
    );
    const stdout = slide.elements.find((e) =>
      e.type === "code" && e.content === "[1] 6"
    )!;
    assert(stdout.id === "fig-values/code:1");
    assert(
      state.provenance[targetKey({ slideId: "results", elementId: stdout.id })]
        .producer === "fig-values",
    );
    assert(await Deno.readTextFile(source) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("partial echoes cannot borrow a decoy chunk identity, whether hidden, visible or unevaluated", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-partial-echo-" });
  try {
    for (
      const [index, option] of ["#| include: false\n", "", "#| eval: false\n"]
        .entries()
    ) {
      const child = dir + "/" + index;
      await Deno.mkdir(child);
      const source = child + "/deck.qmd";
      const original =
        "## Results {#results}\n\n```{r}\n#| label: actual\n#| echo: !expr c(1, 2)\nprint(1)\nprint(2)\nprint(3)\n```\n\n```{r}\n#| label: decoy\n" +
        option + "print(1)\nprint(2)\n```\n";
      await Deno.writeTextFile(source, original);
      const state = (await renderProject(source)).state;
      const codes = state.emitted.slides[0].elements.filter((e) =>
        e.type === "code"
      );
      const last = codes.find((e) => e.content === "[1] 3")!;
      assert(last && last.id.startsWith("actual/code:"));
      assert(
        state.provenance[targetKey({ slideId: "results", elementId: last.id })]
          .producer === "actual",
      );
      assert(codes.filter((e) => e.id.startsWith("actual/code:")).length === 5);
      assert(await Deno.readTextFile(source) === original);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("several ordinary original producers preserve distinct R echo and stdout identities", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-r-wrapped-producers-" });
  try {
    const source = dir + "/deck.qmd";
    const original =
      '## One {#one}\n\n```{r}\n#| label: first\n#| echo: true\nvalues <- read.csv("data.csv")$value\nprint(sum(values))\nprint(max(values))\n```\n\n## Two {#two}\n\n```{r}\n#| label: second\n#| echo: true\nprint(length(values))\nprint(min(values))\n```\n';
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(dir + "/data.csv", "value\n1\n2\n3\n");
    const first = (await renderProject(source)).state;
    const codes = first.emitted.slides.flatMap((s) =>
      s.elements.filter((e) => e.type === "code")
    );
    assert(codes.length === 8);
    await Deno.writeTextFile(dir + "/data.csv", "value\n4\n20\n30\n");
    const next = (await renderProject(source)).state;
    const changed = next.emitted.slides.flatMap((s) =>
      s.elements.filter((e) => e.type === "code")
    );
    assert(
      JSON.stringify(codes.map((e) => e.id)) ===
        JSON.stringify(changed.map((e) => e.id)),
    );
    assert(
      changed.find((e) => e.id === "first/code:2")!.content === "[1] 54" &&
        changed.find((e) => e.id === "second/code:4")!.content === "[1] 4",
    );
    for (const slide of next.emitted.slides) {
      for (const code of slide.elements.filter((e) => e.type === "code")) {
        assert(
          next.provenance[targetKey({ slideId: slide.id, elementId: code.id })]
            .producer === (slide.id === "one" ? "first" : "second"),
        );
      }
    }
    assert(
      next.docId === first.docId && next.pending.length === 0 &&
        await Deno.readTextFile(source) === original,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
