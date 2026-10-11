import {
  consumeCapture,
  preparePublication,
  recordPublication,
  verifyCapture,
} from "../src/core/capture.ts";
import {
  type BentoDoc,
  canonical,
  captureEdits,
  createState,
  markEmitted,
  sha256,
  StateError,
  StateStore,
} from "../src/state/mod.ts";
import { spliceDocument } from "../src/render/html.ts";
import type { BentoDoc as RenderDoc } from "../src/render/types.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown> | unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof StateError && e.code === code, String(e));
    return;
  }
  throw new Error("Expected " + code);
}
const doc = (): BentoDoc => ({
  format: "bento/slides",
  version: 1,
  docId: "stable",
  slides: [{
    id: "s",
    elements: [{ id: "p", type: "text", html: "Original", x: 10 }],
  }],
});
const shell = (d: BentoDoc) =>
  '<!doctype html><html><head><title>Deck</title></head><body><script id="bento-doc" type="application/json">' +
  JSON.stringify(d) + "</script></body></html>";
async function publication() {
  const document = doc(),
    prepared = await preparePublication(document, shell(document));
  return {
    ...prepared,
    state: await recordPublication(
      createState(document),
      document,
      "/tmp/deck.bento.html",
      prepared.html,
      prepared.receipt,
    ),
  };
}
function nativeSave(html: string, edited: BentoDoc) {
  return spliceDocument(html, edited as unknown as RenderDoc);
}
Deno.test("publication receipt is outside the document and native document serialization preserves it", async () => {
  const p = await publication(), edited = doc();
  edited.slides[0].elements[0].x = 999;
  const html = nativeSave(p.html, edited),
    parsed = await verifyCapture(p.state, html);
  assert(parsed.slides[0].elements[0].x === 999);
  assert(html.includes(JSON.stringify(p.receipt)));
  assert(!Object.hasOwn(parsed, "qbento-receipt"));
  assert(p.receipt.publishedDocSha256 === await sha256(canonical(doc())));
});
Deno.test("same-path native capture records changed bytes, consumes generation and retains publication baseline", async () => {
  const p = await publication(), edited = doc();
  edited.slides[0].elements[0].html = "Native edit";
  const html = nativeSave(p.html, edited);
  let captured = captureEdits(p.state, await verifyCapture(p.state, html));
  captured = await markEmitted(captured, edited, p.state.output!.path, html);
  captured = consumeCapture(captured);
  assert(captured.output!.sha256 === await sha256(html));
  assert(captured.output!.generation === p.receipt.generation);
  assert(captured.output!.publishedDocSha256 === p.receipt.publishedDocSha256);
  assert(captured.pending[0].after.value === "Native edit");
  await rejects(
    () => verifyCapture(captured, html),
    "CAPTURE_GENERATION_CONSUMED",
  );
  await rejects(
    () => verifyCapture(captured, p.html),
    "CAPTURE_GENERATION_CONSUMED",
  );
});
Deno.test("download capture preserves current published output receipt and refuses a second same-generation copy", async () => {
  const p = await publication(), edited = doc();
  edited.slides[0].elements[0].x = 600;
  const captured = consumeCapture(
    captureEdits(
      p.state,
      await verifyCapture(p.state, nativeSave(p.html, edited)),
    ),
  );
  assert(captured.output!.sha256 === p.state.output!.sha256);
  assert(captured.overrides.length === 1);
  await rejects(
    () => verifyCapture(captured, p.html),
    "CAPTURE_GENERATION_CONSUMED",
  );
});
Deno.test("newer Studio design and semantic saves cannot be silently reverted by stale native HTML", async () => {
  for (const field of ["x", "html"]) {
    const p = await publication(), edited = doc();
    edited.slides[0].elements[0][field] = field === "x" ? 444 : "Studio text";
    const state = captureEdits(p.state, edited), before = canonical(state);
    await rejects(() => verifyCapture(state, p.html), "STALE_CAPTURE_BASELINE");
    assert(canonical(state) === before);
  }
});
Deno.test("revision-only bookkeeping does not invalidate a still identical published snapshot", async () => {
  const p = await publication();
  p.state.revision += 5;
  assert((await verifyCapture(p.state, p.html)).docId === p.state.docId);
});
Deno.test("regeneration rotates generation, reenables capture and refuses old downloads", async () => {
  const p = await publication();
  const consumed = consumeCapture(p.state);
  const newer = await preparePublication(doc(), p.html);
  assert(newer.receipt.generation !== p.receipt.generation);
  const state = await recordPublication(
    consumed,
    doc(),
    p.state.output!.path,
    newer.html,
    newer.receipt,
  );
  assert(!state.output!.captureConsumed);
  await rejects(() => verifyCapture(state, p.html), "STALE_CAPTURE_GENERATION");
  assert((await verifyCapture(state, newer.html)).docId === state.docId);
});
Deno.test("legacy HTML, duplicate receipt, forged snapshot and unrelated doc IDs fail without edits", async () => {
  const p = await publication(), before = canonical(p.state);
  await rejects(
    () => verifyCapture(p.state, shell(doc())),
    "CAPTURE_RECEIPT_MISSING",
  );
  const block =
    p.html.match(/<script id="qbento-receipt"[\s\S]*?<\/script>/)![0];
  await rejects(
    () => verifyCapture(p.state, p.html + block),
    "CAPTURE_RECEIPT_MISSING",
  );
  await rejects(
    () =>
      verifyCapture(
        p.state,
        p.html.replace(p.receipt.publishedDocSha256, "0".repeat(64)),
      ),
    "STALE_CAPTURE_GENERATION",
  );
  const foreign = doc();
  foreign.docId = "foreign";
  await rejects(
    () => verifyCapture(p.state, nativeSave(p.html, foreign)),
    "UNRELATED_DOCUMENT",
  );
  await rejects(
    () => verifyCapture(createState(doc()), p.html),
    "CAPTURE_BASELINE_MISSING",
  );
  assert(canonical(p.state) === before);
});
Deno.test("publication refuses mismatched documents and mismatched receipt parameters", async () => {
  const p = await publication(), different = doc();
  different.title = "Different";
  await rejects(
    () => preparePublication(different, p.html),
    "PUBLICATION_DOCUMENT_MISMATCH",
  );
  await rejects(
    () =>
      recordPublication(p.state, doc(), "/tmp/out", p.html, {
        ...p.receipt,
        generation: crypto.randomUUID(),
      }),
    "PUBLICATION_RECEIPT_MISMATCH",
  );
});
Deno.test("consumed generation survives atomic persistence and project reopen", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const p = await publication(), store = new StateStore(dir);
    const saved = await store.save(consumeCapture(p.state));
    const reopened = await store.load();
    assert(reopened!.output!.captureConsumed);
    assert(saved.revision === 1);
    await rejects(
      () => verifyCapture(reopened!, p.html),
      "CAPTURE_GENERATION_CONSUMED",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
