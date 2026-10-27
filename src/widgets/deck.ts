/** Full native deck with isolated widgets in their saved native positions. */
import { loadBentoShell } from "../render/shell.ts";
import type { BentoDoc } from "../state/types.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP, OFFLINE_CSP } from "../bridge/isolation.ts";
import { INLINE_WIDGET_CSP, inlineWidgetBootstrap } from "./inline.ts";
import { attachOutputOverflow } from "../render/output-overflow-html.ts";
import type { OutputOverflowTarget } from "../render/output-overflow.ts";
const html = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export async function createDeckPresenter(
  document: BentoDoc,
  widgets: { slideId: string; elementId: string; html: string }[],
  overflowTargets: readonly OutputOverflowTarget[] = [],
): Promise<string> {
  const doc = structuredClone(document);
  doc.readonly = true;
  const shell = await loadBentoShell();
  const deck = attachOutputOverflow(
    spliceDocument(
      shell,
      doc as unknown as RenderDoc,
      ISOLATION_BOOTSTRAP + inlineWidgetBootstrap(doc, widgets),
      (widgets.length ? INLINE_WIDGET_CSP : OFFLINE_CSP).replace(
        "connect-src 'self'",
        "connect-src 'none'",
      ),
    ),
    overflowTargets,
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
  } · Presenter</title><style>html,body{margin:0;height:100%;background:#172a35}#deck{width:100%;height:100%;border:0;background:white}#qb-presenter-print{display:none}@media print{html,body{margin:0!important;height:auto!important;overflow:visible!important;background:white!important}#deck{display:none!important}#qb-presenter-print{display:block!important}#qb-presenter-print .bp-page{position:relative;overflow:hidden;break-after:page;print-color-adjust:exact}#qb-presenter-print .bento-slide{position:relative!important;visibility:visible!important;opacity:1!important}#qb-presenter-print .qbento-widget-layer,#qb-presenter-print .qb-overflow-control,#qb-presenter-print .qb-overflow-full{display:none!important}}</style></head><body><iframe id="deck" title="Interactive Bento presentation" sandbox="allow-scripts allow-same-origin"></iframe><script id="qb-presenter-data" type="application/json">${payload}</script><script>
const data=JSON.parse(document.getElementById('qb-presenter-data').textContent),frame=document.getElementById('deck');frame.srcdoc=data.deck;
// Print native slide DOM and complete continuations in the parent pagination context.
addEventListener('beforeprint',()=>{
 const child=frame.contentWindow,source=frame.contentDocument,doc=child?.bento?.doc;if(!doc)return;
 child.dispatchEvent(new Event('beforeprint'));
 document.getElementById('qb-presenter-print')?.remove();document.querySelectorAll('[data-qb-print-style]').forEach(s=>s.remove());
 const styles=document.createDocumentFragment();for(const style of source.querySelectorAll('style')){const copy=style.cloneNode(true);copy.removeAttribute('id');copy.dataset.qbPrintStyle='';styles.append(copy);}document.head.insertBefore(styles,document.head.querySelector('style'));
 const section=document.createElement('section');section.id='qb-presenter-print';
 const width=1600,height=Math.round(width*doc.size.height/doc.size.width),scale=width/doc.size.width;
 const pageStyle=document.createElement('style');pageStyle.textContent='@page{size:'+width+'px '+height+'px;margin:0}#qb-presenter-print .bp-page{width:'+width+'px;height:'+height+'px}';section.append(pageStyle);
 for(const slide of doc.slides){if(slide.hidden||slide.stateOf)continue;const native=[...source.querySelectorAll('.bento-slide[data-slide-id]')].find(node=>node.dataset.slideId===slide.id&&!node.closest('.bento-thumb-surface,#bento-print,[data-bento-preview]'));if(!native)continue;
  const page=document.createElement('div');page.className='bp-page';const copy=native.cloneNode(true);copy.style.transformOrigin='0 0';copy.style.transform='scale('+scale+')';copy.querySelectorAll('[data-bento-transient]').forEach(node=>node.remove());copy.querySelectorAll('.bento-step-hidden').forEach(node=>node.classList.remove('bento-step-hidden'));page.append(copy);section.append(page);
 }
 const complete=source.getElementById('qb-overflow-print');if(complete)section.append(complete.cloneNode(true));document.body.append(section);
});
</script></body></html>`;
}
