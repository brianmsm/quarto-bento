import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { projectAst } from "../src/render/project.ts";
import {
  applyNotes,
  previewNotes,
  renderPlainNotes,
  sourceNotes,
} from "../src/source/notes.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, StateStore, targetKey } from "../src/state/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    if (
      String(error).includes(code) || (error as { code?: string }).code === code
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const original =
  "---\r\ntitle: Notes\r\n---\r\n\r\n## First {#first}\r\n\r\n::: {#speaker .notes}\r\nPrimera β 😀.\r\nSigue la explicación.\r\n\r\nOtro párrafo.\r\n:::\r\n\r\n## Second {#second}\r\n";
Deno.test("speaker notes patch is bounded, source-safe and revalidated against tampering", async () => {
  const doc = scanSource(original),
    notes = sourceNotes(doc, "speaker", "first");
  eq(notes.text, "Primera β 😀.\nSigue la explicación.\n\nOtro párrafo.");
  const plan = previewNotes(doc, [{
    blockId: "speaker",
    slideId: "first",
    expected: notes.block.content,
    text: "Cambio β 😀\n\nOtro",
  }]);
  eq(
    plan.result,
    original.replace(notes.block.content, "Cambio β 😀\r\n\r\nOtro\r\n"),
  );
  eq(applyNotes(original, plan), plan.result);
  const changed = structuredClone(plan);
  changed.patches[0].span.start = 0;
  await refuses(() => applyNotes(original, changed), "invalid-preview");
  await refuses(() => applyNotes(original + "\n", plan), "stale-source");
  for (
    const text of [
      " two",
      "two  spaces",
      "end\n",
      "\nstart",
      "a\n\n\nb",
      "\tindent",
    ]
  ) {
    await refuses(
      () =>
        previewNotes(doc, [{
          blockId: "speaker",
          slideId: "first",
          expected: notes.block.content,
          text,
        }]),
      "UNSUPPORTED_NOTES_WHITESPACE",
    );
  }
});
Deno.test("QMD blank padding is block separation while native notes edge whitespace refuses", async () => {
  const padded = original.replace("Primera β 😀.", "\r\nPrimera β 😀.").replace(
    "Otro párrafo.\r\n:::",
    "Otro párrafo.\r\n\r\n:::",
  );
  const doc = scanSource(padded),
    binding = sourceNotes(doc, "speaker", "first");
  eq(binding.text, sourceNotes(scanSource(original), "speaker", "first").text);
  eq(doc.text, padded);
  for (
    const text of [
      "\nNative edge",
      "Native edge\n",
      "Native `r 1 + 1`",
      "Native `{python} 1 + 1`",
    ]
  ) {
    await refuses(
      () =>
        previewNotes(doc, [{
          blockId: "speaker",
          slideId: "first",
          expected: binding.block.content,
          text,
        }]),
      text.includes("`")
        ? "COMPUTED_NOTES_UNSUPPORTED"
        : "UNSUPPORTED_NOTES_WHITESPACE",
    );
  }
});
Deno.test("speaker notes reject rich, ambiguous, unbound and computed projection", async () => {
  for (
    const node of [
      { t: "Strong", c: [{ t: "Str", c: "bold" }] },
      { t: "Code", c: [["", [], []], "x"] },
      { t: "RawInline", c: ["html", "<b>x</b>"] },
      { t: "Math", c: [{ t: "InlineMath" }, "x"] },
      { t: "Span", c: [["id", [], []], [{ t: "Str", c: "x" }]] },
    ]
  ) {
    await refuses(
      () => renderPlainNotes([{ t: "Para", c: [node] }]),
      "UNSUPPORTED_NOTES",
    );
  }
  const head = {
    t: "Header",
    c: [2, ["first", [], []], [{ t: "Str", c: "First" }]],
  };
  const note = {
    t: "Div",
    c: [["speaker", ["notes"], []], [{
      t: "Para",
      c: [{ t: "Str", c: "Note" }],
    }]],
  };
  await refuses(
    () => projectAst({ meta: {}, blocks: [head, note, note] }, "doc", []),
    "AMBIGUOUS_NOTES",
  );
  await refuses(
    () => projectAst({ meta: {}, blocks: [note] }, "doc", []),
    "UNMAPPED_NOTES",
  );
  await refuses(
    () =>
      projectAst(
        {
          meta: {},
          blocks: [head, { t: "Div", c: [["cell", ["cell"], []], [note]] }],
        },
        "doc",
        [],
      ),
    "COMPUTED_NOTES_UNSUPPORTED",
  );
});
Deno.test({
  name:
    "real notes preserve plain text and CRLF through durable save, independent QMD edit, bounded sync and render",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-" });
    try {
      const path = dir + "/deck.qmd";
      await Deno.writeTextFile(path, original);
      const first = await renderProject(path);
      eq(
        first.state.emitted.slides[0].notes,
        "Primera β 😀.\nSigue la explicación.\n\nOtro párrafo.",
      );
      eq(
        first.state.provenance[targetKey({ slideId: "first" })].source?.kind,
        "notes",
      );
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].notes = "Nueva β 😀\nSegunda línea\n\nMás contexto";
      edited.slides[0].elements[0].x = 222;
      const saved = await saveProject(path, edited, first.state.revision);
      eq(saved.pending.length, 1);
      eq(saved.pending[0].origin, "authored");
      eq(await Deno.readTextFile(path), original);
      const retained = await renderProject(path);
      eq(retained.state.pending.length, 1);
      eq(retained.state.emitted.slides[0].notes, edited.slides[0].notes);
      const reopened = await new StateStore(dir + "/.qbento").load();
      eq(reopened?.pending, retained.state.pending);
      const independent = original.replace("## Second", "## Changed second");
      await Deno.writeTextFile(path, independent);
      const plan = await previewSync(path);
      eq(plan.changes[0].kind, "notes");
      eq(plan.patch.patches.length, 0);
      eq(plan.notes?.patches.length, 1);
      eq(
        plan.result,
        independent.replace(
          sourceNotes(scanSource(original), "speaker", "first").block.content,
          "Nueva β 😀\r\nSegunda línea\r\n\r\nMás contexto\r\n",
        ).replace("{#first}", "{#first .qbento-design}"),
      );
      const tampered = structuredClone(plan);
      tampered.notes!.patches[0].span.start = 0;
      await refuses(() => applySync(path, tampered), "INVALID_PLAN");
      eq(await Deno.readTextFile(path), independent);
      await applySync(path, plan);
      const final = await renderProject(path);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].notes, edited.slides[0].notes);
      eq(final.state.emitted.slides[0].elements[0].x, 222);
      eq(final.state.emitted.slides[1].elements[0].html, "Changed second");
      const empty = structuredClone(final.state.emitted);
      empty.slides[0].notes = "";
      await saveProject(path, empty, final.state.revision);
      await applySync(path, await previewSync(path));
      const cleared = await renderProject(path);
      eq(cleared.state.pending.length, 0);
      eq(cleared.state.emitted.slides[0].notes, "");
      eq(
        sourceNotes(
          scanSource(await Deno.readTextFile(path)),
          "speaker",
          "first",
        ).block.content,
        "",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "notes conflict on the same source fragment and reconcile explicitly before source sync",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-conflict-" });
    try {
      const path = dir + "/deck.qmd";
      await Deno.writeTextFile(path, original);
      const first = await renderProject(path),
        edited = structuredClone(first.state.emitted);
      edited.slides[0].notes = "Edited in Bento";
      await saveProject(path, edited, first.state.revision);
      const independentlyEdited = original.replace(
        "Primera β 😀.",
        "Edited in QMD.",
      );
      await Deno.writeTextFile(path, independentlyEdited);
      await refuses(() => previewSync(path), "SOURCE_CONFLICT");
      const reconcile = await previewReconcile(path);
      eq(reconcile.changes[0].change.status, "conflict");
      await applyReconcile(path, reconcile, [{
        changeId: reconcile.changes[0].change.id,
        action: "keep-bento",
      }]);
      eq(await Deno.readTextFile(path), independentlyEdited);
      await applySync(path, await previewSync(path));
      const final = await renderProject(path);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].notes, "Edited in Bento");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "notes safely escape structural text and refuse computed original and rich notes",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-safety-" });
    try {
      const path = dir + "/deck.qmd";
      const knitrSource = original.replace(
        "title: Notes",
        "title: Notes\r\nengine: knitr",
      );
      await Deno.writeTextFile(path, knitrSource);
      const first = await renderProject(path),
        edited = structuredClone(first.state.emitted);
      const text =
        '::: {.notes}\n## Literal heading\n\n**literal bold** <b>literal</b> [link](https://example.org)\n\n"quoted" -- dots... and $math$\n\nLiteral `x` with | and {{< meta title >}}';
      edited.slides[0].notes = text;
      await saveProject(path, edited, first.state.revision);
      const plan = await previewSync(path);
      eq(scanSource(plan.result).slides.map((s) => s.id), ["first", "second"]);
      await applySync(path, plan);
      const final = await renderProject(path);
      eq(final.state.pending.length, 0);
      eq(final.state.emitted.slides[0].notes, text);
      const executable = structuredClone(final.state.emitted);
      executable.slides[0].notes = "Literal `r 1 + 1`";
      await saveProject(path, executable, final.state.revision);
      const safeSource = await Deno.readTextFile(path);
      await refuses(() => previewSync(path), "COMPUTED_NOTES_UNSUPPORTED");
      eq(await Deno.readTextFile(path), safeSource);
      for (
        const content of [
          "**bold**",
          "`r 1 + 1`",
          "<b>HTML</b>",
          "[link](https://example.org)",
        ]
      ) {
        const isolated = await Deno.makeTempDir({
          prefix: "qbento-notes-refusal-",
        });
        try {
          const source = isolated + "/deck.qmd";
          await Deno.writeTextFile(
            source,
            `## First {#first}\n\n::: {#speaker .notes}\n${content}\n:::\n`,
          );
          await refuses(
            () => renderProject(source),
            content.startsWith("`r")
              ? "COMPUTED_NOTES_UNSUPPORTED"
              : "UNSUPPORTED_NOTES",
          );
        } finally {
          await Deno.remove(isolated, { recursive: true });
        }
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
