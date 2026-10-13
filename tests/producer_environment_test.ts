import { isolatedEnvironmentTest } from "./helpers/isolated.ts";
import { resolve } from "node:path";
import { producerEnvironment } from "../src/render/producer-environment.ts";
import { readProject, renderProject } from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
isolatedEnvironmentTest(
  "Renviron parsing never loads profiles or user default packages and retains native expansion",
  import.meta.url,
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-environ-" });
    try {
      const profile = "stop('Profile must not load in data-only probe')\n";
      await Deno.writeTextFile(resolve(dir, "custom.R"), profile);
      await Deno.writeTextFile(
        resolve(dir, ".Renviron"),
        'R_PROFILE_USER="${QB_ENV_PROFILE-custom.R}"\nR_DEFAULT_PACKAGES="qbento_package_that_is_not_installed"\nQB_ENV_RESULT="${QB_ENV_INPUT-default} value"\n',
      );
      const result = await producerEnvironment({
        cwd: dir,
        env: {
          QB_ENV_INPUT: "literal β",
          R_ENVIRON_USER: resolve(dir, ".Renviron"),
        },
      });
      assert(result.originalProfile === "custom.R");
      assert(result.effective.QB_ENV_RESULT === "literal β value");
      assert(
        result.effective.R_DEFAULT_PACKAGES ===
          "qbento_package_that_is_not_installed",
      );
      assert(
        !("R_SESSION_TMPDIR" in result.effective) ||
          result.effective.R_SESSION_TMPDIR ===
            Deno.env.get("R_SESSION_TMPDIR"),
      );
      assert(await Deno.readTextFile(resolve(dir, "custom.R")) === profile);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);
isolatedEnvironmentTest(
  "CLI and ordinary Quarto preserve effective Renviron profiles and execute site, user and chunks once",
  import.meta.url,
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-environ-real-" });
    const original = Deno.env.toObject();
    const source = resolve(dir, "deck.qmd");
    const qmd =
      '## Results {#results}\n\n```{r}\n#| label: actual\n#| echo: false\ncat("chunk\\n",file="chunks.txt",append=TRUE)\nprint(getOption("qb.profile","empty"))\nprint(Sys.getenv("QB_ENV_VALUE"))\nprint(Sys.getenv("R_DEFAULT_PACKAGES"))\n```\n';
    try {
      await Deno.writeTextFile(source, qmd);
      await Deno.writeTextFile(
        resolve(dir, "site.R"),
        'cat("site\\n",file="profiles.txt",append=TRUE)\n',
      );
      await Deno.writeTextFile(
        resolve(dir, "selected.R"),
        'cat("user\\n",file="profiles.txt",append=TRUE)\noptions(qb.profile="selected β")\n',
      );
      await Deno.writeTextFile(
        resolve(dir, "site.env"),
        'R_ENVIRON_USER="selected.env"\nQB_ENV_VALUE="site"\n',
      );
      await Deno.writeTextFile(
        resolve(dir, "selected.env"),
        'R_PROFILE_USER="${QB_ENV_PROFILE-selected.R}"\nQB_ENV_VALUE="${QB_ENV_VALUE} user β"\n',
      );
      await Deno.writeTextFile(
        resolve(dir, ".Renviron"),
        'R_PROFILE_USER="selected.R"\nQB_ENV_VALUE="local β"\n',
      );
      Deno.env.set("R_PROFILE", resolve(dir, "site.R"));
      Deno.env.delete("R_PROFILE_USER");
      Deno.env.delete("R_ENVIRON");
      Deno.env.delete("R_ENVIRON_USER");
      for (const mode of ["cli", "ordinary"] as const) {
        if (mode === "ordinary") await installQuartoProject(source);
        for (
          const variant of [
            "local",
            "site-selected",
            "empty",
            "relative",
            "site-profile-selected",
            "packages-from-environ",
          ] as const
        ) {
          Deno.env.delete("R_ENVIRON");
          Deno.env.delete("R_ENVIRON_USER");
          Deno.env.delete("R_PROFILE_USER");
          Deno.env.delete("QUARTO_KNITR_RSCRIPT_ARGS");
          if (variant === "site-selected") {
            Deno.env.set("R_ENVIRON", resolve(dir, "site.env"));
          }
          if (variant === "empty") {
            Deno.env.set("R_ENVIRON_USER", "");
            Deno.env.set("R_PROFILE_USER", "");
          }
          await Deno.writeTextFile(
            resolve(dir, "site.R"),
            'cat("site\\n",file="profiles.txt",append=TRUE)\n' +
              (variant === "site-profile-selected"
                ? 'Sys.setenv(R_PROFILE_USER="selected.R")\n'
                : ""),
          );
          if (variant === "site-profile-selected") {
            Deno.env.set("R_ENVIRON_USER", "");
            Deno.env.set("R_PROFILE_USER", "");
          }
          await Deno.writeTextFile(
            resolve(dir, "selected.env"),
            'R_PROFILE_USER="${QB_ENV_PROFILE-selected.R}"\nQB_ENV_VALUE="${QB_ENV_VALUE} user β"\n' +
              (variant === "packages-from-environ"
                ? 'R_DEFAULT_PACKAGES="stats,utils"\n'
                : ""),
          );
          if (variant === "packages-from-environ") {
            Deno.env.set("R_ENVIRON_USER", "selected.env");
            Deno.env.set(
              "QUARTO_KNITR_RSCRIPT_ARGS",
              "--default-packages=datasets",
            );
          }
          if (variant === "relative") {
            Deno.env.set("R_ENVIRON_USER", "selected.env");
          }
          await Deno.writeTextFile(resolve(dir, "profiles.txt"), "");
          await Deno.writeTextFile(resolve(dir, "chunks.txt"), "");
          let state;
          if (mode === "cli") state = (await renderProject(source)).state;
          else {
            const r = await new Deno.Command("quarto", {
              cwd: dir,
              args: ["render", "deck.qmd", "--quiet"],
              stdout: "piped",
              stderr: "piped",
            }).output();
            assert(r.success, new TextDecoder().decode(r.stderr));
            state = await readProject(source);
          }
          const content = state.emitted.slides[0].elements.map((e) => e.content)
            .join("\n");
          assert(
            content.includes(
              variant === "empty" ? '[1] "empty"' : '[1] "selected β"',
            ),
            `${mode}/${variant}: ${content}`,
          );
          assert(
            await Deno.readTextFile(resolve(dir, "profiles.txt")) ===
              (variant === "empty" ? "site\n" : "site\nuser\n"),
            `${mode}/${variant}: profile repeated`,
          );
          assert(
            await Deno.readTextFile(resolve(dir, "chunks.txt")) === "chunk\n",
            `${mode}/${variant}: chunk repeated`,
          );
          if (variant === "packages-from-environ") {
            assert(
              content.includes('[1] "stats,utils"'),
              "default package precedence changed",
            );
          }
          assert(await Deno.readTextFile(source) === qmd);
          assert(
            Deno.env.get("R_ENVIRON_USER") ===
              ((variant === "empty" || variant === "site-profile-selected")
                ? ""
                : (variant === "relative" ||
                    variant === "packages-from-environ")
                ? "selected.env"
                : undefined),
          );
        }
      }
    } finally {
      for (
        const name of [
          "R_PROFILE",
          "R_PROFILE_USER",
          "R_ENVIRON",
          "R_ENVIRON_USER",
          "QUARTO_KNITR_RSCRIPT_ARGS",
        ]
      ) {
        if (original[name] === undefined) Deno.env.delete(name);
        else Deno.env.set(name, original[name]);
      }
      await Deno.remove(dir, { recursive: true });
    }
  },
);
isolatedEnvironmentTest(
  "authored-only capture does not require or launch an R interpreter",
  import.meta.url,
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-authored-no-r-" });
    const previous = Deno.env.get("QUARTO_R");
    try {
      const missing = resolve(dir, "no-r");
      await Deno.mkdir(missing);
      Deno.env.set("QUARTO_R", missing);
      const source = resolve(dir, "deck.qmd");
      const text = "## Authored {#authored}\n\nLiteral β text.\n";
      await Deno.writeTextFile(source, text);
      const result = await renderProject(source);
      assert(result.state.emitted.slides[0].elements.length === 2);
      assert(await Deno.readTextFile(source) === text);
    } finally {
      if (previous === undefined) Deno.env.delete("QUARTO_R");
      else Deno.env.set("QUARTO_R", previous);
      await Deno.remove(dir, { recursive: true });
    }
  },
);
