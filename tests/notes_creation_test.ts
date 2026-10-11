import {
  applyIdentities,
  previewIdentities,
} from "../src/source/identities.ts";
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

Deno.test("retained producer identities preserve executable bytes and reject malformed, displaced, colliding and forged markers", async () => {
  const original = "## A {#a}\r\n\r\n```{r}\r\nplot(1)\r\n```\r\n";
  const doc = scanSource(original),
    chunk = doc.blocks.find((block) => block.kind === "chunk")!;
  const plan = previewIdentities(doc, [], [chunk.id]);
  eq(plan.patches[0].replacement, `<!-- qb-producer:${chunk.id} -->\r\n`);
  const after = scanSource(plan.result).blocks.find((block) =>
    block.id === chunk.id
  )!;
  eq(after.raw, chunk.raw);
  eq(after.content, chunk.content);
  eq(after.origin, "computed");
  eq(after.editable, false);
  eq(after.stable, true);
  eq(applyIdentities(original, plan), plan.result);
  const forged = structuredClone(plan);
  forged.producerRequests![0] = "chunk@999";
  await refuses(() => applyIdentities(original, forged), "ambiguous-identity");
  await refuses(() => applyIdentities(original + "\n", plan), "stale-source");
  await refuses(
    () => previewIdentities(doc, [], [chunk.id, chunk.id]),
    "ambiguous-identity",
  );
  for (
    const invalid of [
      "<!-- qb-producer:chunk@1 -->\nParagraph.\n",
      "<!-- qb-producer:chunk@1 -->\n\n```{r}\n1\n```\n",
      "<!-- qb-producer:chunk@1 -->\n<!-- other -->\n```{r}\n1\n```\n",
      "<!-- qb-producer:chunk@1 -->\n```{r named}\n1\n```\n",
      "<!-- qb-producer:chunk@1 -->\n",
      "<!-- qb-producer:unsafe -->\n```{r}\n1\n```\n",
      "<!-- qb-producer:chunk@1 -->\n```{r}\n1\n```\n\n<!-- qb-producer:chunk@1 -->\n```{r}\n2\n```\n",
    ]
  ) {
    if (!scanSource(invalid).diagnostics.length) {
      throw new Error(`Accepted invalid producer marker: ${invalid}`);
    }
  }
  const embedded = scanSource(
    '```{r}\nx <- "<!-- qb-producer:chunk@99 -->"\n```\n',
  );
  eq(embedded.diagnostics, []);
  eq(embedded.blocks[0].id, "chunk@0");
  eq(embedded.blocks[0].stable, false);
});
Deno.test({
  name:
    "notes before an unlabelled R producer retain computed identities, code and figure design through approved sync and rebuild",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-notes-producer-" });
    try {
      const path = dir + "/deck.qmd",
        original =
          "---\nqbento-annotations: none\n---\n\n## A {#a}\n\nBody before.\n\n## B {#b}\n\n```{r}\nplot(c(1,2,3), c(2,4,6))\n```\n";
      await Deno.writeTextFile(path, original);
      const chunk = scanSource(original).blocks.find((block) =>
        block.kind === "chunk"
      )!;
      const first = (await renderProject(path)).state,
        doc = structuredClone(first.emitted);
      doc.slides[0].notes = "Plain notes before computed content β";
      const computed = doc.slides[1].elements.filter((element) =>
        element.type === "code" || element.type === "image"
      );
      eq(computed.length, 2);
      computed.forEach((element, i) => {
        element.x = 231 + i * 110;
        element.y = 347 + i * 31;
        element.w = 510 - i * 100;
        element.h = 190 + i * 20;
      });
      await saveProject(path, doc, first.revision);
      const pending = (await renderProject(path)).state;
      const plan = await previewSync(path);
      eq(plan.identities?.producerRequests, [chunk.id]);
      eq(
        plan.identities?.patches.filter((patch) => patch.blockId === chunk.id)
          .length,
        1,
      );
      eq(await Deno.readTextFile(path), original);
      const tampered = structuredClone(plan);
      tampered.identities!.producerRequests![0] = "chunk@999";
      await refuses(() => applySync(path, tampered), "INVALID_PLAN");
      eq((await readProject(path)).revision, pending.revision);
      await applySync(path, plan);
      const pinned = scanSource(await Deno.readTextFile(path)).blocks.find(
        (block) => block.id === chunk.id,
      )!;
      eq(pinned.raw, chunk.raw);
      eq(pinned.origin, "computed");
      eq(pinned.stable, true);
      const final = (await renderProject(path)).state;
      eq(final.pending.length, 0);
      eq(final.docId, first.docId);
      eq(final.emitted.slides[1], doc.slides[1]);
      for (const element of computed) {
        const proof = final.provenance[canonical(["b", element.id])];
        eq(proof.origin, "computed");
        eq(proof.producer, chunk.id);
      }
      const copy = dir + "/rebuilt";
      await Deno.mkdir(copy + "/.qbento", { recursive: true });
      for (
        const file of ["deck.qmd", ".qbento/state.json", ".qbento/project.json"]
      ) await Deno.copyFile(dir + "/" + file, copy + "/" + file);
      const rebuilt = (await renderProject(copy + "/deck.qmd")).state;
      eq(rebuilt.emitted, final.emitted);
      eq(rebuilt.pending.length, 0);
      eq(rebuilt.docId, first.docId);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
