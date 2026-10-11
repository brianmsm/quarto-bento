/** Real Quarto/knitr integration; add --allow-run to enable in a compatible environment. */
import {
  applyPatches,
  previewPatches,
  resolveSourceMapping,
  scanSource,
  SourceError,
} from "../src/source/mod.ts";
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "Quarto execution preserves explicit authored anchors; computed spans remain refused",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-source-" });
    try {
      const source =
        "---\ntitle: Mapping proof\nformat: html\n---\n\n## Resultados {#results}\n\n::: {#finding .bento-card}\nValor literal.\n:::\n\nDynamic `r 1+1`.\n\n```{r}\n#| label: fig-values\n#| fig-format: svg\nplot(1:3)\n```\n";
      await Deno.writeTextFile(`${dir}/proof.qmd`, source);
      await Deno.writeTextFile(
        `${dir}/capture.lua`,
        'function Pandoc(doc) local f = assert(io.open("executed.json", "w")); f:write(pandoc.write(doc, "json")); f:close(); return doc end',
      );
      const render = async () => {
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          env: { XDG_CACHE_HOME: `${dir}/cache` },
          args: [
            "render",
            "proof.qmd",
            "--to",
            "html",
            "--lua-filter",
            "capture.lua",
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
        if (!result.success) {
          throw new Error(new TextDecoder().decode(result.stderr));
        }
        return JSON.parse(await Deno.readTextFile(`${dir}/executed.json`));
      };
      const executed = await render();
      const serialized = JSON.stringify(executed);
      if (
        !serialized.includes("results") || !serialized.includes("finding") ||
        !serialized.includes("fig-values")
      ) throw new Error("Expected execution anchors were lost.");
      const doc = scanSource(source);
      const block = resolveSourceMapping(doc, {
        sourceHash: doc.hash,
        sourceId: "finding/paragraph:1",
        literal: "Valor literal.",
      });
      const patched = applyPatches(
        source,
        previewPatches(doc, [{
          blockId: block.id,
          expected: "Valor literal.",
          replacement: "Valor editado.",
        }]),
      );
      if (
        patched !== source.replace("Valor literal.", "Valor editado.")
      ) throw new Error("Unrelated original bytes changed.");
      await Deno.writeTextFile(`${dir}/proof.qmd`, patched);
      if (
        !JSON.stringify(await render()).includes("editado.")
      ) throw new Error("Edited authored value absent after re-execution.");
      const dynamic = doc.blocks.find((b) => b.content.includes("Dynamic"))!;
      for (const id of [dynamic.id, "fig-values"]) {
        try {
          previewPatches(doc, [{ blockId: id, replacement: "42" }]);
          throw new Error("Computed edit accepted.");
        } catch (error) {
          if (
            !(error instanceof SourceError) || error.code !== "unmapped"
          ) throw error;
        }
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
