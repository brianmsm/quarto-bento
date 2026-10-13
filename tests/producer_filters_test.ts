import { isolatedEnvironmentTest } from "./helpers/isolated.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import { renderProject } from "../src/core/project.ts";
import { assertCompatibleProducerFilters } from "../src/render/producer-capture.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
isolatedEnvironmentTest(
  "effective computed user filters from QMD, project, profiles and metadata refuse before execution and preserve the prior state",
  import.meta.url,
  async () => {
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
          assert(
            await Deno.readTextFile(dir + "/.qbento/state.json") === state,
          );
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
  },
);
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

isolatedEnvironmentTest(
  "R startup flags that disable original producer capture refuse before computation",
  import.meta.url,
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-startup-proof-" }),
      original = Deno.env.get("QUARTO_KNITR_RSCRIPT_ARGS");
    try {
      const source = dir + "/deck.qmd";
      await Deno.writeTextFile(
        source,
        '## One {#one}\n\n```{r}\n#| label: actual\n#| echo: false\ncat("run\\n",file="counter.txt",append=TRUE)\nprint(555)\n```\n',
      );
      for (
        const flag of ["--vanilla", "--no-init-file", "--quiet,--no-init-file"]
      ) {
        Deno.env.set("QUARTO_KNITR_RSCRIPT_ARGS", flag);
        try {
          await renderProject(source);
        } catch (e) {
          assert(String(e).includes("UNSUPPORTED_PRODUCER_STARTUP"));
          assert(Deno.env.get("QUARTO_KNITR_RSCRIPT_ARGS") === flag);
          try {
            await Deno.stat(dir + "/counter.txt");
          } catch (missing) {
            assert(missing instanceof Deno.errors.NotFound);
            continue;
          }
          throw new Error("Refused adapter startup executed code");
        }
        throw new Error("Startup without adapter was accepted");
      }
    } finally {
      if (original === undefined) Deno.env.delete("QUARTO_KNITR_RSCRIPT_ARGS");
      else Deno.env.set("QUARTO_KNITR_RSCRIPT_ARGS", original);
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("inline computed values refuse user filters before CLI or ordinary execution and retain the baseline", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-inline-filter-" });
  const source = dir + "/deck.qmd";
  const body =
    '---\nengine: knitr\n---\n\n## Inline {#inline}\n\n:::: {#indicator .bento-kpi}\n\n::: {#label bento-role="label"}\nObserved\n:::\n\n::: {#value bento-role="value"}\n`r {cat("once\\n",file="counter.txt",append=TRUE);2}`\n:::\n\n::: {#detail bento-role="detail"}\nComputed inline\n:::\n\n::::\n';
  try {
    await Deno.writeTextFile(source, body);
    await renderProject(source);
    await installQuartoProject(source);
    const state = await Deno.readTextFile(dir + "/.qbento/state.json");
    const output = await Deno.readTextFile(dir + "/deck.bento.html");
    await Deno.writeTextFile(
      dir + "/replace.lua",
      'function Str(s) if s.text == "2" then return pandoc.Str("999") end end\n',
    );
    const changed = body.replace(
      "engine: knitr",
      "engine: knitr\nfilters: [replace.lua]",
    );
    await Deno.writeTextFile(source, changed);
    for (const route of ["cli", "ordinary"]) {
      if (route === "cli") {
        let refused = false;
        try {
          await renderProject(source);
        } catch (error) {
          refused = String(error).includes("UNSUPPORTED_COMPUTED_FILTER");
        }
        assert(refused, "CLI accepted transformed inline computation");
      } else {
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          args: ["render", "deck.qmd", "--quiet"],
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(
          !result.success &&
            new TextDecoder().decode(result.stderr).includes(
              "UNSUPPORTED_COMPUTED_FILTER",
            ),
        );
      }
      assert(
        await Deno.readTextFile(dir + "/counter.txt") === "once\n",
        `${route} executed inline source before refusal`,
      );
      assert(await Deno.readTextFile(dir + "/.qbento/state.json") === state);
      assert(await Deno.readTextFile(dir + "/deck.bento.html") === output);
      assert(await Deno.readTextFile(source) === changed);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
