/** Full native deck with isolated widgets in their saved native positions. */
import { loadBentoShell } from "../render/shell.ts";
import type { BentoDoc } from "../state/types.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP } from "../bridge/isolation.ts";
import { INLINE_WIDGET_CSP, inlineWidgetBootstrap } from "./inline.ts";
const html = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export async function createDeckPresenter(
  document: BentoDoc,
  widgets: { slideId: string; elementId: string; html: string }[],
): Promise<string> {
  const doc = structuredClone(document);
  doc.readonly = true;
  const shell = await loadBentoShell();
  const deck = spliceDocument(
    shell,
    doc as unknown as RenderDoc,
    ISOLATION_BOOTSTRAP + inlineWidgetBootstrap(doc, widgets),
    INLINE_WIDGET_CSP.replace("connect-src 'self'", "connect-src 'none'"),
  );
  const payload = JSON.stringify({
    deck,
    widgets: widgets.map(({ slideId, elementId }) => ({ slideId, elementId })),
  }).replaceAll("<", "\\u003c");
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${
    html(csp)
  }"><title>${
    html(String(doc.title ?? "Bento"))
  } · Presenter</title><style>html,body{margin:0;height:100%;background:#172a35}#deck{width:100%;height:100%;border:0;background:white}</style></head><body><iframe id="deck" title="Presentación Bento interactiva" sandbox="allow-scripts allow-same-origin"></iframe><script id="qb-presenter-data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('qb-presenter-data').textContent);document.getElementById('deck').srcdoc=data.deck;
</script></body></html>`;
}
