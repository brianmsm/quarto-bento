import {
  captureProject,
  projectPaths,
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { extractDocument, spliceDocument } from "../src/render/html.ts";
import { sha256 } from "../src/state/mod.ts";
function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}
async function refuses(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (e) {
    assert(
      (e as { code?: string }).code === code || String(e).includes(code),
      String(e),
    );
    return;
  }
  throw new Error("expected " + code);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "real Quarto capture/recompute/reopen preserves design, pending text and identity; guards native HTML",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-core-" });
    try {
      for (const file of ["presentation.qmd", "data.csv"]) {
        await Deno.copyFile(
          new URL("../fixtures/basic/" + file, import.meta.url),
          `${dir}/${file}`,
        );
      }
      const source = `${dir}/presentation.qmd`,
        original = await Deno.readTextFile(source);
      const first = await renderProject(source),
        html = await Deno.readTextFile(first.output),
        doc = extractDocument(html);
      const figure = doc.slides[0].elements.find((e) => e.id === "fig-values")!;
      const oldImage = figure.src;
      figure.x = 333;
      figure.w = 640;
      doc.slides[0].elements.find((e) => e.id === "finding/paragraph:1")!.html =
        "A pending authored edit.";
      doc.slides[0].elements.push({
        id: "decoration",
        type: "shape",
        shape: "rect",
        x: 20,
        y: 20,
        w: 20,
        h: 20,
        rotation: 0,
        opacity: 1,
        fill: "#ff0000",
        stroke: "transparent",
        strokeWidth: 0,
      });
      await Deno.writeTextFile(first.output, spliceDocument(html, doc));
      await refuses(() => renderProject(source), "UNCAPTURED_HTML_EDITS");
      await captureProject(source);
      const captured = await readProject(source);
      assert(captured.pending.some((p) => p.path[0] === "html"));
      assert(
        await Deno.readTextFile(source) === original,
        "capture changed QMD",
      );
      await Deno.writeTextFile(`${dir}/data.csv`, "x,y\n1,9\n2,3\n3,1\n4,5\n");
      const second = await renderProject(source);
      const current = extractDocument(await Deno.readTextFile(second.output));
      const updated = current.slides[0].elements.find((e) =>
        e.id === "fig-values"
      )!;
      assert(updated.x === 333 && updated.w === 640, "geometry lost");
      assert(updated.src !== oldImage, "computed SVG stale");
      assert(current.docId === doc.docId, "docId changed");
      assert(
        current.slides[0].elements.some((e) => e.id === "decoration"),
        "decoration lost",
      );
      assert(
        current.slides[0].elements.find((e) => e.id === "finding/paragraph:1")!
          .html === "A pending authored edit.",
        "pending edit lost",
      );
      await refuses(
        () => saveProject(source, second.state.emitted, 1),
        "STALE_REVISION",
      );
      await Deno.remove(second.output);
      const rebuilt = await renderProject(source);
      assert(rebuilt.state.docId === doc.docId, "rebuild identity changed");
      const before = await sha256(await Deno.readFile(rebuilt.output));
      await Deno.writeTextFile(
        source,
        original.replace(
          "The figure updates when the data change.",
          "A conflicting QMD edit.",
        ),
      );
      await refuses(() => renderProject(source), "MERGE_CONFLICT");
      assert(
        await sha256(await Deno.readFile(rebuilt.output)) === before,
        "conflict touched output",
      );
      assert(
        (await readProject(source)).pending.length > 0,
        "conflict discarded pending",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
