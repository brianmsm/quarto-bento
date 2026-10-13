import { resolve } from "node:path";
import { executeQuarto } from "../src/render/quarto.ts";

Deno.test("internal Quarto render refuses an aliased build directory before writing", async () => {
  const root = await Deno.makeTempDir({ prefix: "qbento-build-alias-" });
  try {
    const project = resolve(root, "project");
    const outside = resolve(root, "outside");
    const state = resolve(project, ".qbento");
    const build = resolve(state, "build");
    const source = resolve(project, "deck.qmd");
    await Deno.mkdir(state, { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(source, "## Trusted source\n\nOrdinary text.\n");
    await Deno.writeTextFile(resolve(outside, "marker.txt"), "KEEP");
    await Deno.symlink(outside, build);
    try {
      await executeQuarto(source, build);
      throw new Error("aliased build was accepted");
    } catch (error) {
      if (!String(error).includes("UNSAFE_BUILD_PATH")) throw error;
    }
    const assertOutsideUntouched = async () => {
      const outsideFiles = [];
      for await (const entry of Deno.readDir(outside)) {
        outsideFiles.push(entry.name);
      }
      if (
        JSON.stringify(outsideFiles) !== '["marker.txt"]' ||
        await Deno.readTextFile(resolve(outside, "marker.txt")) !== "KEEP"
      ) {
        throw new Error(`External directory changed: ${outsideFiles}`);
      }
    };
    await assertOutsideUntouched();
    await Deno.remove(build);
    await Deno.mkdir(build);
    await Deno.symlink(outside, resolve(build, "cache"));
    try {
      await executeQuarto(source, build);
      throw new Error("aliased cache was accepted");
    } catch (error) {
      if (!String(error).includes("UNSAFE_BUILD_PATH")) throw error;
    }
    await assertOutsideUntouched();
    await Deno.remove(resolve(build, "cache"));
    await Deno.symlink(
      resolve(outside, "marker.txt"),
      resolve(build, "file-alias"),
    );
    try {
      await executeQuarto(source, build);
      throw new Error("external file alias was accepted");
    } catch (error) {
      if (!String(error).includes("UNSAFE_BUILD_PATH")) throw error;
    }
    await assertOutsideUntouched();
    await Deno.remove(resolve(build, "file-alias"));
    await Deno.writeTextFile(resolve(build, "internal-cache-file"), "CACHE");
    await Deno.symlink(
      "internal-cache-file",
      resolve(build, "internal-cache-alias"),
    );
    const ast = await executeQuarto(source, build);
    if (!Array.isArray(ast.blocks) || !ast.blocks.length) {
      throw new Error("real build directory did not render");
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
