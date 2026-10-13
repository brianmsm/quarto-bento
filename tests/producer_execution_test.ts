import { isolatedEnvironmentTest } from "./helpers/isolated.ts";
import { renderProject } from "../src/core/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { scanSource } from "../src/source/mod.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
async function fixture(body: string) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-producer-test-" }),
    source = dir + "/deck.qmd";
  await Deno.writeTextFile(source, "## One {#one}\n\n" + body);
  return { dir, source };
}
Deno.test("dynamic partial echo and option hooks cannot borrow another original producer", async () => {
  const f = await fixture(
    '```{r}\n#| label: setup\n#| include: false\nuser_hook <- function(options) { if (options$label == "actual") { options$label <- "decoy"; options$code <- "print(555)" }; options }\nknitr::opts_hooks$restore(c(list(echo=user_hook), knitr::opts_hooks$get()))\nknitr::opts_chunk$set(echo=c(1,2))\n```\n\n```{r}\n#| label: actual\nprint(1)\nprint(2)\nprint(3)\n```\n\n```{r}\n#| label: decoy\n#| include: false\nprint(1)\nprint(2)\n```\n',
  );
  try {
    const state = (await renderProject(f.source)).state,
      output = state.emitted.slides[0].elements.find((e) =>
        e.type === "code" && e.content === "[1] 555"
      )!;
    assert(output && output.id.startsWith("actual/code:"));
    assert(
      state.provenance[targetKey({ slideId: "one", elementId: output.id })]
        .producer === "actual",
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("fresh receipts wrap cache hits without changing the cache key or repeating execution", async () => {
  const f = await fixture(
    '```{r}\n#| label: cached\n#| cache: true\n#| echo: false\ncat("run\\n",file="counter.txt",append=TRUE)\nprint(7)\n```\n',
  );
  try {
    const before = await Deno.readTextFile(f.source);
    const a = JSON.stringify(await executeQuarto(f.source, f.dir + "/build"));
    const b = JSON.stringify(await executeQuarto(f.source, f.dir + "/build"));
    assert(await Deno.readTextFile(f.dir + "/counter.txt") === "run\n");
    const token = (s: string) =>
      s.match(/qbento-producer-proof","([^"]+)"/)?.[1];
    assert(token(a) && token(b) && token(a) !== token(b));
    assert(await Deno.readTextFile(f.source) === before);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("unlabelled chunks count separately from explicit labels and retain original source IDs", async () => {
  const f = await fixture(
    "```{r}\nprint(1)\n```\n\n```{r named}\nprint(2)\n```\n\n```{r}\nprint(3)\n```\n",
  );
  try {
    const original = await Deno.readTextFile(f.source),
      chunks = scanSource(original).blocks.filter((b) => b.kind === "chunk");
    const state = (await renderProject(f.source)).state;
    for (const [i, chunk] of chunks.entries()) {
      const out = state.emitted.slides[0].elements.find((e) =>
        e.type === "code" && e.content === `[1] ${i + 1}`
      )!;
      assert(
        state.provenance[targetKey({ slideId: "one", elementId: out.id })]
          .producer === chunk.id,
      );
    }
    assert(await Deno.readTextFile(f.source) === original);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("foreign child knit cannot borrow an original hidden producer even with equal source code", async () => {
  const f = await fixture(
    "```{r}\n#| label: decoy\n#| include: false\n#| eval: false\n```\n\n```{r}\n#| label: actual\n#| child: child.Rmd\n```\n",
  );
  try {
    await Deno.writeTextFile(
      f.dir + "/child.Rmd",
      "```{r}\n#| label: decoy\n#| code: print(555)\n#| echo: false\n```\n",
    );
    try {
      await renderProject(f.source);
    } catch (e) {
      assert(
        String(e).includes("UNMAPPED_PRODUCER_RECEIPT") &&
          String(e).includes("nested or foreign"),
      );
      return;
    }
    throw new Error("Child output borrowed source producer");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
isolatedEnvironmentTest(
  "R profile selection preserves unset, empty and relative explicit settings and profile errors",
  import.meta.url,
  async () => {
    const f = await fixture(
      '```{r}\n#| label: profile\n#| echo: false\nprint(getOption("qbento.profile", "empty"))\n```\n',
    );
    const original = Deno.env.get("R_PROFILE_USER"),
      originalUser = Deno.env.get("R_ENVIRON_USER");
    try {
      await Deno.writeTextFile(
        f.dir + "/.Rprofile",
        'options(qbento.profile="local")\n',
      );
      await Deno.writeTextFile(
        f.dir + "/explicit.R",
        'options(qbento.profile="explicit")\n',
      );
      for (
        const [profile, expected] of [[undefined, "local"], ["", "empty"], [
          "explicit.R",
          "explicit",
        ]] as const
      ) {
        if (profile === undefined) Deno.env.delete("R_PROFILE_USER");
        else Deno.env.set("R_PROFILE_USER", profile);
        const state = (await renderProject(f.source)).state;
        assert(
          state.emitted.slides[0].elements.some((e) =>
            e.content === `[1] "${expected}"`
          ),
        );
        assert(Deno.env.get("R_PROFILE_USER") === profile);
      }
      await Deno.mkdir(f.dir + "/ruser");
      await Deno.writeTextFile(
        f.dir + "/ruser/.Rprofile",
        'options(qbento.profile="home")\n',
      );
      await Deno.remove(f.dir + "/.Rprofile");
      // R startup reads its own environment fixture; the parent HOME is intact.
      // Preserve the already installed library search paths when selecting the
      // temporary R home, so this fixture does not create or install a library.
      const libraries = await new Deno.Command("Rscript", {
        cwd: f.dir,
        args: ["-e", 'cat(.libPaths(), sep="\\n")'],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(libraries.success);
      const paths = new TextDecoder().decode(libraries.stdout).trim().split(
        "\n",
      )
        .join(Deno.build.os === "windows" ? ";" : ":");
      await Deno.writeTextFile(
        f.dir + "/environment",
        "HOME=" + f.dir + "/ruser\nR_LIBS_USER=" + paths + "\n",
      );
      Deno.env.set("R_ENVIRON_USER", f.dir + "/environment");
      Deno.env.delete("R_PROFILE_USER");
      const homeState = (await renderProject(f.source)).state;
      assert(
        homeState.emitted.slides[0].elements.some((e) =>
          e.content === '[1] "home"'
        ),
      );
      await Deno.writeTextFile(
        f.dir + "/explicit.R",
        'stop("original-profile-error")\n',
      );
      Deno.env.set("R_PROFILE_USER", "explicit.R");
      try {
        await renderProject(f.source);
      } catch (e) {
        assert(String(e).includes("original-profile-error"));
        return;
      }
      throw new Error("Original profile error was swallowed");
    } finally {
      if (original === undefined) Deno.env.delete("R_PROFILE_USER");
      else Deno.env.set("R_PROFILE_USER", original);
      if (originalUser === undefined) Deno.env.delete("R_ENVIRON_USER");
      else Deno.env.set("R_ENVIRON_USER", originalUser);
      await Deno.remove(f.dir, { recursive: true });
    }
  },
);

Deno.test("a filter cannot remove execution receipts and relabel a cell as another producer", async () => {
  const f = await fixture(
    "```{r}\n#| label: actual\n#| echo: false\nprint(555)\n```\n\n```{r}\n#| label: decoy\n#| include: false\nprint(1)\n```\n",
  );
  try {
    await Deno.writeTextFile(
      f.dir + "/strip.lua",
      'function Div(div) if div.classes:includes("qbento-execution") then return div.content end if div.classes:includes("cell") then div.identifier="decoy" end return div end\n',
    );
    const original = "---\nfilters: [strip.lua]\n---\n" +
      await Deno.readTextFile(f.source);
    await Deno.writeTextFile(f.source, original);
    try {
      await renderProject(f.source);
    } catch (e) {
      assert(String(e).includes("UNSUPPORTED_COMPUTED_FILTER"));
      assert(await Deno.readTextFile(f.source) === original);
      try {
        await Deno.stat(f.dir + "/deck.bento.html");
      } catch (missing) {
        assert(missing instanceof Deno.errors.NotFound);
        return;
      }
      throw new Error("Invalid projection was published");
    }
    throw new Error("Removed receipt was accepted");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
