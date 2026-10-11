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
Deno.test({
  name:
    "two real computed R plots keep positive default frames, report final overflow and retain saved geometry",
  ignore: !canRun || Deno.build.os !== "linux",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-two-plot-overflow-" });
    const source = dir + "/deck.qmd";
    const fence = String.fromCharCode(96).repeat(3);
    const chunk = (label: string, column: string) =>
      fence + "{r}\n#| label: " + label +
      '\n#| echo: true\n#| dev: svg\nvalues <- read.csv("data.csv")\n' +
      "plot(values$" + column + ', type = "b")\n' + fence + "\n";
    const original = "---\ntitle: Two computed plots\nformat: html\n---\n\n" +
      "## Outputs {#outputs}\n\n" +
      chunk("first-plot", "first") + "\n" + chunk("second-plot", "second");
    const sourceBytes = original;
    try {
      await Deno.writeTextFile(source, original);
      await Deno.writeTextFile(
        dir + "/data.csv",
        "first,second\n1,1\n2,4\n3,9\n4,16\n",
      );
      const first = await renderProject(source);
      const firstSlide = first.state.emitted.slides.find((slide) =>
        slide.id === "outputs"
      )!;
      const pageHeight = (first.state.emitted.size as unknown as {
        height: number;
      }).height;
      const figures = firstSlide.elements.filter((element) =>
        element.type === "image"
      );
      assert(figures.length === 2, JSON.stringify(firstSlide.elements));
      assert(
        firstSlide.elements.every((element) => Number(element.h) > 0),
        JSON.stringify(firstSlide.elements.map((element) => ({
          id: element.id,
          y: element.y,
          h: element.h,
        }))),
      );
      const producers = figures.map((figure) => {
        const proof = first.state.provenance[
          JSON.stringify(["outputs", figure.id])
        ];
        assert(
          proof?.origin === "computed" && !!proof.producer,
          JSON.stringify({ figure: figure.id, proof }),
        );
        return [figure.id, proof.producer];
      });
      const overflows = first.diagnostics.filter((diagnostic) =>
        diagnostic.code === "OVERFLOW"
      );
      const expectedOverflowIds = firstSlide.elements.filter((element) =>
        Number(element.y) + Number(element.h) > pageHeight
      ).map((element) => element.id).sort();
      assert(
        overflows.every((diagnostic) => diagnostic.slideId === "outputs"),
        JSON.stringify(overflows),
      );
      assert(
        JSON.stringify(
          overflows.map((diagnostic) => diagnostic.elementId).sort(),
        ) ===
          JSON.stringify(expectedOverflowIds),
        JSON.stringify({ overflows, expectedOverflowIds }),
      );
      assert(
        overflows.some((diagnostic) => diagnostic.elementId === figures[1].id),
        JSON.stringify({
          figures: figures.map((figure) => figure.id),
          overflows,
        }),
      );

      const fitted = structuredClone(first.state.emitted);
      const fittedSlide = fitted.slides.find((slide) =>
        slide.id === "outputs"
      )!;
      let row = 0;
      for (const element of fittedSlide.elements) {
        if (element.id === "outputs-title") continue;
        element.y = 130 + row * 130;
        element.h = element.type === "image" ? 100 : 90;
        row++;
      }
      assert(
        fittedSlide.elements.every((element) =>
          Number(element.y) >= 0 &&
          Number(element.h) > 0 &&
          Number(element.y) + Number(element.h) <= pageHeight
        ),
        JSON.stringify(fittedSlide.elements.map((element) => ({
          id: element.id,
          y: element.y,
          h: element.h,
        }))),
      );
      await saveProject(source, fitted, first.state.revision);
      await Deno.writeTextFile(
        dir + "/data.csv",
        "first,second\n10,4\n20,1\n30,16\n40,9\n",
      );
      const second = await renderProject(source);
      assert(second.state.docId === first.state.docId, "docId changed");
      assert(
        await Deno.readTextFile(source) === sourceBytes,
        "render changed QMD",
      );
      const secondSlide = second.state.emitted.slides.find((slide) =>
        slide.id === "outputs"
      )!;
      const nextFigures = secondSlide.elements.filter((element) =>
        element.type === "image"
      );
      assert(
        JSON.stringify(nextFigures.map((figure) => figure.id)) ===
          JSON.stringify(figures.map((figure) => figure.id)),
        "computed figure IDs changed",
      );
      assert(
        JSON.stringify(
          nextFigures.map((figure) =>
            second.state.provenance[JSON.stringify(["outputs", figure.id])]
          ).map((proof) => [proof.origin, proof.producer]),
        ) === JSON.stringify(producers.map(([, producer]) => [
          "computed",
          producer,
        ])),
        "computed producer provenance changed",
      );
      assert(
        JSON.stringify(secondSlide.elements.map((element) => [
          element.id,
          element.x,
          element.y,
          element.w,
          element.h,
        ])) === JSON.stringify(fittedSlide.elements.map((element) => [
          element.id,
          element.x,
          element.y,
          element.w,
          element.h,
        ])),
        "saved visual geometry did not survive recompute",
      );
      assert(
        !second.diagnostics.some((diagnostic) =>
          diagnostic.code === "OVERFLOW"
        ),
        JSON.stringify(second.diagnostics),
      );
      assert(
        nextFigures.some((figure, index) => figure.src !== figures[index].src),
        "changed data did not recompute the plots",
      );

      const outside = structuredClone(second.state.emitted);
      const outsideCode = outside.slides.find((slide) =>
        slide.id === "outputs"
      )!.elements.find((element) => element.type === "code")!;
      outsideCode.y = 700;
      const savedOutside = await saveProject(
        source,
        outside,
        second.state.revision,
      );
      const third = await renderProject(source);
      const remaining = third.diagnostics.filter((diagnostic) =>
        diagnostic.code === "OVERFLOW"
      );
      assert(
        remaining.length === 1 &&
          remaining[0].slideId === "outputs" &&
          remaining[0].elementId === outsideCode.id,
        JSON.stringify(remaining),
      );
      assert(
        savedOutside.overrides.length > 0,
        "fitting geometry did not persist as visual overrides",
      );
      assert(
        await Deno.readTextFile(source) === sourceBytes,
        "Save or render changed QMD",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
