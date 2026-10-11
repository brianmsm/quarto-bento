import { renderProject } from "../src/core/project.ts";
import { assertCompatibleProducerFilters } from "../src/render/producer-capture.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
Deno.test("effective computed user filters from QMD, project, profiles and metadata refuse before execution and preserve the prior state", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-filter-provenance-" }),
    source = dir + "/deck.qmd",
    originalProfile = Deno.env.get("QUARTO_PROFILE");
  const body =
    '## One {#one}\n\n```{r}\n#| label: actual\n#| echo: false\ncat("run\\n",file="counter.txt",append=TRUE)\nprint(555)\n```\n';
  try {
    await Deno.writeTextFile(source, body);
    await renderProject(source);
    const state = await Deno.readTextFile(dir + "/.qbento/state.json"),
      output = await Deno.readTextFile(dir + "/deck.bento.html");
    await Deno.writeTextFile(
      dir + "/user.lua",
      "function Div(d) return d end\n",
    );
    for (const variant of ["qmd", "project", "profile", "metadata"]) {
      await Deno.writeTextFile(source, body);
      await Deno.writeTextFile(
        dir + "/_quarto.yml",
        "project: {type: default}\n",
      );
      Deno.env.delete("QUARTO_PROFILE");
      if (variant === "qmd") {
        await Deno.writeTextFile(
          source,
          "---\nfilters: [user.lua]\n---\n" + body,
        );
      }
      if (variant === "project") {
        await Deno.writeTextFile(
          dir + "/_quarto.yml",
          "project: {type: default}\nfilters: [user.lua]\n",
        );
      }
      if (variant === "profile") {
        await Deno.writeTextFile(
          dir + "/_quarto-test.yml",
          "filters: [user.lua]\n",
        );
        Deno.env.set("QUARTO_PROFILE", "test");
      }
      if (variant === "metadata") {
        await Deno.writeTextFile(dir + "/extra.yml", "filters: [user.lua]\n");
        await Deno.writeTextFile(
          source,
          "---\nmetadata-files: [extra.yml]\n---\n" + body,
        );
      }
      try {
        await renderProject(source);
      } catch (e) {
        assert(
          String(e).includes("UNSUPPORTED_COMPUTED_FILTER"),
          variant + ": " + e,
        );
        assert(await Deno.readTextFile(dir + "/counter.txt") === "run\n");
        assert(await Deno.readTextFile(dir + "/.qbento/state.json") === state);
        assert(await Deno.readTextFile(dir + "/deck.bento.html") === output);
        continue;
      }
      throw new Error("Computed user filter executed: " + variant);
    }
  } finally {
    if (originalProfile === undefined) Deno.env.delete("QUARTO_PROFILE");
    else Deno.env.set("QUARTO_PROFILE", originalProfile);
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("authored-only documents retain user filter support", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-authored-filter-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(
      source,
      "---\nfilters: [user.lua]\n---\n\n## One {#one}\n\n::: {#literal}\nLiteral.\n:::\n",
    );
    await Deno.writeTextFile(
      dir + "/user.lua",
      "function Div(d) return d end\n",
    );
    await assertCompatibleProducerFilters(source);
    const state = (await renderProject(source)).state;
    assert(state.emitted.slides[0].elements.some((e) => e.html === "Literal."));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("a filter confined to an inactive PDF format does not block the inspected HTML format", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-inactive-filter-" });
  try {
    const source = dir + "/deck.qmd";
    await Deno.writeTextFile(
      source,
      "---\nformat:\n  html: default\n  pdf:\n    filters: [user.lua]\n---\n\n## One {#one}\n\n```{r}\n#| label: total\nprint(7)\n```\n",
    );
    await Deno.writeTextFile(
      dir + "/user.lua",
      "function Div(d) return d end\n",
    );
    await assertCompatibleProducerFilters(source, "html");
    const state = (await renderProject(source)).state;
    assert(state.emitted.slides[0].elements.some((e) => e.content === "[1] 7"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("internal filter allowance binds the reviewed bytes and rejects a changed active filter", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-filter-bytes-" });
  try {
    const source = dir + "/deck.qmd",
      filter = dir + "/_extensions/qbento/guard.lua";
    await Deno.mkdir(dir + "/_extensions/qbento", { recursive: true });
    await Deno.writeTextFile(
      source,
      "---\nfilters: [_extensions/qbento/guard.lua]\n---\n\n## One {#one}\n\n```{r}\n#| label: total\nprint(7)\n```\n",
    );
    const original = await Deno.readTextFile(
      new URL("../_extensions/qbento/guard.lua", import.meta.url),
    );
    await Deno.writeTextFile(filter, original);
    await assertCompatibleProducerFilters(source);
    await Deno.writeTextFile(filter, original + "\n-- changed active filter\n");
    try {
      await assertCompatibleProducerFilters(source);
    } catch (e) {
      assert(String(e).includes("UNSUPPORTED_COMPUTED_FILTER"));
      return;
    }
    throw new Error(
      "Modified active internal filter became its own trust authority",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
