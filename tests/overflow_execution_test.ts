import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const original = "## Overflow {#slide}\n\n" +
  Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n") +
  "\n";
Deno.test({
  name:
    "core overflow reflects retained authored geometry, decorative elements and native page height",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-composed-overflow-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, original);
      const base = await renderProject(source);
      assert(
        base.diagnostics.filter((d) => d.code === "OVERFLOW").length === 3,
      );
      const edited = structuredClone(base.state.emitted);
      edited.slides[0].elements.slice(1).forEach((el, i) => {
        el.y = 150 + i * 60;
        el.h = 40;
      });
      edited.slides[0].elements.push({
        id: "decoration",
        type: "shape",
        shape: "rect",
        x: 80,
        y: 660,
        w: 50,
        h: 40,
        fill: "#abcdef",
        stroke: "#000000",
        strokeWidth: 0,
      });
      const saved = await saveProject(source, edited, base.state.revision);
      assert(saved.bentoOnly.length === 1 && saved.pending.length === 0);
      const fitted = await renderProject(source);
      assert(
        !fitted.diagnostics.some((d) => d.code === "OVERFLOW"),
        JSON.stringify(fitted.diagnostics),
      );
      const outside = structuredClone(fitted.state.emitted);
      const body = outside.slides[0].elements[1];
      body.y = 710;
      body.h = 40;
      outside.slides[0].elements.find((el) => el.id === "decoration")!.y = 710;
      await saveProject(source, outside, fitted.state.revision);
      const overflowing = await renderProject(source);
      const diagnostics = overflowing.diagnostics.filter((d) =>
        d.code === "OVERFLOW"
      );
      assert(diagnostics.length === 2, JSON.stringify(diagnostics));
      assert(
        diagnostics.every((d) =>
          d.slideId === "slide" &&
          (d.elementId === body.id || d.elementId === "decoration")
        ),
      );
      const taller = structuredClone(overflowing.state.emitted);
      (taller.size as { height: number }).height = 900;
      await saveProject(source, taller, overflowing.state.revision);
      const alternate = await renderProject(source);
      assert(
        !alternate.diagnostics.some((d) => d.code === "OVERFLOW"),
        JSON.stringify(alternate.diagnostics),
      );
      assert(
        (await readProject(source)).emitted.slides[0].elements.find((el) =>
          el.id === body.id
        )!.y === 710,
      );
      assert(await Deno.readTextFile(source) === original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "ordinary Linux Quarto overflow diagnostics use composed visual positions",
  ignore: !canRun || Deno.build.os !== "linux",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-ordinary-overflow-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, original);
      const base = await renderProject(source);
      const edited = structuredClone(base.state.emitted);
      edited.slides[0].elements.slice(1).forEach((el, i) => {
        el.y = 150 + i * 60;
        el.h = 40;
      });
      await saveProject(source, edited, base.state.revision);
      await installQuartoProject(source);
      const run = async () => {
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          args: ["render"],
          env: {
            QUARTO_RUN_NO_NETWORK: "true",
            XDG_CACHE_HOME: dir + "/cache",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        const log = new TextDecoder().decode(result.stdout) +
          new TextDecoder().decode(result.stderr);
        assert(result.success, log);
        return log;
      };
      assert(!(await run()).includes("OVERFLOW"));
      const current = await readProject(source);
      const outside = structuredClone(current.emitted);
      outside.slides[0].elements[1].y = 710;
      await saveProject(source, outside, current.revision);
      assert((await run()).includes("OVERFLOW"));
      assert(await Deno.readTextFile(source) === original);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
