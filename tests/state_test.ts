import {
  assertOutputUnchanged,
  type BentoDoc,
  captureEdits,
  compose,
  createState,
  equal,
  markEmitted,
  promoteCreated,
  resolveChange,
  StateError,
  StateStore,
  targetKey,
  validateDoc,
} from "../src/state/mod.ts";
function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  assert(equal(a, b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
function rejects(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert(e instanceof StateError && e.code === code, String(e));
    return;
  }
  throw new Error(`Expected ${code}`);
}
async function rejectsAsync(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof StateError && e.code === code, String(e));
    return;
  }
  throw new Error(`Expected ${code}`);
}
function doc(): BentoDoc {
  return {
    docId: "stable",
    format: "bento/slides",
    version: 1,
    title: "Deck",
    slides: [{
      id: "s1",
      elements: [{
        id: "paragraph",
        type: "text",
        html: "Original",
        x: 1,
        y: 2,
        font: { size: 20, color: "black" },
      }, {
        id: "figure",
        type: "image",
        src: "data:image/svg+xml,<svg>old</svg>",
        x: 3,
        y: 4,
        w: 100,
        h: 100,
      }],
    }, { id: "s2", elements: [] }],
  };
}
const figureKey = targetKey({ slideId: "s1", elementId: "figure" });
function state() {
  return createState(doc(), {
    [figureKey]: { origin: "computed", producer: "fig-model" },
  });
}
Deno.test("visual overrides stay sparse and computed figures refresh; decoration and docId survive", () => {
  const base = state(), edit = doc();
  edit.slides[0].elements[1].x = 80;
  edit.slides[0].elements[1].w = 250;
  edit.slides[0].elements.push({ id: "arrow", type: "shape", x: 8 });
  const captured = captureEdits(base, edit);
  eq(captured.overrides.length, 1);
  eq(captured.overrides[0].fields.length, 2);
  eq(captured.pending.length, 0);
  const next = doc();
  next.slides[0].elements[1].src = "data:image/svg+xml,<svg>NEW</svg>";
  const out = compose(captured, next);
  eq(out.document.slides[0].elements[1].x, 80);
  eq(out.document.slides[0].elements[1].src, next.slides[0].elements[1].src);
  eq(out.document.slides[0].elements[2].id, "arrow");
  eq(out.state.docId, "stable");
  const restored = structuredClone(out.document);
  restored.slides[0].elements[1].x = 3;
  const re = captureEdits(out.state, restored);
  eq(re.overrides[0].fields.length, 1);
});
Deno.test("authored pending edits survive repeated renders, source changes in disjoint fields merge", () => {
  const edit = doc();
  edit.slides[0].elements[0].html = "Edited";
  edit.slides[0].elements[0].x = 900;
  const captured = captureEdits(state(), edit), next = doc();
  next.slides[0].elements[1].src = "new";
  const first = compose(captured, next), second = compose(first.state, next);
  eq(second.document.slides[0].elements[0].html, "Edited");
  eq(second.state.pending.length, 1);
  next.slides[0].elements[0].html = "From QMD";
  rejects(() => compose(second.state, next), "MERGE_CONFLICT");
  const preview = compose(second.state, next, undefined, undefined, {
    strict: false,
  });
  eq(preview.changes[0].status, "conflict");
  eq(preview.changes[0].before.value, "Original");
  eq(preview.changes[0].source?.value, "From QMD");
  const resolved = resolveChange(
    preview.state,
    preview.changes[0].id,
    "keep-source",
  );
  eq(compose(resolved, next).document.slides[0].elements[0].html, "From QMD");
});
Deno.test("source matching pending edit acknowledges only that change", () => {
  const edit = doc();
  edit.slides[0].elements[0].html = "Edited";
  edit.slides[0].notes = "Speaker";
  const captured = captureEdits(state(), edit);
  const next = doc();
  next.slides[0].elements[0].html = "Edited";
  const out = compose(captured, next);
  eq(out.state.pending.length, 1);
  eq(out.state.pending[0].path, ["notes"]);
});
Deno.test("computed edits refuse strict render and allow explicit restoration", () => {
  const edit = doc();
  edit.slides[0].elements[1].src = "fake";
  const captured = captureEdits(state(), edit);
  eq(captured.pending[0].origin, "computed");
  rejects(() => compose(captured, doc()), "MERGE_CONFLICT");
  eq(
    compose(
      resolveChange(captured, captured.pending[0].id, "keep-source"),
      doc(),
    ).document.slides[0].elements[1].src,
    doc().slides[0].elements[1].src,
  );
});
Deno.test("source-owned visual field divergence is pending, not a visual override", () => {
  const s = state();
  s.ownership[figureKey] = ["x"];
  const edit = doc();
  edit.slides[0].elements[1].x = 10;
  const captured = captureEdits(s, edit);
  eq(captured.overrides.length, 0);
  eq(captured.pending.length, 1);
});
Deno.test("new slide, text, order and deletion persist for explicit synchronization", () => {
  const edit = doc();
  edit.slides.unshift({
    id: "created",
    elements: [{ id: "new-text", type: "text", html: "New content" }],
  });
  edit.slides.reverse();
  const captured = captureEdits(state(), edit);
  const first = compose(captured, doc());
  eq(first.document.slides.map((s) => s.id), edit.slides.map((s) => s.id));
  const changed = structuredClone(first.document);
  changed.slides.find((s) => s.id === "created")!.elements[0].html =
    "Updated new content";
  const recaptured = captureEdits(first.state, changed);
  const out = compose(recaptured, doc());
  eq(
    out.document.slides.find((s) => s.id === "created")!.elements[0].html,
    "Updated new content",
  );
  const deleted = structuredClone(out.document);
  deleted.slides = deleted.slides.filter((s) => s.id !== "s2");
  eq(
    compose(captureEdits(out.state, deleted), doc()).document.slides.some((s) =>
      s.id === "s2"
    ),
    false,
  );
});
Deno.test("removed source objects with visual edits or decorations conflict without losing state", () => {
  const edit = doc();
  edit.slides[0].elements[1].x = 20;
  const captured = captureEdits(state(), edit);
  const next = doc();
  next.slides[0].elements.pop();
  rejects(() => compose(captured, next), "MERGE_CONFLICT");
  eq(captured.overrides.length, 1);
});
Deno.test("missing IDs, duplicate IDs, unrelated document and prototype keys refuse", () => {
  const invalid = doc();
  invalid.slides[0].elements[0].id = "";
  rejects(() => validateDoc(invalid), "INVALID_ID");
  const dup = doc();
  dup.slides[0].elements.push({ ...dup.slides[0].elements[0] });
  rejects(() => validateDoc(dup), "DUPLICATE_ID");
  const foreign = doc();
  foreign.docId = "different";
  rejects(() => captureEdits(state(), foreign), "UNRELATED_DOCUMENT");
  const polluted = JSON.parse(
    '{"docId":"x","slides":[],"__proto__":{"polluted":true}}',
  );
  rejects(() => validateDoc(polluted), "UNSAFE_KEY");
  const repeated = doc();
  repeated.slides[1].elements.push({ ...repeated.slides[0].elements[0] });
  validateDoc(repeated);
});
Deno.test("atomic store save/reopen preserves pending edits, CAS refuses stale, backup validates", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const store = new StateStore(dir), edit = doc();
    edit.slides[0].elements[0].html = "Pending";
    const saved = await store.save(captureEdits(state(), edit));
    eq(saved.revision, 1);
    eq((await store.load())?.pending, saved.pending);
    await rejectsAsync(() => store.save(saved, 0), "STALE_REVISION");
    const next = await store.save(saved);
    eq(next.revision, 2);
    eq((await store.inspectRecovery())?.revision, 1);
    await Deno.mkdir(dir + "/write.lock");
    await rejectsAsync(() => store.save(next), "STATE_LOCKED");
    await Deno.remove(dir + "/write.lock");
    const file = JSON.parse(await Deno.readTextFile(store.path));
    file.state.emitted.title = "tamper";
    await Deno.writeTextFile(store.path, JSON.stringify(file));
    await rejectsAsync(() => store.load(), "CORRUPT_STATE");
    eq((await store.inspectRecovery())?.revision, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("output guard blocks uncaptured native HTML edits and permits missing rebuild", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = dir + "/deck.html";
    await assertOutputUnchanged(undefined, path);
    await Deno.writeTextFile(path, "original");
    await rejectsAsync(
      () => assertOutputUnchanged(undefined, path),
      "UNTRACKED_OUTPUT",
    );
    const marked = await markEmitted(state(), doc(), path, "original");
    await assertOutputUnchanged(marked, path);
    await Deno.writeTextFile(path, "edited");
    await rejectsAsync(
      () => assertOutputUnchanged(marked, path),
      "UNCAPTURED_HTML_EDITS",
    );
    await Deno.remove(path);
    await assertOutputUnchanged(marked, path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("explicit detached snapshots remain labeled through changed and coincident computation", () => {
  const edit = doc();
  edit.slides[0].elements[1].src = "snapshot";
  const captured = captureEdits(state(), edit),
    detached = resolveChange(captured, captured.pending[0].id, "detach");
  const next = doc();
  next.slides[0].elements[1].src = "different";
  const out = compose(detached, next);
  eq(out.document.slides[0].elements[1].src, "snapshot");
  eq(out.state.pending[0].origin, "detached");
  next.slides[0].elements[1].src = "snapshot";
  eq(compose(out.state, next).state.pending[0].origin, "detached");
});
Deno.test("element stacking is retained independently of recomputed element content", () => {
  const edit = doc();
  edit.slides[0].elements.reverse();
  const captured = captureEdits(state(), edit);
  const next = doc();
  next.slides[0].elements[1].src = "fresh";
  const out = compose(captured, next);
  eq(out.document.slides[0].elements[0].id, "figure");
  eq(out.document.slides[0].elements[0].src, "fresh");
});
Deno.test("undo source element deletion restores normal field semantics", () => {
  const edit = doc();
  edit.slides[0].elements.shift();
  const removed = captureEdits(state(), edit);
  const restored = doc();
  restored.slides[0].elements[0].html = "Restored edited";
  const state2 = captureEdits(removed, restored);
  const out = compose(state2, doc());
  eq(out.document.slides[0].elements[0].html, "Restored edited");
  eq(out.state.pending.map((p) => p.kind), ["field"]);
});
Deno.test("concurrent writers cannot both commit the same state revision", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const a = new StateStore(dir), b = new StateStore(dir);
    const outcomes = await Promise.allSettled([
      a.save(state()),
      b.save(state()),
    ]);
    eq(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    eq((await a.load())!.revision, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("malformed persisted paths fail defensively and detached edits remain per-field", () => {
  const invalid = state();
  invalid.overrides.push({
    target: { slideId: "s1" },
    fields: [{ path: ["__proto__"], value: { present: true, value: 1 } }],
  });
  rejects(() => captureEdits(invalid, doc()), "INVALID_STATE");
  const edit = doc();
  edit.slides[0].elements[1].src = "snapshot";
  const captured = captureEdits(state(), edit),
    detached = resolveChange(captured, captured.pending[0].id, "detach");
  const out = compose(detached, doc());
  const again = structuredClone(out.document);
  again.slides[0].elements[1].src = "second snapshot";
  const edited = captureEdits(out.state, again);
  eq(edited.pending[0].origin, "detached");
  eq(
    compose(edited, doc()).document.slides[0].elements[1].src,
    "second snapshot",
  );
  const restored = resolveChange(edited, edited.pending[0].id, "keep-source");
  eq(restored.provenance[figureKey].origin, "computed");
});
Deno.test("restoring a deleted slide preserves inserted authored objects and decorations", () => {
  const original = doc(), removed = doc();
  removed.slides.shift();
  const deleted = captureEdits(state(), removed);
  const restored = doc();
  restored.slides[0].elements.push({
    id: "fresh",
    type: "text",
    html: "Fresh content",
    x: 999,
  }, { id: "deco", type: "shape", x: 300 });
  restored.slides[0].elements = restored.slides[0].elements.filter((e) =>
    e.id !== "paragraph"
  );
  const saved = captureEdits(deleted, restored), out = compose(saved, original);
  eq(out.document, restored);
  assert(
    saved.pending.some((p) =>
      p.kind === "create-element" && p.target.elementId === "fresh"
    ),
  );
  assert(
    saved.pending.some((p) =>
      p.kind === "delete-element" && p.target.elementId === "paragraph"
    ),
  );
  eq(saved.bentoOnly[0].element.id, "deco");
});
Deno.test("restoring the source snapshot cancels hidden stale semantic and visual edits", () => {
  const edit = doc();
  edit.slides[0].elements[0].html = "Old pending";
  edit.slides[0].elements[0].x = 500;
  let saved = captureEdits(state(), edit);
  edit.slides[0].elements.shift();
  saved = captureEdits(saved, edit);
  saved = captureEdits(saved, doc());
  eq(compose(saved, doc()).document, doc());
  eq(saved.pending.length, 0);
  eq(saved.overrides.length, 0);
});
Deno.test("approved creation promotion retains new-slide design and decorations through source acquisition", () => {
  const edit = doc();
  edit.slides.push({
    id: "new-slide",
    background: "pink",
    elements: [{
      id: "new-text",
      type: "text",
      html: "New authored content",
      x: 999,
    }, { id: "deco", type: "shape", x: 7 }],
  });
  const saved = captureEdits(state(), edit);
  const generated = doc();
  generated.slides.push({
    id: "new-slide",
    background: "white",
    elements: [{
      id: "new-text",
      type: "text",
      html: "New authored content",
      x: 80,
    }],
  });
  rejects(() => compose(saved, generated), "MERGE_CONFLICT");
  const id = saved.pending.find((p) => p.kind === "create-slide")!.id;
  const promoted = promoteCreated(saved, generated, [id]);
  const out = compose(promoted, generated);
  eq(out.document, edit);
  eq(out.state.pending.length, 0);
  eq(out.state.overrides.length, 2);
  eq(out.state.bentoOnly.length, 1);
  const again = structuredClone(generated);
  again.slides[2].elements[0].html = "New source content";
  eq(compose(out.state, again).document.slides[2].elements[0], {
    id: "new-text",
    type: "text",
    html: "New source content",
    x: 999,
  });
});
Deno.test("creation promotion requires explicit matching approval, identity and semantic content", () => {
  const edit = doc();
  edit.slides[0].elements.push({
    id: "new-text",
    type: "text",
    html: "New authored content",
    x: 999,
  });
  const saved = captureEdits(state(), edit);
  const id = saved.pending.find((p) => p.kind === "create-element")!.id;
  const generated = structuredClone(edit);
  generated.slides[0].elements.at(-1)!.x = 80;
  rejects(() => compose(saved, edit), "MERGE_CONFLICT"); // Coincident whole documents are not approvals.
  const bad = structuredClone(generated);
  bad.slides[0].elements.at(-1)!.html = "Unexpected source";
  rejects(
    () => promoteCreated(saved, bad, [id]),
    "PROMOTION_SEMANTIC_MISMATCH",
  );
  rejects(() => promoteCreated(saved, doc(), [id]), "PROMOTION_SOURCE_MISSING");
  rejects(
    () => promoteCreated(saved, generated, ["not-approved"]),
    "INVALID_PROMOTION",
  );
  eq(compose(promoteCreated(saved, generated, [id]), generated).document, edit);
  eq(saved.pending.length, 1);
});
Deno.test("source confirming a pending deletion retires associated design while unrelated design survives", () => {
  const edit = doc();
  edit.slides[0].elements[0].x = 999;
  edit.slides[0].elements[1].x = 777;
  let saved = captureEdits(state(), edit);
  edit.slides[0].elements.shift();
  saved = captureEdits(saved, edit);
  const generated = doc();
  generated.slides[0].elements.shift();
  const out = compose(saved, generated);
  eq(out.state.pending.length, 0);
  eq(out.state.overrides.length, 1);
  eq(out.document.slides[0].elements[0].x, 777);
});
Deno.test("repeated non-strict conflict previews retain the original orphan snapshot", () => {
  const edit = doc();
  edit.slides[0].elements[0].x = 999;
  let saved = captureEdits(state(), edit);
  const generated = doc();
  generated.slides[0].elements.shift();
  for (let n = 0; n < 4; n++) {
    saved =
      compose(saved, generated, undefined, undefined, { strict: false }).state;
  }
  eq(
    saved.pending.find((p) => p.kind === "orphan")!.after.value,
    edit.slides[0].elements[0],
  );
});
