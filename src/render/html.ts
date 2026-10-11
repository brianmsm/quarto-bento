import type { BentoDoc } from "./types.ts";
export const DOCUMENT_BLOCK = /(<script\b[^>]*\bid\s*=\s*["']bento-doc["'][^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
export function extractDocument(html: string): BentoDoc {
  const matches = [...html.matchAll(DOCUMENT_BLOCK)];
  if (matches.length !== 1) throw new Error("INVALID_HTML: expected exactly one bento-doc block");
  const doc = JSON.parse(matches[0][2]);
  if (doc.format !== "bento/slides" || doc.version !== 1 || !doc.docId || !Array.isArray(doc.slides)) {
    throw new Error("INVALID_DOCUMENT: incompatible or encrypted Bento document");
  }
  if (doc.collab) throw new Error("COLLABORATION_DISABLED: remove collaboration via an explicit independent copy");
  const slides = new Set();
  for (const slide of doc.slides) {
    if (!slide.id || slides.has(slide.id) || !Array.isArray(slide.elements)) throw new Error("DUPLICATE_ID: invalid slide identity");
    slides.add(slide.id);
    const ids = new Set();
    for (const el of slide.elements) {
      if (!el.id || ids.has(el.id)) throw new Error("DUPLICATE_ID: invalid element identity");
      ids.add(el.id);
    }
  }
  return doc;
}
export function spliceDocument(shell: string, doc: BentoDoc, preboot = ""): string {
  if ([...shell.matchAll(DOCUMENT_BLOCK)].length !== 1) throw new Error("INVALID_SHELL: bento-doc missing or duplicated");
  const json = JSON.stringify(doc).replaceAll("<", "\\u003c");
  let html = shell.replace(DOCUMENT_BLOCK, (_whole, start, _old, end) => start + json + end);
  if (preboot) {
    if (/<\/script/i.test(preboot)) throw new Error("INVALID_BOOTSTRAP: closing script token");
    html = html.replace(/<head([^>]*)>/i, `<head$1><script>${preboot}</script>`);
  }
  return html;
}
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
