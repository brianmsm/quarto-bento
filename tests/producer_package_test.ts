import { StateStore } from "../src/state/mod.ts";
import { buildDevelopmentPackage } from "../scripts/package.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
Deno.test("offline portable package includes the producer adapter and can execute it from its runtime path", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-producer-package-" });
  try {
    const destination = resolve(dir, "package"),
      manifest = await buildDevelopmentPackage({ destination });
    if (
      !manifest.files.some((f) =>
        f.path === "runtime/src/render/producer-profile.R" && f.bytes > 0
      )
    ) throw new Error("R adapter omitted from package");
    const original = await Deno.readTextFile(
      fileURLToPath(
        new URL("../src/render/producer-profile.R", import.meta.url),
      ),
    );
    if (
      await Deno.readTextFile(
        resolve(destination, "runtime/src/render/producer-profile.R"),
      ) !== original
    ) throw new Error("R adapter contents differ");
    const source = resolve(dir, "deck.qmd");
    await Deno.writeTextFile(
      source,
      '## One {#one}\n\n```{r}\n#| label: total\n#| echo: false\ncat("run\\n", file="counter.txt", append=TRUE)\nprint(7)\n```\n',
    );
    const module = await import(
      new URL(
        "./package/runtime/src/render/quarto.ts",
        new URL("file://" + dir + "/"),
      ).href
    );
    const ast = await module.executeQuarto(source, resolve(dir, "build"));
    if (!JSON.stringify(ast).includes("qbento-producer-proof")) {
      throw new Error("Packaged adapter did not produce execution receipt");
    }
    if (
      !manifest.files.some((f) =>
        f.path === "runtime/_extensions/qbento/producer-activation.js"
      )
    ) throw new Error("Ordinary producer activation omitted from package");
    const integration = await import(
      new URL(
        "./package/runtime/src/integration/install.ts",
        new URL("file://" + dir + "/"),
      ).href
    );
    await integration.installQuartoProject(source);
    const ordinary = await new Deno.Command("quarto", {
      cwd: dir,
      args: ["render", "deck.qmd"],
      env: {
        XDG_CACHE_HOME: resolve(dir, "cache"),
        QUARTO_RUN_NO_NETWORK: "true",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!ordinary.success) {
      throw new Error(new TextDecoder().decode(ordinary.stderr));
    }
    const state = await new StateStore(resolve(dir, ".qbento")).load();
    if (!state) throw new Error("Packaged ordinary state missing");
    if (
      !state.emitted.slides[0].elements.some((
        e: { id: string; content?: string },
      ) => e.id === "total/code:1" && e.content === "[1] 7")
    ) {
      throw new Error(
        "Packaged ordinary adapter did not preserve actual producer",
      );
    }
    if (await Deno.readTextFile(resolve(dir, "counter.txt")) !== "run\nrun\n") {
      throw new Error("Packaged execution repeated or skipped a computation");
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
