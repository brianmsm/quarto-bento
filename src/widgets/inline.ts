import { OFFLINE_CSP } from "../bridge/isolation.ts";
import type { BentoDoc } from "../state/types.ts";

export interface InlineWidget {
  slideId: string;
  elementId: string;
  html: string;
}

export const INLINE_WIDGET_CSP = OFFLINE_CSP
  .replace("'unsafe-inline' 'self' blob:", "'unsafe-inline' 'self' blob: data:")
  .replace("frame-src 'none'", "frame-src 'self' data: blob:");

/** The pristine native shell retains this bootstrap on Save; overlays are transient. */
export function inlineWidgetBootstrap(
  document: BentoDoc,
  widgets: InlineWidget[],
): string {
  if (!widgets.length) return "";
  const entries = widgets.map((widget) => {
    const slide = document.slides.find((s) => s.id === widget.slideId);
    const element = slide?.elements.find((e) => e.id === widget.elementId);
    if (!slide || slide.hidden || element?.type !== "image") {
      throw new Error("INVALID_INLINE_WIDGET: expected a visible native image");
    }
    const bytes = new TextEncoder().encode(widget.html);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { ...widget, html: btoa(binary), src: element.src };
  });
  const data = JSON.stringify({ docId: document.docId, entries }).replaceAll(
    "<",
    "\\u003c",
  );
  return String.raw`(() => {
'use strict';
if (globalThis.__qbentoInlineWidgets) return;
Object.defineProperty(globalThis, '__qbentoInlineWidgets', {value:true});
const data=${data}, mounted=new Map();
const style=document.createElement('style');
style.setAttribute('data-bento-transient','');
style.textContent='.qbento-widget-layer{position:absolute;inset:0;pointer-events:none;z-index:1}.qbento-widget-layer iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:auto}.qbento-widget-layer button{position:absolute;right:4px;top:4px;z-index:2;padding:5px 9px;border:1px solid #64748b;border-radius:5px;background:#fff;color:#172a35;font:14px system-ui;cursor:pointer;pointer-events:auto}.qbento-widget-layer button:focus-visible{outline:3px solid #087a82;outline-offset:2px}.qbento-widget-layer iframe[hidden]{display:none}.qbento-widget-layer[hidden]{display:none}@media print{.qbento-widget-layer{display:none!important}}';
document.head.appendChild(style);
const decode=value=>new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
function valid(entry){
 const doc=globalThis.bento?.doc;
 if (!doc || doc.docId!==data.docId) return false;
 const slide=doc.slides.find(s=>s.id===entry.slideId), element=slide?.elements.find(e=>e.id===entry.elementId);
 return slide?.hidden!==true && element?.type==='image' && element.src===entry.src;
}
function stop(record,focus=false){
 record.active=false;record.ready=false;record.frame.hidden=true;
 record.frame.removeAttribute('srcdoc');record.button.textContent='Interactuar';
 record.button.setAttribute('aria-pressed','false');
 if(focus)record.button.focus();
}
function activate(record){
 if(record.active)return;
 record.active=true;record.button.textContent='Volver al diseño · Esc';
 record.button.setAttribute('aria-pressed','true');
 record.frame.srcdoc=decode(record.entry.html);
}
function refresh(){
 if(globalThis.bento?.doc && !style.isConnected)document.head.appendChild(style);
 for(const [node,record] of mounted){
  if(!node.isConnected || !valid(record.entry)){
   stop(record);record.layer.remove();mounted.delete(node);
  }
 }
 for(const entry of data.entries){
  if(!valid(entry))continue;
  for(const slide of document.querySelectorAll('.bento-slide[data-slide-id]')){
   if(slide.dataset.slideId!==entry.slideId || slide.closest('.bento-thumb-surface,#bento-print,[data-bento-preview]'))continue;
   for(const node of slide.querySelectorAll('.bento-el[data-el-id]')){
    if(node.dataset.elId!==entry.elementId || mounted.has(node))continue;
    const layer=document.createElement('div'),button=document.createElement('button'),frame=document.createElement('iframe');
    layer.className='qbento-widget-layer';layer.setAttribute('data-bento-transient','');
    button.type='button';button.textContent='Interactuar';button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label','Interactuar con gráfico '+entry.elementId);
    frame.title='Gráfico interactivo '+entry.elementId;frame.setAttribute('sandbox','allow-scripts');frame.hidden=true;
    const record={entry,layer,button,frame,active:false,ready:false};
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.stopPropagation();record.active?stop(record,true):activate(record);});
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop(record,true);}});
    layer.append(frame,button);node.appendChild(layer);mounted.set(node,record);
    if(globalThis.bento.doc.readonly || node.closest('.bento-present-overlay'))activate(record);
   }
  }
 }
}
addEventListener('message',event=>{
 if(event.origin!=='null')return;
 for(const record of mounted.values()){
  if(event.source!==record.frame.contentWindow || !record.active)continue;
  if(event.data?.qbentoWidgetEscape===true){stop(record,true);return;}
  if(event.data?.qbentoWidgetReady===true){record.ready=true;record.frame.hidden=false;record.frame.focus();return;}
  if(typeof event.data?.qbentoWidgetError==='string'){
   stop(record);record.button.textContent='Interacción no disponible';record.button.title=event.data.qbentoWidgetError;
  }
 }
});
new MutationObserver(refresh).observe(document.documentElement,{childList:true,subtree:true});
setInterval(refresh,200);
refresh();
})();`;
}
