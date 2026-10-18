import { readProjectRegistry } from "../src/core/design-registry.ts";
import { renderProjectFromAst } from "../src/core/project.ts";
import { hashSource } from "../src/source/mod.ts";

Deno.test("registry inspection performs no initialization or lock writes", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-registry-read-" });
  const source = directory + "/deck.qmd";
  const text = "## Slide {#slide}\n\nText.\n";
  try {
    await Deno.writeTextFile(source, text);
    const rendered = await renderProjectFromAst(source, {
      sourceHash: hashSource(text),
      assetDirectories: [directory],
      ast: {
        meta: {},
        blocks: [
          {
            t: "Header",
            c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]],
          },
          { t: "Para", c: [{ t: "Str", c: "Text." }] },
        ],
      },
    });
    const original = Deno.mkdir;
    Deno.mkdir = () => {
      throw new Error("Inspection attempted a directory or lock write");
    };
    try {
      const snapshot = await readProjectRegistry(source);
      if (
        snapshot.docId !== rendered.state.docId || snapshot.hash !== null ||
        snapshot.revision !== rendered.state.revision
      ) {
        throw new Error(
          "Read-only registry snapshot changed identity or state",
        );
      }
    } finally {
      Deno.mkdir = original;
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
