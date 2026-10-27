/** Shared, transient hit-testing for explicit controls beneath native group handles. */
export const NATIVE_INTERACTION_BOOTSTRAP = String.raw`(() => {
'use strict';
if(globalThis.__qbentoNativeInteractions)return;
const records=new Set(),masks=new Set(),maskClass='qbento-widget-native-mask';
const style=document.createElement('style');style.dataset.bentoTransient='';style.textContent='.'+maskClass+'{pointer-events:none!important}';
let pointer=null,syncing=false;
function visible(node){if(!node?.isConnected)return false;const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0&&getComputedStyle(node).visibility!=='hidden';}
function inside(rect,point){return point&&point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top&&point.y<=rect.bottom;}
function sync(){
 if(syncing)return;syncing=true;
 try{
  if(globalThis.bento?.doc&&!style.isConnected)document.head.append(style);
  const regions=[];
  for(const record of records){
   if(!record.valid()||!visible(record.node)){if(record.active())record.stop();continue;}
   if(record.active())regions.push(record.node.getBoundingClientRect());
   else for(const button of record.buttons){if(visible(button)&&inside(button.getBoundingClientRect(),pointer))regions.push(button.getBoundingClientRect());}
  }
  const next=new Set();
  for(const control of document.querySelectorAll('.moveable-area,.moveable-control,.moveable-line')){
   const rect=control.getBoundingClientRect();
   if(regions.some(region=>rect.right>region.left&&rect.left<region.right&&rect.bottom>region.top&&rect.top<region.bottom)){
    if(masks.has(control)||!control.classList.contains(maskClass)){next.add(control);control.classList.add(maskClass);}
   }
  }
  for(const control of masks)if(!next.has(control))control.classList.remove(maskClass);
  masks.clear();for(const control of next)masks.add(control);
 }finally{syncing=false;}
}
document.addEventListener('pointermove',event=>{pointer={x:event.clientX,y:event.clientY};sync();},true);
document.addEventListener('pointerout',event=>{if(event.relatedTarget===null){pointer=null;sync();}},true);
document.addEventListener('pointerdown',event=>{
 if(!(event.target instanceof Element)||!event.target.closest('.moveable-area,.moveable-control,.moveable-line'))return;
 const point={x:event.clientX,y:event.clientY};
 for(const record of records){
  if(!record.valid()||!visible(record.node))continue;
  for(const button of record.buttons)if(visible(button)&&inside(button.getBoundingClientRect(),point)){event.preventDefault();event.stopImmediatePropagation();button.click();return;}
 }
},true);
Object.defineProperty(globalThis,'__qbentoNativeInteractions',{value:{
 register(record){records.add(record);sync();return()=>{records.delete(record);sync();};},
 visible,
 sync,
 releasePointer(){pointer=null;sync();}
}});
setInterval(sync,200);
})();`;
