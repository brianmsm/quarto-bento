import { OFFLINE_CSP } from "../bridge/isolation.ts";
import type { BentoDoc } from "../state/types.ts";
import { hashSource } from "../source/mod.ts";
import { pngCameraMetadata } from "./camera-png.ts";
import { NATIVE_INTERACTION_BOOTSTRAP } from "../bridge/native-interaction.ts";

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
    return {
      ...widget,
      html: btoa(binary),
      src: element.src,
      staticHash: hashSource(String(element.src)),
    };
  });
  const data = JSON.stringify({ docId: document.docId, entries }).replaceAll(
    "<",
    "\\u003c",
  );
  return NATIVE_INTERACTION_BOOTSTRAP + String.raw`(() => {
'use strict';
if (globalThis.__qbentoInlineWidgets) return;
Object.defineProperty(globalThis, '__qbentoInlineWidgets', {value:true});
const data=${data}, mounted=new Map();
const pngCamera=${pngCameraMetadata.toString()}, savedCache=new Map();
function savedEntry(entry){
 const src=globalThis.bento?.doc?.slides.find(s=>s.id===entry.slideId)?.elements.find(e=>e.id===entry.elementId)?.src;
 if(typeof src!=='string'||src===entry.src)return;
 if(savedCache.get(entry.elementId)?.src===src)return savedCache.get(entry.elementId).value;
 let value;
 try{
  const meta=pngCamera(src).metadata;
  if(meta?.version===1&&meta.docId===data.docId&&meta.slideId===entry.slideId&&meta.elementId===entry.elementId&&meta.originalStaticHash===entry.staticHash&&Object.keys(meta).sort().join(',')==='camera,docId,elementId,originalStaticHash,slideId,version')value={camera:camera(meta.camera),staticSrc:src};
 }catch{}
 savedCache.set(entry.elementId,{src,value});return value;
}
function camera(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['eye','center','up','projection'].includes(k)))throw new Error('Invalid camera');
 const result={};
 for(const name of ['eye','center','up'])if(value[name]!==undefined){const v=value[name];if(!v||Object.keys(v).sort().join(',')!=='x,y,z'||!['x','y','z'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k])&&Math.abs(v[k])<=10000))throw new Error('Invalid camera vector');result[name]={x:v.x,y:v.y,z:v.z};}
 if(value.projection!==undefined){if(Object.keys(value.projection).join(',')!=='type'||!['perspective','orthographic'].includes(value.projection.type))throw new Error('Invalid camera projection');result.projection={type:value.projection.type};}
 if(!Object.keys(result).length)throw new Error('Empty camera');return result;
}
const style=document.createElement('style');
style.setAttribute('data-bento-transient','');
style.textContent='.qbento-widget-layer{position:absolute;inset:0;pointer-events:none;z-index:1}.qbento-widget-layer iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:auto}.qbento-widget-layer button{position:absolute;right:4px;top:4px;z-index:2;padding:5px 9px;border:1px solid #64748b;border-radius:5px;background:#fff;color:#172a35;font:14px system-ui;cursor:pointer;pointer-events:auto}.qbento-widget-layer button:focus-visible{outline:3px solid #087a82;outline-offset:2px}.qbento-widget-layer iframe[hidden]{display:none}.qbento-widget-layer[hidden]{display:none}@media print{.qbento-widget-layer{display:none!important}}';
document.head.appendChild(style);
const decode=value=>new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));
function valid(entry){
 const doc=globalThis.bento?.doc;
 if (!doc || doc.docId!==data.docId) return false;
 const slide=doc.slides.find(s=>s.id===entry.slideId), element=slide?.elements.find(e=>e.id===entry.elementId);
 const approved=savedEntry(entry);
 return slide?.hidden!==true && element?.type==='image' && (element.src===entry.src || approved?.staticSrc===element.src);
}
const hits=globalThis.__qbentoNativeInteractions;
function stop(record,focus=false){
 record.active=false;record.ready=false;record.frame.hidden=true;
 record.save.hidden=true;record.requestId=null;record.channel=null;
 record.frame.style.pointerEvents='';
 record.frame.removeAttribute('srcdoc');record.button.textContent='Interactuar';
 record.button.setAttribute('aria-pressed','false');
 hits.releasePointer();
 if(focus)record.button.focus();
}
function activate(record){
 if(record.active||!valid(record.entry)||!record.layer.isConnected)return;
 record.active=true;record.button.textContent='Volver al diseño · Esc';
 record.button.setAttribute('aria-pressed','true');
 record.frame.srcdoc=decode(record.entry.html);
 hits.sync();requestAnimationFrame(hits.sync);
}
function refresh(){
 if(globalThis.bento?.doc && !style.isConnected)document.head.appendChild(style);
 for(const [node,record] of mounted){
  if(!node.isConnected || !valid(record.entry)){
   stop(record);record.releaseHits();record.layer.remove();mounted.delete(node);
  }
  else{
   const visible=hits.visible(record.layer);
   if(record.active&&!visible)stop(record);
   else if(visible&&!record.visible&&(globalThis.bento.readonly||globalThis.bento.doc.readonly||node.closest('.bento-present-overlay')))activate(record);
   record.visible=visible;
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
    const save=document.createElement('button');save.type='button';save.textContent='Save view';save.style.right='190px';save.hidden=true;
    const record={entry,layer,button,frame,save,active:false,ready:false,channel:null,requestId:null};
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.stopPropagation();record.active?stop(record,true):activate(record);});
    layer.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stop(record,true);}});
    for(const name of ['pointerdown','pointerup','pointermove','dblclick','wheel'])layer.addEventListener(name,event=>event.stopPropagation());
    save.addEventListener('click',event=>{event.stopPropagation();if(!record.ready||!record.channel||!valid(entry))return;record.requestId=crypto.randomUUID();save.disabled=true;frame.style.pointerEvents='none';frame.contentWindow.postMessage({qbentoWidgetCameraRequest:record.channel,requestId:record.requestId},'*');});
    layer.append(frame,button,save);node.appendChild(layer);mounted.set(node,record);
    record.visible=hits.visible(layer);
    record.releaseHits=hits.register({node:layer,buttons:[button,save],active:()=>record.active,valid:()=>valid(entry),stop:()=>{record.visible=false;stop(record);}});
    if(record.visible&&(globalThis.bento.readonly||globalThis.bento.doc.readonly||node.closest('.bento-present-overlay')))activate(record);
   }
  }
 }
 hits.sync();
}
addEventListener('message',event=>{
 if(event.origin!=='null')return;
 for(const record of mounted.values()){
  if(event.source!==record.frame.contentWindow || !record.active || !valid(record.entry) || !record.layer.isConnected)continue;
  if(event.data?.qbentoWidgetEscape===true){stop(record,true);return;}
  if(event.data?.qbentoWidgetReady===true){record.ready=true;record.channel=event.data.qbentoWidgetChannel;record.frame.hidden=false;record.save.hidden=!record.channel||typeof globalThis.bento?.loadDoc!=='function';record.save.disabled=false;const approved=savedEntry(record.entry);if(approved){try{record.frame.contentWindow.postMessage({qbentoWidgetCameraRestore:record.channel,camera:camera(approved.camera)},'*');}catch{stop(record);}}record.frame.focus();return;}
  if(typeof event.data?.qbentoWidgetError==='string'){
   stop(record);record.button.textContent='Interacción no disponible';record.button.title=event.data.qbentoWidgetError;
  }
  if(event.data?.qbentoWidgetCamera===record.channel&&record.requestId&&event.data.requestId===record.requestId){
   record.requestId=null;record.save.disabled=false;record.frame.style.pointerEvents='';
   try{
    if(event.data.error)throw new Error(event.data.error);
    const view=camera(event.data.camera),png=event.data.png;
    if(typeof png!=='string'||png.length>12000022||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(png))throw new Error('Invalid camera snapshot');
    const snapshot=globalThis.__qbentoSnapshot;
    if(snapshot&&parent!==globalThis){
     parent.postMessage({type:'qbento:save-widget-camera',docId:snapshot.docId,revision:snapshot.revision,slideId:record.entry.slideId,elementId:record.entry.elementId,staticSrc:record.entry.src,camera:view},location.origin);
     record.save.textContent='Saving view…';
    }else{
     const doc=structuredClone(globalThis.bento.doc),element=doc.slides.find(s=>s.id===record.entry.slideId)?.elements.find(e=>e.id===record.entry.elementId);
     if(!element||!valid(record.entry))throw new Error('Widget changed before saving');
     // Native Save clones the pristine shell, so bounded camera metadata travels in the actual PNG.
     element.src=pngCamera(png,{version:1,docId:data.docId,slideId:record.entry.slideId,elementId:record.entry.elementId,originalStaticHash:record.entry.staticHash,camera:view}).png;
     if(!globalThis.bento.loadDoc(JSON.stringify(doc)))throw new Error('Native document refused the camera snapshot');record.save.textContent='View saved';
     // Native document replacement resets navigation; keep the explicitly saved display slide.
     requestAnimationFrame(()=>{
      const current=globalThis.bento.doc,index=current.slides.findIndex(s=>s.id===record.entry.slideId);
      if(current.docId!==doc.docId||index<0||current.slides[index].elements.find(e=>e.id===record.entry.elementId)?.src!==element.src)return;
      document.querySelector('.ed-thumb[data-index="'+index+'"]')?.click();
     });
    }
   }catch(error){record.save.textContent='Save view failed';record.save.title=String(error);}
   return;
  }
 }
});
addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='qbento:widget-camera-error')return;
 for(const record of mounted.values()){record.save.textContent='Save view';record.save.title=String(event.data.message);record.save.disabled=false;}
});
new MutationObserver(refresh).observe(document.documentElement,{childList:true,subtree:true});
setInterval(refresh,200);
refresh();
})();`;
}
