import { extractDocument } from "../render/html.ts";
import {
  type BentoDoc,
  canonical,
  clone,
  equal,
  markEmitted,
  type ProjectState,
  type PublicationReceipt,
  sha256,
  StateError,
  validateDoc,
  validateState,
} from "../state/mod.ts";
const RECEIPT_BLOCK =
  /<script\b(?=[^>]*\s+id\s*=\s*["']qbento-receipt["'])[^>]*>([\s\S]*?)<\/script\s*>/gi;
const GENERATION =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const guidance =
  "Preserve this HTML unchanged. Publish a fresh project HTML before editing/capturing again; an older copy must be reconciled explicitly.";
function fail(code: string, message: string): never {
  throw new StateError(code, message + " " + guidance);
}
function receiptFromHtml(html: string): PublicationReceipt {
  const blocks = [...html.matchAll(RECEIPT_BLOCK)];
  if (blocks.length !== 1) {
    fail(
      "CAPTURE_RECEIPT_MISSING",
      "Expected exactly one project publication receipt; legacy or unrelated native HTML cannot establish a safe baseline.",
    );
  }
  const opening = blocks[0][0].slice(0, blocks[0][0].indexOf(">") + 1);
  if (!/\s+type\s*=\s*["']application\/json["']/i.test(opening)) {
    fail("CAPTURE_RECEIPT_INVALID", "Publication receipt must be inert JSON.");
  }
  let receipt: PublicationReceipt;
  try {
    receipt = JSON.parse(blocks[0][1]);
  } catch {
    fail("CAPTURE_RECEIPT_INVALID", "Publication receipt is not valid JSON.");
  }
  if (
    !receipt || receipt.version !== 1 ||
    typeof receipt.generation !== "string" ||
    !GENERATION.test(receipt.generation) || typeof receipt.docId !== "string" ||
    !receipt.docId || typeof receipt.publishedDocSha256 !== "string" ||
    !HASH.test(receipt.publishedDocSha256) ||
    !equal(Object.keys(receipt).sort(), [
      "docId",
      "generation",
      "publishedDocSha256",
      "version",
    ])
  ) {
    fail(
      "CAPTURE_RECEIPT_INVALID",
      "Publication receipt has an incompatible or malformed schema.",
    );
  }
  return receipt;
}
/** Create a fresh generation. Native Bento Save retains this inert script outside #bento-doc. */
export async function preparePublication(
  doc: BentoDoc,
  html: string,
): Promise<{ html: string; receipt: PublicationReceipt }> {
  validateDoc(doc);
  const parsed = extractDocument(html) as unknown as BentoDoc;
  validateDoc(parsed);
  if (!equal(doc, parsed)) {
    fail(
      "PUBLICATION_DOCUMENT_MISMATCH",
      "HTML payload differs from the document being published.",
    );
  }
  const previous = [...html.matchAll(RECEIPT_BLOCK)];
  if (previous.length > 1) {
    fail(
      "CAPTURE_RECEIPT_INVALID",
      "Cannot publish a shell containing duplicate receipts.",
    );
  }
  if (previous.length === 1) {
    receiptFromHtml(html);
    html = html.replace(RECEIPT_BLOCK, "");
  }
  const receipt: PublicationReceipt = {
    version: 1,
    generation: crypto.randomUUID(),
    docId: doc.docId,
    publishedDocSha256: await sha256(canonical(doc)),
  };
  const script = '<script id="qbento-receipt" type="application/json">' +
    JSON.stringify(receipt).replaceAll("<", "\\u003c") + "</script>";
  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, script + "</head>");
  } else html = script + html;
  return { html, receipt };
}
/** Prepare receipt state for journaled publication; the caller commits bytes/state safely. */
export async function recordPublication(
  state: ProjectState,
  doc: BentoDoc,
  path: string,
  html: string,
  receipt: PublicationReceipt,
): Promise<ProjectState> {
  validateState(state);
  validateDoc(doc);
  const embedded = receiptFromHtml(html), parsed = extractDocument(html);
  if (
    !equal(receipt, embedded) || receipt.docId !== state.docId ||
    doc.docId !== state.docId ||
    receipt.publishedDocSha256 !== await sha256(canonical(doc)) ||
    !equal(parsed, doc)
  ) {
    fail(
      "PUBLICATION_RECEIPT_MISMATCH",
      "Publication receipt, document and HTML do not agree.",
    );
  }
  const result = await markEmitted(state, doc, path, html);
  result.output = {
    ...result.output!,
    generation: receipt.generation,
    publishedDocSha256: receipt.publishedDocSha256,
    captureConsumed: false,
  };
  return result;
}
/** Validate lineage before captureEdits; do not compare native edits against a newer Studio snapshot. */
export async function verifyCapture(
  state: ProjectState,
  html: string,
): Promise<BentoDoc> {
  validateState(state);
  const receipt = receiptFromHtml(html), output = state.output;
  if (
    !output?.generation || !output.publishedDocSha256 ||
    typeof output.captureConsumed !== "boolean"
  ) {
    fail(
      "CAPTURE_BASELINE_MISSING",
      "Saved project predates publication receipts.",
    );
  }
  if (
    receipt.docId !== state.docId || receipt.generation !== output.generation ||
    receipt.publishedDocSha256 !== output.publishedDocSha256
  ) {
    fail(
      "STALE_CAPTURE_GENERATION",
      "This native HTML was produced by a different publication or project.",
    );
  }
  if (output.captureConsumed) {
    fail(
      "CAPTURE_GENERATION_CONSUMED",
      "This publication has already been captured. Another copy from the same generation cannot replace its saved edits.",
    );
  }
  if (await sha256(canonical(state.emitted)) !== output.publishedDocSha256) {
    fail(
      "STALE_CAPTURE_BASELINE",
      "Studio or project edits are newer than this native HTML baseline.",
    );
  }
  const doc = extractDocument(html) as unknown as BentoDoc;
  validateDoc(doc);
  if (doc.docId !== receipt.docId) {
    fail(
      "UNRELATED_DOCUMENT",
      "Native Bento document identity differs from its publication receipt.",
    );
  }
  return doc;
}
/** Consume only after a validated capture; persist this state atomically with its saved edits. */
export function consumeCapture(input: ProjectState): ProjectState {
  validateState(input);
  if (
    !input.output?.generation || !input.output.publishedDocSha256 ||
    typeof input.output.captureConsumed !== "boolean"
  ) {
    fail(
      "CAPTURE_BASELINE_MISSING",
      "Cannot consume a capture without a publication receipt.",
    );
  }
  if (input.output.captureConsumed) {
    fail(
      "CAPTURE_GENERATION_CONSUMED",
      "This publication has already been captured.",
    );
  }
  const state = clone(input);
  state.output!.captureConsumed = true;
  return state;
}
