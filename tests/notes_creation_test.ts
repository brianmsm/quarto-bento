import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { patchAgentDeck } from "../src/core/agent.ts";
import { applyStructure, previewStructure } from "../src/source/structure.ts";
import { notesIdentity, sourceNotes } from "../src/source/notes.ts";
import { scanSource } from "../src/source/mod.ts";
import { type BentoSlide, canonical } from "../src/state/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (
      String(error).includes(code) || (error as { code?: string }).code === code
    ) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test("notes insertion exact Unicode/CRLF source bounds and forged/stale/collision/execution refusals", async () => {
  const original = "## Uno {#one}\r\n\r\nTexto β.\r\n\r\n## Dos {#two}\r\n";
  const op = {
    type: "insert-notes" as const,
    slideId: "one",
    id: notesIdentity("one"),
    text: "Apunte β 😀\n\n**literal**",
  };
  const plan = previewStructure(scanSource(original), [op]);
  eq(
    plan.result,
    original.replace(
      "## Dos",
      `::: {#${op.id} .notes}\r\nApunte β 😀\r\n\r\n\\*\\*literal\\*\\*\r\n:::\r\n\r\n## Dos`,
    ),
  );
  eq(applyStructure(original, plan), plan.result);
  const forged = structuredClone(plan);
  forged.steps[0].edits[0].span.start = 0;
  await refuses(() => applyStructure(original, forged), "invalid-preview");
  await refuses(() => applyStructure(original + "\n", plan), "stale-source");
  await refuses(
    () => previewStructure(scanSource(plan.result), [op]),
    "duplicate-id",
  );
  await refuses(
    () =>
      previewStructure(
        scanSource(original.replace("Texto β.", "::: {.notes}\nExisting\n:::")),
        [op],
      ),
    "AMBIGUOUS_NOTES",
  );
  await refuses(
    () =>
      previewStructure(scanSource(original), [{
        ...op,
        text: "`r writeLines('bad', 'marker')`",
      }]),
    "COMPUTED_NOTES_UNSUPPORTED",
  );
});
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
for (const weak of [false, true]) {
  Deno.test({
    name: `new native notes on ${
      weak ? "plain" : "identified"
    } QMD survive pending render, selected review, apply and fresh state-only rebuild`,
    ignore: !canRun,
    fn: async () => {
      const dir = await Deno.makeTempDir({ prefix: "qbento-notes-new-" });
      try {
        const path = dir + "/deck.qmd";
        const original = `---\r\nqbento-annotations: none\r\n---\r\n\r\n## Uno${
          weak ? "" : " {#one}"
        }\r\n\r\nTexto β.\r\n\r\n## Dos${weak ? "" : " {#two}"}\r\n`;
        await Deno.writeTextFile(path, original);
        const first = (await renderProject(path)).state;
        const doc = structuredClone(first.emitted), slide = doc.slides[0];
        slide.notes = "Notas β 😀\n\nLiteral **marca**";
        slide.elements[0].x = 241;
        doc.slides[1].elements[0].html = "Título pendiente";
        await saveProject(path, doc, first.revision);
        eq(await Deno.readTextFile(path), original);
        const retained = (await renderProject(path)).state;
        eq(retained.emitted.slides[0].notes, slide.notes);
        eq((await readProject(path))?.revision, retained.revision);
        const notes = retained.pending.filter((p) =>
          canonical(p.path) === canonical(["notes"])
        );
        eq(notes.length, 1);
        const plan = await previewSync(path, [notes[0].id]);
        eq(plan.changes.filter((change) => change.kind === "notes").length, 1);
        eq(plan.structure?.operations.map((o) => o.type), ["insert-notes"]);
        const forged = structuredClone(plan);
        forged.structure!.steps[0].edits[0].replacement += "bad";
        await refuses(() => applySync(path, forged), "INVALID_PLAN");
        eq(await Deno.readTextFile(path), original);
        await Deno.writeTextFile(path, original + "\r\n");
        await refuses(() => applySync(path, plan), "STALE_SOURCE");
        eq((await readProject(path))?.revision, retained.revision);
        await Deno.writeTextFile(path, original);
        await applySync(path, plan);
        const final = (await renderProject(path)).state;
        eq(final.emitted.slides[0].notes, slide.notes);
        eq(final.emitted.slides[0].elements[0].x, 241);
        eq(final.docId, first.docId);
        eq(final.pending.length, 1);
        eq(final.pending[0].target.slideId, doc.slides[1].id);
        eq(
          sourceNotes(
            scanSource(await Deno.readTextFile(path)),
            notesIdentity(slide.id),
            slide.id,
          ).text,
          slide.notes,
        );
        const copy = dir + "/rebuilt";
        await Deno.mkdir(copy + "/.qbento", { recursive: true });
        for (
          const file of [
            "deck.qmd",
            ".qbento/state.json",
            ".qbento/project.json",
          ]
        ) await Deno.copyFile(dir + "/" + file, copy + "/" + file);
        const rebuilt = (await renderProject(copy + "/deck.qmd")).state;
        eq(rebuilt.emitted, final.emitted);
        eq(rebuilt.pending, final.pending);
        eq(rebuilt.docId, first.docId);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
Deno.test({
  name:
    "agent creates and patches new authored slide notes atomically then exact reviewed sync",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-agent-" });
    try {
      const path = dir + "/deck.qmd", original = "## Original {#original}\n";
      await Deno.writeTextFile(path, original);
      const first = (await renderProject(path)).state;
      const slide: BentoSlide = {
        id: "added",
        notes: "Initial notes",
        elements: [{
          id: "added-title",
          type: "text",
          html: "New title",
          x: 10,
          y: 20,
          w: 600,
          h: 80,
        }],
      };
      const request = {
        version: 1,
        docId: first.docId,
        expectedRevision: first.revision,
        operations: [{
          op: "slide.create",
          slideId: slide.id,
          afterId: "original",
          slide,
        }, {
          op: "slide.patch",
          slideId: slide.id,
          fields: { notes: "Final β notes\r\nSecond line" },
        }],
      };
      const bad = structuredClone(request);
      bad.operations[1].fields = { notes: "`r writeLines('bad','marker')`" };
      await refuses(
        () => patchAgentDeck(path, bad),
        "COMPUTED_NOTES_UNSUPPORTED",
      );
      eq((await readProject(path))?.revision, first.revision);
      eq(await Deno.readTextFile(path), original);
      await patchAgentDeck(path, request);
      eq(await Deno.readTextFile(path), original);
      await renderProject(path);
      const plan = await previewSync(path);
      eq(plan.structure?.operations.map((o) => o.type), [
        "insert-slide",
        "insert-notes",
        "reorder-slides",
      ]);
      await applySync(path, plan);
      const final = (await renderProject(path)).state;
      eq(final.pending.length, 0);
      eq(final.docId, first.docId);
      eq(final.emitted.slides[1].notes, "Final β notes\nSecond line");
      eq(final.emitted.slides[1].elements[0].x, 10);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "new notes refuse changed source and executable text without modifying source, HTML or saved state",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-refuse-new-" });
    try {
      const path = dir + "/deck.qmd", original = "## Original {#original}\n";
      await Deno.writeTextFile(path, original);
      const first = (await renderProject(path)).state;
      const edited = structuredClone(first.emitted);
      edited.slides[0].notes = "New note";
      await saveProject(path, edited, first.revision);
      const html = await Deno.readTextFile(dir + "/deck.bento.html");
      const saved = await Deno.readTextFile(dir + "/.qbento/state.json");
      const modified = original +
        "\n::: {#source-notes .notes}\nIndependently authored.\n:::\n";
      await Deno.writeTextFile(path, modified);
      await refuses(() => previewSync(path), "UNMAPPED_NOTES");
      eq(await Deno.readTextFile(path), modified);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), saved);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), html);
      await Deno.writeTextFile(path, original);
      const state = await readProject(path);
      edited.slides[0].notes = "`r writeLines('bad', 'marker')`";
      await saveProject(path, edited, state.revision);
      const unsafeSaved = await Deno.readTextFile(dir + "/.qbento/state.json");
      await refuses(() => previewSync(path), "COMPUTED_NOTES_UNSUPPORTED");
      eq(await Deno.readTextFile(path), original);
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), unsafeSaved);
      await refuses(() => Deno.stat(dir + "/marker"), "NotFound");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
