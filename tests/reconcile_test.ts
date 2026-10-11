import {
  applyReconcile,
  previewReconcile,
  type ReconcileProjector,
} from "../src/core/reconcile.ts";
import {
  type BentoDoc,
  canonical,
  captureEdits,
  createState,
  StateStore,
  targetKey,
} from "../src/state/mod.ts";
import { hashSource } from "../src/source/mod.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  assert(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(
      String(e).includes(code) || (e as { code?: string }).code === code,
      String(e),
    );
    return;
  }
  throw new Error("Expected " + code);
}
async function fixture(computed = false) {
  const dir = await Deno.makeTempDir({ prefix: "qbento-reconcile-" }),
    source = dir + "/deck.qmd";
  await Deno.writeTextFile(source, "Original");
  const doc: BentoDoc = {
    format: "bento/slides",
    version: 1,
    docId: "reconcile",
    slides: [{
      id: "slide",
      elements: [{ id: "text", type: "text", html: "Original", x: 10 }],
    }],
  };
  const key = targetKey({ slideId: "slide", elementId: "text" });
  let computedText = "Original";
  let ownership: Record<string, string[]> = {};
  const projector: ReconcileProjector = async () => {
    const sourceText = await Deno.readTextFile(source),
      generated = structuredClone(doc);
    generated.slides[0].elements[0].html = computed ? computedText : sourceText;
    return {
      document: generated,
      sourceHash: hashSource(sourceText),
      ownership,
      provenance: {
        [key]: {
          origin: computed ? "computed" : "authored",
          semanticId: "text",
          source: {
            hash: hashSource(sourceText),
            stable: true,
            blockId: "text",
            content: sourceText,
            kind: "paragraph",
          },
        },
      },
    };
  };
  const projected = await projector(source, {} as never),
    store = new StateStore(dir + "/.qbento");
  let state = await store.save(createState(doc, projected.provenance));
  async function edit(text: string) {
    const edited = structuredClone(state.emitted);
    edited.slides[0].elements[0].html = text;
    edited.slides[0].elements[0].x = 99;
    state = await store.save(captureEdits(state, edited));
  }
  return {
    dir,
    source,
    store,
    doc,
    projector,
    edit,
    key,
    setComputed: (text: string) => {
      computedText = text;
    },
    setOwned: (paths: string[]) => {
      ownership = { [key]: paths };
    },
    cleanup: () => Deno.remove(dir, { recursive: true }),
  };
}

Deno.test("reconcile preview exposes both values without writes; keep-source preserves independent design", async () => {
  const f = await fixture();
  try {
    await f.edit("Bento text");
    await Deno.writeTextFile(f.source, "QMD text");
    const before = await Deno.readTextFile(f.store.path),
      plan = await previewReconcile(f.source, f.projector);
    eq(await Deno.readTextFile(f.store.path), before);
    eq(await Deno.readTextFile(f.source), "QMD text");
    const item = plan.changes.find((i) => i.change.path[0] === "html")!;
    eq(item.change.status, "conflict");
    eq(item.change.source?.value, "QMD text");
    eq(item.change.after.value, "Bento text");
    const applied = await applyReconcile(f.source, plan, [{
      changeId: item.change.id,
      action: "keep-source",
    }], f.projector);
    eq(applied.state.pending, []);
    eq(applied.state.emitted.slides[0].elements[0].html, "QMD text");
    eq(applied.state.emitted.slides[0].elements[0].x, 99);
    eq(await Deno.readTextFile(f.source), "QMD text");
  } finally {
    await f.cleanup();
  }
});
Deno.test("keep-bento rebases only reviewed authored divergence and never writes QMD", async () => {
  const f = await fixture();
  try {
    await f.edit("Bento text");
    await Deno.writeTextFile(f.source, "QMD text");
    const plan = await previewReconcile(f.source, f.projector),
      item = plan.changes[0];
    const applied = await applyReconcile(f.source, plan, [{
      changeId: item.change.id,
      action: "keep-bento",
    }], f.projector);
    eq(applied.remaining[0].before.value, "QMD text");
    eq(applied.remaining[0].after.value, "Bento text");
    eq(applied.remaining[0].status, "bento-ahead");
    eq(await Deno.readTextFile(f.source), "QMD text");
  } finally {
    await f.cleanup();
  }
});
Deno.test("computed edits require explicit detach and stale recomputation refuses the old choice", async () => {
  const f = await fixture(true);
  try {
    await f.edit("Edited computed text");
    const plan = await previewReconcile(f.source, f.projector),
      item = plan.changes[0];
    eq(item.actions, ["keep-source", "detach"]);
    await refuses(
      () =>
        applyReconcile(f.source, plan, [{
          changeId: item.change.id,
          action: "keep-bento",
        }], f.projector),
      "INVALID_RECONCILE_CHOICE",
    );
    f.setComputed("Changed data result");
    await refuses(
      () =>
        applyReconcile(f.source, plan, [{
          changeId: item.change.id,
          action: "detach",
        }], f.projector),
      "STALE_RECONCILE_PLAN",
    );
    const fresh = await previewReconcile(f.source, f.projector);
    const applied = await applyReconcile(f.source, fresh, [{
      changeId: item.change.id,
      action: "detach",
    }], f.projector);
    eq(applied.remaining[0].origin, "detached");
    eq(
      applied.state.emitted.slides[0].elements[0].html,
      "Edited computed text",
    );
  } finally {
    await f.cleanup();
  }
});
Deno.test("stale source, state, plan and unsafe choices leave all durable bytes intact", async () => {
  const f = await fixture();
  try {
    await f.edit("Pending");
    const plan = await previewReconcile(f.source, f.projector),
      choice = {
        changeId: plan.changes[0].change.id,
        action: "keep-source" as const,
      };
    const before = await Deno.readTextFile(f.store.path);
    const tampered = structuredClone(plan);
    tampered.document.slides[0].elements[0].html = "Tampered";
    await refuses(
      () => applyReconcile(f.source, tampered, [choice], f.projector),
      "STALE_RECONCILE_PLAN",
    );
    await refuses(
      () => applyReconcile(f.source, plan, [choice, choice], f.projector),
      "INVALID_RECONCILE_CHOICES",
    );
    eq(await Deno.readTextFile(f.store.path), before);
    await Deno.writeTextFile(f.source, "External change");
    await refuses(
      () => applyReconcile(f.source, plan, [choice], f.projector),
      "STALE_RECONCILE_SOURCE",
    );
    await Deno.writeTextFile(f.source, "Original");
    await f.store.save((await f.store.load())!);
    await refuses(
      () => applyReconcile(f.source, plan, [choice], f.projector),
      "STALE_RECONCILE_STATE",
    );
  } finally {
    await f.cleanup();
  }
});
Deno.test("source-owned visual conflict clears the obsolete overlay after explicit choice", async () => {
  const f = await fixture();
  try {
    await f.edit("Original");
    f.setOwned(["x"]);
    const plan = await previewReconcile(f.source, f.projector),
      item = plan.changes.find((i) => i.change.path[0] === "x")!;
    eq(item.change.status, "conflict");
    const r = await applyReconcile(f.source, plan, [{
      changeId: item.change.id,
      action: "keep-source",
    }], f.projector);
    eq(r.state.overrides, []);
    eq(r.remaining, []);
    eq(r.state.emitted.slides[0].elements[0].x, 10);
    eq((await previewReconcile(f.source, f.projector)).changes, []);
  } finally {
    await f.cleanup();
  }
});
