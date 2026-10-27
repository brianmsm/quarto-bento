import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { NATIVE_INTERACTION_BOOTSTRAP } from "../src/bridge/native-interaction.ts";

Deno.test("native hit masks retain union ownership and restore untouched pointer styles", async () => {
  await withHeadlessChromium({}, async (browser) => {
    const { frameTree } = await browser.send<
      { frameTree: { frame: { id: string } } }
    >("Page.getFrameTree");
    await browser.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html:
        `<!doctype html><html><head><style>.region,.moveable-area{position:absolute;left:0;top:0;width:100px;height:100px}</style></head><body>
<div id="a" class="region"></div><div id="b" class="region"></div>
<div id="native" class="moveable-area" style="pointer-events:auto"></div>
<div id="unrelated" class="moveable-area" style="left:300px;pointer-events:all"></div>
<script>globalThis.bento={doc:{}};${NATIVE_INTERACTION_BOOTSTRAP}</script></body></html>`,
    });
    const response = await browser.send<
      { result: { value: boolean }; exceptionDetails?: unknown }
    >("Runtime.evaluate", {
      expression: `(()=>{
const hits=globalThis.__qbentoNativeInteractions,control=document.getElementById('native'),unrelated=document.getElementById('unrelated');
const original=control.getAttribute('style'),other=unrelated.getAttribute('style');
const a={node:document.getElementById('a'),buttons:[],on:true,allowed:true,active(){return this.on},valid(){return this.allowed},stop(){this.on=false}};
const b={node:document.getElementById('b'),buttons:[],on:true,allowed:true,active(){return this.on},valid(){return this.allowed},stop(){this.on=false}};
const removeA=hits.register(a),removeB=hits.register(b),masked=()=>control.classList.contains('qbento-widget-native-mask');
if(!masked())throw new Error('Active union did not mask native overlay');
a.on=false;hits.releasePointer();if(!masked())throw new Error('One provider released another provider mask');
b.on=false;hits.releasePointer();if(masked())throw new Error('Last provider did not release mask');
if(control.getAttribute('style')!==original||unrelated.getAttribute('style')!==other||unrelated.classList.contains('qbento-widget-native-mask'))throw new Error('Native or unrelated pointer styles changed');
a.on=true;hits.sync();a.node.remove();hits.sync();if(a.on||masked())throw new Error('Detached provider retained interaction or mask');
b.on=true;hits.sync();b.allowed=false;hits.sync();if(b.on||masked())throw new Error('Invalid provider retained interaction or mask');
b.allowed=true;b.on=true;hits.sync();b.node.style.visibility='hidden';hits.sync();if(b.on||masked())throw new Error('Hidden provider retained interaction or mask');
removeA();removeB();return control.getAttribute('style')===original&&unrelated.getAttribute('style')===other;
})()`,
      returnByValue: true,
    });
    if (response.exceptionDetails || !response.result.value) {
      throw new Error(JSON.stringify(response));
    }
  });
});
