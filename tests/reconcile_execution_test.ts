import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "real Quarto conflict review rebases approved authored edit, then separate sync/render clears it",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({
      prefix: "qbento-conflict-execution-",
    });
    try {
      for (const file of ["presentation.qmd", "data.csv"]) {
        await Deno.copyFile(
          new URL("../fixtures/basic/" + file, import.meta.url),
          dir + "/" + file,
        );
      }
      const source = dir + "/presentation.qmd",
        original = await Deno.readTextFile(source),
        first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements.find((e) => e.id === "finding/paragraph:1")!
        .html = "Reviewed Bento choice.";
      edited.slides[0].elements.find((e) => e.id === "fig-values")!.x = 321;
      await saveProject(source, edited, first.state.revision);
      const external = original.replace(
        "The figure updates when the data change.",
        "Independently changed QMD.",
      );
      await Deno.writeTextFile(source, external);
      const preview = await previewReconcile(source),
        conflict = preview.changes.find((i) => i.change.status === "conflict")!;
      assert(conflict.change.after.value === "Reviewed Bento choice.");
      assert(conflict.change.source?.value === "Independently changed QMD.");
      const applied = await applyReconcile(source, preview, [{
        changeId: conflict.change.id,
        action: "keep-bento",
      }]);
      assert(
        applied.remaining.length === 1 &&
          applied.remaining[0].status === "bento-ahead",
      );
      assert(
        await Deno.readTextFile(source) === external,
        "reconciliation must not rewrite QMD",
      );
      await applySync(source, await previewSync(source));
      const final = await renderProject(source);
      assert(final.state.pending.length === 0);
      assert(final.state.docId === first.state.docId);
      assert(
        final.state.emitted.slides[0].elements.find((e) =>
          e.id === "fig-values"
        )!.x === 321,
      );
      assert(
        (await readProject(source)).emitted.slides[0].elements.find((e) =>
          e.id === "finding/paragraph:1"
        )!.html === "Reviewed Bento choice.",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
