/** Full native static deck with explicitly selected isolated interactive widget views. */
import type { BentoDoc } from "../state/types.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP, OFFLINE_CSP } from "../bridge/isolation.ts";
const html = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export async function createDeckPresenter(
  document: BentoDoc,
  widgets: { slideId: string; elementId: string; html: string }[],
): Promise<string> {
  const doc = structuredClone(document);
  doc.readonly = true;
  const shell = await Deno.readTextFile(
    new URL("../../vendor/bento/shell.html", import.meta.url),
  );
  const deck = spliceDocument(
    shell,
    doc as unknown as RenderDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP.replace("connect-src 'self'", "connect-src 'none'"),
  );
  const payload = JSON.stringify({ deck, widgets }).replaceAll("<", "\\u003c");
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${
    html(csp)
  }"><title>${
    html(String(doc.title ?? "Bento"))
  } · Presenter</title><style>html,body{margin:0;height:100%;font:15px system-ui;background:#172a35;color:white}header{display:flex;gap:12px;align-items:center;height:52px;padding:0 16px}button,select{font:inherit;padding:7px 10px}iframe{width:100%;height:calc(100vh - 52px);border:0;background:white}iframe[hidden]{display:none}#back[hidden]{display:none}@media print{header,#interactive{display:none!important}#deck{display:block!important}}</style></head><body><header><strong>Presentación</strong><select id="widgets" aria-label="Gráficos interactivos"><option value="">Elegir gráfico interactivo…</option>${
    widgets.map((w, i) =>
      `<option value="${i}">${html(w.slideId)} · ${html(w.elementId)}</option>`
    ).join("")
  }</select><button id="open" ${
    widgets.length ? "" : "disabled"
  }>Abrir gráfico</button><button id="back" hidden>Volver a diapositivas</button></header><iframe id="deck" title="Presentación Bento" sandbox="allow-scripts allow-same-origin"></iframe><iframe id="interactive" title="Gráfico interactivo aislado" sandbox="allow-scripts" hidden></iframe><script id="qb-presenter-data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('qb-presenter-data').textContent),deck=document.getElementById('deck'),frame=document.getElementById('interactive'),back=document.getElementById('back');deck.srcdoc=data.deck;
document.getElementById('open').onclick=()=>{const selected=document.getElementById('widgets').value;if(selected==='')return;frame.srcdoc=data.widgets[Number(selected)].html;frame.hidden=false;deck.hidden=true;back.hidden=false;};back.onclick=()=>{frame.hidden=true;frame.srcdoc='';deck.hidden=false;back.hidden=true;deck.focus();};
</script></body></html>`;
}
