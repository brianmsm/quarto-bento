import type { OutputOverflowTarget } from "./output-overflow.ts";
import { NATIVE_INTERACTION_BOOTSTRAP } from "../bridge/native-interaction.ts";

export function attachOutputOverflow(
  html: string,
  targets: readonly OutputOverflowTarget[],
): string {
  if (!targets.length) return html;
  const payload = JSON.stringify(targets).replaceAll("<", "\\u003c");
  const script = NATIVE_INTERACTION_BOOTSTRAP + `(()=>{
const targets=${payload},mounted=new Map(),hits=globalThis.__qbentoNativeInteractions;
const lookup=t=>window.bento?.doc?.slides?.find(s=>s.id===t.slideId&&!s.hidden)?.elements?.find(e=>e.id===t.elementId);
function plain(html){const template=document.createElement('template');template.innerHTML=String(html??'');for(const br of template.content.querySelectorAll('br'))br.replaceWith('\\n');for(const block of template.content.querySelectorAll('p,div,li'))block.append('\\n');return template.content.textContent;}
function body(e){const root=document.createElement(e.type==='table'?'table':'pre'),style=e.type==='table'?e.style??{}:e;root.style.fontFamily=style.fontFamily??e.fontFamily??window.bento?.doc?.theme?.fontFamily??(e.type==='code'?'ui-monospace, monospace':'sans-serif');root.style.fontSize=(style.fontSize??e.fontSize??(e.type==='table'?18:24))+'px';root.style.lineHeight=String(style.lineHeight??e.lineHeight??1.25);root.style.fontWeight=String(style.fontWeight??e.fontWeight??400);root.style.color=style.color??e.color??'#000';if(e.type==='table'){for(const [i,r] of e.rows.entries()){const row=root.insertRow();for(const c of r.cells){const cell=document.createElement(e.header&&i===0?'th':'td');cell.textContent=plain(c.html);cell.style.textAlign=c.align??'left';cell.style.padding=(style.cellPadY??11)+'px '+(style.cellPadX??16)+'px';if(e.header&&i===0)cell.scope='col';row.append(cell);}}}else root.textContent=e.type==='code'?e.content:plain(e.html);return root;}
function full(t,returnTo){
 const e=lookup(t);if(!e)return;
 const dialog=document.createElement('dialog');dialog.dataset.bentoTransient='';dialog.className='qb-overflow-dialog';dialog.setAttribute('aria-label','Complete output');
 const close=document.createElement('button');close.type='button';close.textContent='Close complete output';close.onclick=()=>dialog.close();
 dialog.append(close,body(e));dialog.addEventListener('keydown',event=>event.stopPropagation());
 dialog.addEventListener('close',()=>{dialog.remove();returnTo.focus();hits.releasePointer();});
 document.body.append(dialog);dialog.showModal();close.focus();hits.releasePointer();
}
function mount(){
 if(!window.bento?.doc)return;
 for(const [node,record] of mounted)if(!node.isConnected||!lookup(record.target)){record.stop();record.releaseHits();mounted.delete(node);}
 for(const t of targets){
  if(!lookup(t))continue;
  for(const slide of document.querySelectorAll('.bento-slide[data-slide-id]')){
   if(slide.dataset.slideId!==t.slideId||slide.closest('.bento-thumb-surface,#bento-print,#qb-overflow-print,[data-bento-preview]'))continue;
   for(const outer of slide.querySelectorAll('[data-el-id]')){
    if(outer.dataset.elId!==t.elementId||mounted.has(outer))continue;
    const button=document.createElement('button'),more=document.createElement('button');
    button.type=more.type='button';button.className='qb-overflow-control';more.className='qb-overflow-full';
    button.dataset.bentoTransient=more.dataset.bentoTransient='';button.textContent='Scroll output';more.textContent='Complete output';button.setAttribute('aria-pressed','false');
    const originalOverflow=outer.style.overflow,originalTabIndex=outer.getAttribute('tabindex'),active=()=>button.getAttribute('aria-pressed')==='true';
    function stop(focus=false){button.setAttribute('aria-pressed','false');button.textContent='Scroll output';outer.style.overflow=originalOverflow;outer.scrollTop=outer.scrollLeft=0;if(originalTabIndex===null)outer.removeAttribute('tabindex');else outer.setAttribute('tabindex',originalTabIndex);hits.releasePointer();if(focus)button.focus();}
    const stopNative=event=>{if(active())event.stopPropagation();};
    for(const name of ['pointerdown','pointermove','pointerup','dblclick','wheel','keydown'])outer.addEventListener(name,stopNative);
    for(const control of [button,more])control.addEventListener('pointerdown',event=>event.stopPropagation());
    button.onclick=event=>{event.stopPropagation();if(active())stop(true);else{button.setAttribute('aria-pressed','true');button.textContent='Finish scrolling';outer.style.overflow='auto';outer.tabIndex=0;outer.focus();hits.sync();}};
    outer.addEventListener('keydown',event=>{if(event.key==='Escape'&&active()){event.preventDefault();stop(true);}});
    more.onclick=event=>{event.stopPropagation();stop();full(t,more);};
    outer.setAttribute('aria-label','Output with scrolling and complete view');
    for(const child of outer.children){child.style.flexShrink='0';if(child.tagName==='DIV'){child.style.height='auto';child.style.overflow='visible';}}
    outer.append(button,more);
    const record={target:t,stop};record.releaseHits=hits.register({node:outer,buttons:[button,more],active,valid:()=>!!lookup(t),stop});
    mounted.set(outer,record);
   }
  }
 }
 hits.sync();
}
function print(){document.getElementById('qb-overflow-print')?.remove();const section=document.createElement('section');section.id='qb-overflow-print';section.dataset.bentoTransient='';for(const t of targets){const e=lookup(t);if(!e)continue;const page=document.createElement('article'),heading=document.createElement('h2');heading.textContent='Complete output · '+t.slideId+' · '+t.elementId;page.append(heading,body(e));section.append(page);}document.body.append(section);}
addEventListener('beforeprint',print);const observer=new MutationObserver(()=>{observer.disconnect();mount();observer.observe(document.body,{childList:true,subtree:true});});function start(){mount();observer.observe(document.body,{childList:true,subtree:true});}if(document.readyState==='loading')addEventListener('DOMContentLoaded',start,{once:true});else start();
})();`;
  const css =
    `.qb-overflow-control,.qb-overflow-full{position:absolute;top:0;right:0;z-index:5;font:12px sans-serif;padding:4px 6px}.qb-overflow-full{right:104px}.qb-overflow-dialog{max-width:90vw;max-height:85vh;overflow:auto}.qb-overflow-dialog pre{white-space:pre;max-width:none}.qb-overflow-dialog table,#qb-overflow-print table{border-collapse:collapse}.qb-overflow-dialog td,.qb-overflow-dialog th,#qb-overflow-print td,#qb-overflow-print th{border:1px solid #aaa;white-space:pre-wrap}#qb-overflow-print{display:none}@media print{html,body{height:auto!important;overflow:visible!important}.qb-overflow-control,.qb-overflow-full,.qb-overflow-dialog{display:none!important}#qb-overflow-print{display:block!important;position:static!important;color:#000;background:#fff;padding:24px;box-sizing:border-box}#qb-overflow-print article{break-before:page}#qb-overflow-print pre{white-space:pre-wrap;overflow-wrap:anywhere}#qb-overflow-print tr{break-inside:avoid}#qb-overflow-print h2{font:16px sans-serif}}`;
  return html.replace(
    /<head([^>]*)>/i,
    `<head$1><style id="qbento-output-overflow-style">${css}</style><script id="qbento-output-overflow">${script}</script>`,
  );
}
