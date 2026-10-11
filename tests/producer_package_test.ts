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
      "## One {#one}\n\n```{r}\n#| label: total\n#| echo: false\nprint(7)\n```\n",
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
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
