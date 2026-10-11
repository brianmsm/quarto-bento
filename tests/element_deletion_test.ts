import { join } from "node:path";
import { applySlideAction } from "../src/core/slide-actions.ts";
import { applyReconcile, previewReconcile } from "../src/core/reconcile.ts";
import { recoverProject } from "../src/core/recovery.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import {
  applySync,
  prepareApprovedSync,
  previewSync,
} from "../src/core/sync.ts";
import { canonical, StateStore, targetKey } from "../src/state/mod.ts";
import { hashSource } from "../src/source/mod.ts";
import { startStudio } from "../src/studio/server.ts";
import { extractDocument } from "../src/render/html.ts";
function ok(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    ok(
      (error as { code?: string }).code === code ||
        String(error).includes(code),
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const authored = `---
title: Delete review
format: html
---

## Slide {#slide}

::: {#body}
Literal β 😀.
:::

::: {#keep}
Keep unchanged.
:::

## Other {#other}

::: {#other-body}
Other content.
:::
`;
async function fixture(text = authored) {
  const directory = await Deno.makeTempDir({
      prefix: "qbento-element-delete-",
    }),
    source = join(directory, "deck.qmd");
  await Deno.writeTextFile(source, text);
  const initial = (await renderProject(source)).state;
  return { directory, source, text, initial };
}
async function remove(
  source: string,
  state: Awaited<ReturnType<typeof readProject>>,
  elementId = "body/paragraph:1",
) {
  const doc = structuredClone(state.emitted);
  doc.slides[0].elements = doc.slides[0].elements.filter((element) =>
    element.id !== elementId
  );
  return await saveProject(source, doc, state.revision);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "deletion under a plain Unicode heading reviews survivor identities and preserves retained native design",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture(
      authored.replace("## Slide {#slide}", "## Éxito sin IDs")
        .replace("::: {#keep}\nKeep unchanged.\n:::", "Keep **unchanged**."),
    );
    try {
      const initialSlide = f.initial.emitted.slides[0];
      const survivor = initialSlide.elements.find((element) =>
        element.type === "text" && typeof element.html === "string" &&
        element.html.includes("unchanged")
      )!;
      ok(survivor);
      const edited = structuredClone(f.initial.emitted);
      const retained = edited.slides[0].elements.find((element) =>
        element.id === survivor.id
      )!;
      retained.x = 419;
      retained.y = 312;
      retained.fontSize = 31;
      const saved = await saveProject(f.source, edited, f.initial.revision);
      const removed = await remove(f.source, saved);
      const deletion = removed.pending.find((p) =>
        p.kind === "delete-element"
      )!;
      const plan = await previewSync(f.source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      eq(plan.identities?.patches.length, 2);
      ok(
        plan.identities!.patches.some((patch) =>
          patch.expected.includes("## Éxito sin IDs")
        ),
      );
      ok(
        plan.identities!.patches.some((patch) =>
          patch.expected.includes("Keep **unchanged**.")
        ),
      );
      eq(await Deno.readTextFile(f.source), f.text);
      eq(canonical(await readProject(f.source)), canonical(removed));
      await applySync(f.source, plan);
      const final = (await renderProject(f.source)).state;
      eq(final.docId, f.initial.docId);
      eq(final.pending, []);
      eq(final.emitted.slides[0].id, initialSlide.id);
      eq(
        final.emitted.slides[0].elements.find((element) =>
          element.id === survivor.id
        ),
        retained,
      );
      eq(final.emitted.slides[1], f.initial.emitted.slides[1]);
      ok(
        !final.emitted.slides[0].elements.some((element) =>
          element.id === "body/paragraph:1"
        ),
      );
      eq(await Deno.readTextFile(f.source), plan.result);
      ok(!plan.result.includes("Literal β 😀."));
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real confirmed element deletion is an exact CRLF patch, retires only its state after fresh render and rebuilds",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture(authored.replaceAll("\n", "\r\n"));
    try {
      const edited = structuredClone(f.initial.emitted),
        slide = edited.slides[0];
      const body = slide.elements.find((element) =>
        element.id === "body/paragraph:1"
      )!;
      body.html = "Pending text before deletion.";
      body.x = 213;
      body.fontSize = 29;
      slide.elements.find((element) => element.id === "keep/paragraph:1")!.x =
        430;
      slide.elements.push({
        id: "decoration",
        type: "shape",
        shape: "rect",
        x: 30,
        y: 30,
        w: 60,
        h: 60,
        fill: "#123456",
      });
      let state = await saveProject(f.source, edited, f.initial.revision);
      state = await remove(f.source, state);
      const deletion = state.pending.find((p) => p.kind === "delete-element")!;
      const beforeState = canonical(state);
      await refuses(() => previewSync(f.source), "CONFIRM_DELETE_REQUIRED");
      const plan = await previewSync(f.source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      const expected = f.text.replace(
        "::: {#body}\r\nLiteral β 😀.\r\n:::\r\n",
        "",
      );
      eq(plan.result, expected);
      eq(plan.structure!.steps[0].operation, {
        type: "delete-block",
        blockId: "body/paragraph:1",
        confirmed: true,
      });
      eq(plan.patch.patches.length, 0);
      eq(await Deno.readTextFile(f.source), f.text);
      eq(canonical(await readProject(f.source)), beforeState);
      const receipt = await applySync(f.source, plan);
      eq(await Deno.readTextFile(f.source), expected);
      eq((await readProject(f.source)).pending, state.pending);
      eq(JSON.parse(await Deno.readTextFile(receipt.stateBackup)).state, state);
      const approval = JSON.parse(
        await Deno.readTextFile(
          join(f.directory, ".qbento", "sync-approved.json"),
        ),
      );
      const current = await readProject(f.source);
      eq(approval.approval.deletionStateHash, hashSource(canonical(current)));
      await refuses(() =>
        prepareApprovedSync(
          current,
          f.initial.generatedBaseline,
          plan.resultHash,
          approval,
        ), "STALE_APPROVAL");
      const changed = structuredClone(current);
      changed.overrides[0].fields[0].value = { present: true, value: 999 };
      await refuses(() =>
        prepareApprovedSync(
          changed,
          f.initial.generatedBaseline,
          plan.resultHash,
          approval,
        ), "STALE_APPROVAL");
      const final = (await renderProject(f.source)).state;
      eq(final.docId, f.initial.docId);
      eq(final.pending, []);
      ok(
        !final.emitted.slides[0].elements.some((element) =>
          element.id === body.id
        ),
      );
      ok(
        !final.overrides.some((item) => item.target.elementId === body.id),
      );
      ok(
        !final.provenance[targetKey({ slideId: "slide", elementId: body.id })],
      );
      eq(
        final.emitted.slides[0].elements.find((element) =>
          element.id === "keep/paragraph:1"
        )!.x,
        430,
      );
      eq(
        final.emitted.slides[0].elements.find((element) =>
          element.id === "decoration"
        ),
        slide.elements.find((element) => element.id === "decoration"),
      );
      eq(final.emitted.slides[1], edited.slides[1]);
      await Deno.remove(join(f.directory, "deck.bento.html"));
      const rebuild = (await renderProject(f.source)).state;
      eq(rebuild.emitted, final.emitted);
      eq(await Deno.readTextFile(f.source), expected);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "delete save reopen and reviewed restore retain pre-existing pending text, complete design and stacking",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      const doc = structuredClone(f.initial.emitted),
        body = doc.slides[0].elements.find((e) => e.id === "body/paragraph:1")!;
      body.html = "Pending <strong>restored</strong>.";
      body.x = 328;
      body.y = 243;
      body.fontSize = 31;
      doc.slides[0].elements.reverse();
      let state = await saveProject(f.source, doc, f.initial.revision);
      const textEdit = state.pending.find((p) =>
        p.target.elementId === body.id
      )!;
      state = await remove(f.source, state);
      const deletion = state.pending.find((p) => p.kind === "delete-element")!;
      state = await readProject(f.source);
      eq(
        state.pending.find((p) => p.id === textEdit.id)!.after,
        textEdit.after,
      );
      const plan = await previewReconcile(f.source);
      const result = await applyReconcile(f.source, plan, [{
        changeId: deletion.id,
        action: "keep-source",
      }]);
      const restored = await readProject(f.source);
      eq(restored.emitted, doc);
      eq(result.remaining.length, 1);
      eq(restored.pending[0].id, textEdit.id);
      eq(restored.pending[0].after, textEdit.after);
      eq(await Deno.readTextFile(f.source), f.text);
      const savedAgain = await saveProject(
        f.source,
        restored.emitted,
        restored.revision,
      );
      eq(savedAgain.emitted, doc);
      const rerendered = (await renderProject(f.source)).state;
      eq(rerendered.emitted, doc);
      eq(rerendered.pending[0].after, textEdit.after);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "external disappearance of a pending deleted source unit cannot retire recoverable text or geometry",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      const doc = structuredClone(f.initial.emitted),
        body = doc.slides[0].elements.find((e) => e.id === "body/paragraph:1")!;
      body.html = "Unsynced recoverable text.";
      body.x = 347;
      let state = await saveProject(f.source, doc, f.initial.revision);
      state = await remove(f.source, state);
      const beforeState = canonical(state),
        output = await Deno.readTextFile(join(f.directory, "deck.bento.html"));
      await Deno.writeTextFile(
        f.source,
        f.text.replace("::: {#body}\nLiteral β 😀.\n:::\n", ""),
      );
      await refuses(() => renderProject(f.source), "AMBIGUOUS_IDENTITY");
      eq(canonical(await readProject(f.source)), beforeState);
      eq(await Deno.readTextFile(join(f.directory, "deck.bento.html")), output);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "element delete plans refuse stale QMD/state, altered confirmations and ambiguous remaining source before publication",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      let state = await remove(f.source, f.initial);
      const deletion = state.pending.find((p) => p.kind === "delete-element")!;
      const options = { confirmedDeleteIds: [deletion.id] },
        plan = await previewSync(f.source, undefined, options);
      const stable = canonical(state);
      await Deno.writeTextFile(f.source, f.text + "\n");
      await refuses(() => applySync(f.source, plan), "STALE_SOURCE");
      await refuses(
        () => previewSync(f.source, undefined, options),
        "STALE_SOURCE",
      );
      eq(canonical(await readProject(f.source)), stable);
      await Deno.writeTextFile(f.source, f.text);
      const altered = structuredClone(plan);
      altered.confirmedDeleteIds = [];
      await refuses(
        () => applySync(f.source, altered),
        "CONFIRM_DELETE_REQUIRED",
      );
      const edited = structuredClone(state.emitted);
      edited.slides[0].elements[0].x = 730;
      state = await saveProject(f.source, edited, state.revision);
      await refuses(() => applySync(f.source, plan), "STALE_REVISION");
      eq(await Deno.readTextFile(f.source), f.text);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
    const weak = await fixture(
      authored.replace(
        "::: {#keep}\nKeep unchanged.\n:::",
        "Unpinned survivor.",
      ),
    );
    try {
      const state = await remove(weak.source, weak.initial),
        deletion = state.pending.find((p) => p.kind === "delete-element")!;
      const plan = await previewSync(weak.source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      ok(plan.identities?.patches.length === 1);
      ok(plan.identities.patches[0].expected.includes("Unpinned survivor."));
      eq(await Deno.readTextFile(weak.source), weak.text);
      eq(canonical(await readProject(weak.source)), canonical(state));
      await applySync(weak.source, plan);
      const final = (await renderProject(weak.source)).state;
      eq(final.docId, weak.initial.docId);
      eq(final.pending, []);
      ok(
        !final.emitted.slides[0].elements.some((element) =>
          element.id === "body/paragraph:1"
        ),
      );
      ok(
        final.emitted.slides[0].elements.some((element) =>
          element.html === "Unpinned survivor."
        ),
      );
    } finally {
      await Deno.remove(weak.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "pending element deletion refuses headings, multi-child components and computed producer source",
  ignore: !canRun,
  fn: async () => {
    for (
      const [text, id, code] of [
        [authored, "slide-title", "UNSUPPORTED_SYNC"],
        [
          authored.replace("Literal β 😀.", "One.\n\nTwo."),
          "body/paragraph:1",
          "unsafe-element-delete",
        ],
        [
          authored.replace("{#body}", "{#body .bento-card}"),
          "body/paragraph:1",
          "unsafe-element-delete",
        ],
      ]
    ) {
      const f = await fixture(text);
      try {
        const state = await remove(f.source, f.initial, id),
          deletion = state.pending.find((p) => p.kind === "delete-element")!;
        const before = canonical(state);
        await refuses(() =>
          previewSync(f.source, undefined, {
            confirmedDeleteIds: [deletion.id],
          }), code);
        eq(await Deno.readTextFile(f.source), f.text);
        eq(canonical(await readProject(f.source)), before);
      } finally {
        await Deno.remove(f.directory, { recursive: true });
      }
    }
    const directory = await Deno.makeTempDir({
      prefix: "qbento-delete-computed-",
    });
    try {
      for (const file of ["presentation.qmd", "data.csv"]) {
        await Deno.copyFile(
          new URL("../fixtures/basic/" + file, import.meta.url),
          join(directory, file),
        );
      }
      const source = join(directory, "presentation.qmd"),
        initial = (await renderProject(source)).state;
      const state = await remove(source, initial, "fig-values"),
        deletion = state.pending.find((p) => p.kind === "delete-element")!;
      const before = await Deno.readTextFile(source);
      await refuses(
        () =>
          previewSync(source, undefined, { confirmedDeleteIds: [deletion.id] }),
        "SYNC_CONFLICT",
      );
      eq(await Deno.readTextFile(source), before);
      eq(canonical(await readProject(source)), canonical(state));
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "interrupted element sync retains exact approvals/backups and supports checked finish or rollback",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    const originalSave = StateStore.prototype.save;
    try {
      const pending = await remove(f.source, f.initial),
        deletion = pending.pending.find((p) => p.kind === "delete-element")!;
      const plan = await previewSync(f.source, undefined, {
        confirmedDeleteIds: [deletion.id],
      });
      StateStore.prototype.save = () =>
        Promise.reject(new Error("injected state commit failure"));
      await refuses(
        () => applySync(f.source, plan),
        "injected state commit failure",
      );
      StateStore.prototype.save = originalSave;
      const inspected = await recoverProject(f.source);
      ok(
        inspected.available.includes("finish") &&
          inspected.available.includes("rollback"),
      );
      const journal = JSON.parse(
        await Deno.readTextFile(
          join(f.directory, ".qbento", "sync-transaction.json"),
        ),
      );
      eq(await Deno.readTextFile(journal.sourceBackup), f.text);
      eq(canonical(await readProject(f.source)), canonical(pending));
      const staging = JSON.parse(
        await Deno.readTextFile(journal.approvalStaging),
      );
      eq(
        staging.approval.deletionStateHash,
        hashSource(canonical({ ...pending, revision: pending.revision + 1 })),
      );
      const stagedText = await Deno.readTextFile(journal.approvalStaging);
      const corrupt = structuredClone(staging);
      corrupt.approval.deletionStateHash = "0".repeat(64);
      corrupt.sha256 = hashSource(canonical(corrupt.approval));
      await Deno.writeTextFile(
        journal.approvalStaging,
        JSON.stringify(corrupt),
      );
      await refuses(
        () => recoverProject(f.source),
        "RECOVERY_APPROVAL_MISMATCH",
      );
      eq(canonical(await readProject(f.source)), canonical(pending));
      await Deno.writeTextFile(journal.approvalStaging, stagedText);
      await recoverProject(f.source, "finish");
      eq(await Deno.readTextFile(f.source), plan.result);
      const rendered = (await renderProject(f.source)).state;
      eq(rendered.pending, []);
      ok(
        !rendered.emitted.slides[0].elements.some((e) =>
          e.id === "body/paragraph:1"
        ),
      );
    } finally {
      StateStore.prototype.save = originalSave;
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "displayed code and equation use the same independent authored-unit deletion proof through real Quarto",
  ignore: !canRun,
  fn: async () => {
    for (
      const [body, id] of [
        ["```{#display .javascript}\nconst x = 1;\n```", "display"],
        ["<!-- qb:formula -->\n$$\ny = 1\n$$", "formula"],
      ]
    ) {
      const f = await fixture(
        authored.replace("::: {#body}\nLiteral β 😀.\n:::", () => body),
      );
      try {
        eq(
          f.initial.provenance[targetKey({ slideId: "slide", elementId: id })]
            .source!.kind,
          id === "display" ? "code" : "math",
        );
        const pending = await remove(f.source, f.initial, id),
          deletion = pending.pending.find((p) => p.kind === "delete-element")!;
        await applySync(
          f.source,
          await previewSync(f.source, undefined, {
            confirmedDeleteIds: [deletion.id],
          }),
        );
        const final = (await renderProject(f.source)).state;
        eq(final.pending, []);
        ok(!final.emitted.slides[0].elements.some((e) => e.id === id));
        eq(await Deno.readTextFile(f.source), f.text.replace(body + "\n", ""));
      } finally {
        await Deno.remove(f.directory, { recursive: true });
      }
    }
  },
});
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
Deno.test({
  name:
    "Studio element deletion save/reopen API requires the element confirmation before QMD and fresh render",
  ignore: !canRun || !canServe,
  fn: async () => {
    const f = await fixture();
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      studio = await startStudio(f.source);
      const page = await (await fetch(studio.url)).text();
      const token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      const post = async (path: string, data: unknown) => {
        const response = await fetch(studio!.url + "/api/" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": token,
          },
          body: JSON.stringify(data),
        });
        return { status: response.status, body: await response.json() };
      };
      const removed = structuredClone(f.initial.emitted);
      removed.slides[0].elements = removed.slides[0].elements.filter((e) =>
        e.id !== "body/paragraph:1"
      );
      const saved = await post("save", {
        doc: removed,
        revision: f.initial.revision,
      });
      eq(saved.status, 200);
      const reopened = extractDocument(
        await (await fetch(studio.url + "/deck")).text(),
      );
      eq(reopened, removed);
      const pending = await readProject(f.source),
        deletion = pending.pending.find((p) => p.kind === "delete-element")!;
      const refused = await post("sync/preview", {});
      eq(refused.body.error, "CONFIRM_DELETE_REQUIRED");
      eq(await Deno.readTextFile(f.source), f.text);
      const preview = await post("sync/preview", {
        confirmedDeleteIds: [deletion.id],
      });
      eq(preview.status, 200);
      ok(preview.body.structure.steps[0].operation.type === "delete-block");
      eq((await post("sync/apply", preview.body)).status, 200);
      eq((await post("render", {})).status, 200);
      eq((await readProject(f.source)).pending, []);
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "overlapping element and parent-slide deletion refuse before source publication",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      let state = await remove(f.source, f.initial);
      state = await applySlideAction(f.source, {
        action: "delete",
        slideId: "slide",
        revision: state.revision,
      });
      const deletes = state.pending.filter((p) => p.kind.startsWith("delete-"));
      eq(deletes.length, 2);
      const before = canonical(state),
        output = await Deno.readTextFile(join(f.directory, "deck.bento.html"));
      await refuses(
        () =>
          previewSync(f.source, undefined, {
            confirmedDeleteIds: deletes.map((p) => p.id),
          }),
        "OVERLAPPING_SOURCE_DELETE",
      );
      const element = deletes.find((p) => p.kind === "delete-element")!;
      await refuses(
        () =>
          previewSync(f.source, [element.id], {
            confirmedDeleteIds: [element.id],
          }),
        "OVERLAPPING_SOURCE_DELETE",
      );
      eq(await Deno.readTextFile(f.source), f.text);
      eq(canonical(await readProject(f.source)), before);
      eq(await Deno.readTextFile(join(f.directory, "deck.bento.html")), output);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
