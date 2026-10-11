import { projectAst } from "../src/render/project.ts";
import type { Ast } from "../src/render/types.ts";

function imageAst(src: string): Ast {
  return {
    meta: {},
    blocks: [{
      t: "Para",
      c: [{ t: "Image", c: [["image", [], []], [], [src, ""]] }],
    }],
  };
}

Deno.test({
  name: "network and device image paths refuse before any filesystem lookup",
  permissions: { read: false },
  fn: async () => {
    for (
      const src of [
        "https://example.invalid/image.svg",
        "file:///image.svg",
        "//server/share/image.svg",
        String.raw`\\server\share\image.svg`,
        String.raw`\\?\UNC\server\share\image.svg`,
        String.raw`\\.\device\image.svg`,
        String.raw`/\server\share\image.svg`,
        String.raw`\/server/share/image.svg`,
      ]
    ) {
      try {
        await projectAst(imageAst(src), "local-test", ["/project"]);
      } catch (error) {
        if (String(error).includes("EXTERNAL_ASSET")) continue;
        throw new Error(
          `filesystem lookup preceded network-path refusal: ${error}`,
        );
      }
      throw new Error(`accepted network/device image: ${src}`);
    }
  },
});

Deno.test({
  name: "lexically outside image paths refuse before filesystem lookup",
  permissions: { read: false },
  fn: async () => {
    try {
      await projectAst(imageAst("../outside/image.svg"), "local-test", [
        "/project",
      ]);
    } catch (error) {
      if (String(error).includes("MISSING_ASSET")) return;
      throw new Error(`filesystem lookup preceded containment check: ${error}`);
    }
    throw new Error("accepted lexically external image");
  },
});
