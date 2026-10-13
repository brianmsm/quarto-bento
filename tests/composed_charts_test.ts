import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { previewSync } from "../src/core/sync.ts";
import { canonical, targetKey } from "../src/state/mod.ts";
import {
  applyComponentDesign,
  parseDesignAttributes,
} from "../src/render/design.ts";
import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { spliceDocument } from "../src/render/html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import type { BentoDoc as StateDoc } from "../src/state/types.ts";
import type { BentoDoc, Element } from "../src/render/types.ts";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
async function refuses(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    ok(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const example = new URL("../examples/composed-charts/", import.meta.url);
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-composed-charts-" });
  for (const name of ["deck.qmd", "data.csv"]) {
    await Deno.copyFile(new URL(name, example), `${dir}/${name}`);
  }
  return { dir, source: `${dir}/deck.qmd` };
}
function charts(doc: StateDoc) {
  return doc.slides[0].elements.filter((e) => e.type === "chart");
}
async function nativeMetrics(doc: StateDoc, name: string) {
  const shell = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    prepareIsolatedDocument(doc) as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  return await withHeadlessChromium({}, async (browser) => {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html,
    });
    const expected = charts(doc).map((e) => ({
      id: e.id,
      w: e.w,
      h: e.h,
      option: e.option,
    }));
    const result = await browser.send<
      { result: { value: unknown }; exceptionDetails?: unknown }
    >("Runtime.evaluate", {
      expression: `(async()=>{
        const charts=${JSON.stringify(expected)};
        const node=id=>document.querySelector('[data-el-id="'+id+'"] svg');
        for(let i=0;i<200&&(!charts.every(c=>node(c.id))||document.getElementById('bento-splash'));i++)await new Promise(r=>setTimeout(r,25));
        await document.fonts.ready;
        return charts.map(c=>{const svg=node(c.id);if(!svg)throw new Error('missing chart '+c.id);
          const vb=svg.viewBox.baseVal;
          if(Math.abs(vb.width-c.w)>.001||Math.abs(vb.height-c.h)>.001)throw new Error('native frame mismatch');
          const texts=[...svg.querySelectorAll('text')].map(t=>{const b=t.getBBox();if(b.x<-.5||b.y<-.5||b.x+b.width>vb.width+.5||b.y+b.height>vb.height+.5)throw new Error('clipped label '+t.textContent);return {text:t.textContent,x:b.x,y:b.y,w:b.width,h:b.height,font:t.getAttribute('font-size')};});
          for(const label of [...c.option.xAxis.data,...c.option.series.map(s=>s.name)])if(!texts.some(t=>t.text===label))throw new Error('missing label '+label);
          for(let a=0;a<texts.length;a++)for(let b=a+1;b<texts.length;b++){const p=texts[a],q=texts[b];if(Math.min(p.x+p.w,q.x+q.w)>Math.max(p.x,q.x)+.5&&Math.min(p.y+p.h,q.y+q.h)>Math.max(p.y,q.y)+.5)throw new Error('overlapping labels '+p.text+' '+q.text);}
          const {grid,yAxis,xAxis,series}=c.option;
          const bottom=c.h-grid.bottom, plotH=bottom-grid.top, plotW=c.w-grid.left-grid.right;
          const y=v=>bottom-(v-yAxis.min)/(yAxis.max-yAxis.min)*plotH;
          const close=(a,b)=>Math.abs(a-b)<.01;
          const bars=series[0].type==='bar';
          const nodes=[...svg.querySelectorAll(bars?'rect':'circle')].filter(n=>bars?n.getAttribute('fill')!=='transparent'&&Number(n.getAttribute('y'))<=bottom&&n.getAttribute('rx')==='0':true);
          if(nodes.length!==series.length*xAxis.data.length)throw new Error('numeric mark count mismatch');
          const marks=nodes.map((n,index)=>{
            const s=series[Math.floor(index/xAxis.data.length)], category=index%xAxis.data.length, value=s.data[category];
            if(bars){const top=Number(n.getAttribute('y')),h=Number(n.getAttribute('height')),cx=Number(n.getAttribute('x'))+Number(n.getAttribute('width'))/2;
              if(!close(top,Math.min(y(value),y(0)))||!close(h,Math.abs(y(value)-y(0))))throw new Error('wrong bar magnitude or sign');
              if(cx<grid.left+category*plotW/xAxis.data.length||cx>grid.left+(category+1)*plotW/xAxis.data.length)throw new Error('wrong bar category');
              return {series:s.name,category:xAxis.data[category],value,top,h,cx};
            }
            const cx=Number(n.getAttribute('cx')),cy=Number(n.getAttribute('cy'));
            if(!close(cy,y(value))||!close(cx,grid.left+(category+.5)*plotW/xAxis.data.length))throw new Error('wrong line point');
            return {series:s.name,category:xAxis.data[category],value,cx,cy};
          });
          if(texts.some(t=>t.font!=='14'))throw new Error('scaled chart typography');
          return {id:c.id,w:vb.width,h:vb.height,texts,marks};
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const evidence = Deno.env.get("QBENTO_COMPOSED_CHARTS_EVIDENCE");
    if (evidence) {
      await Deno.mkdir(evidence, { recursive: true });
      await Deno.writeTextFile(
        `${evidence}/${name}.json`,
        JSON.stringify(
          { browser: browser.version, metrics: result.result.value },
          null,
          2,
        ),
      );
      const png = await browser.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png" },
      );
      await Deno.writeFile(
        `${evidence}/${name}.png`,
        Uint8Array.from(atob(png.data), (c) => c.charCodeAt(0)),
      );
    }
  });
}
Deno.test("composed native bars and lines preserve native axes, source authority, saved geometry and state-only rebuild", async () => {
  const { dir, source } = await fixture();
  const fresh = await Deno.makeTempDir({ prefix: "qbento-charts-rebuild-" });
  try {
    const original = await Deno.readTextFile(source),
      first = await renderProject(source);
    const [authored, computed] = charts(first.state.emitted);
    eq(charts(first.state.emitted).length, 2);
    eq([authored.groupId, computed.groupId], ["grid", "grid"]);
    eq([authored.x, authored.y, authored.w, authored.h], [104, 250, 496, 362]);
    eq([computed.x, computed.y, computed.w, computed.h], [680, 250, 496, 362]);
    eq(
      first.state
        .provenance[targetKey({ slideId: "results", elementId: computed.id })]
        .producer,
      "chart-maker",
    );
    eq(
      first.state
        .provenance[targetKey({ slideId: "results", elementId: authored.id })]
        .origin,
      "authored",
    );
    await nativeMetrics(first.state.emitted, "initial");
    const edit = structuredClone(first.state.emitted), chart = charts(edit)[1];
    chart.x = 688;
    chart.opacity = .9;
    const saved = await saveProject(source, edit, first.state.revision);
    eq(saved.pending.length, 0);
    await Deno.writeTextFile(
      `${dir}/data.csv`,
      "Group,N\nAlpha,-2.5\nGamma,4.75\n",
    );
    const next = await renderProject(source),
      changed = charts(next.state.emitted)[1];
    eq(changed.x, 688);
    eq(changed.opacity, .9);
    eq(next.state.docId, first.state.docId);
    eq(next.state.pending.length, 0);
    ok(canonical(changed.option).includes("Gamma"));
    await nativeMetrics(next.state.emitted, "changed-data");
    await Deno.mkdir(`${fresh}/.qbento`);
    for (
      const name of [
        "deck.qmd",
        "data.csv",
        ".qbento/project.json",
        ".qbento/state.json",
      ]
    ) await Deno.copyFile(`${dir}/${name}`, `${fresh}/${name}`);
    const rebuilt = await renderProject(`${fresh}/deck.qmd`);
    eq(rebuilt.state.emitted, next.state.emitted);
    eq(rebuilt.state.pending.length, 0);
    const tampered = structuredClone(next.state.emitted);
    charts(tampered)[1].option = computed.option;
    const pending = await saveProject(source, tampered, next.state.revision);
    eq(pending.pending[0].status, "conflict");
    eq(pending.pending[0].origin, "computed");
    await refuses(() => previewSync(source), "SYNC_CONFLICT");
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(fresh, { recursive: true });
  }
});
Deno.test("composed chart metric and sibling refusals preserve previous publication and state", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source),
      first = await renderProject(source),
      output = await Deno.readTextFile(`${dir}/deck.bento.html`);
    for (
      const [qmd, code] of [
        [
          original.replace(
            'bento-layout-name="two-column"',
            'bento-layout-name="two-column" w="500"',
          ),
          "UNSUPPORTED_CHART",
        ],
        [
          original.replace(
            'bento-layout-name="two-column"',
            'bento-layout-name="two-column" h="300"',
          ),
          "UNSUPPORTED_CHART",
        ],
        [
          original.replace("| Alpha |", "| Extremely long category label |"),
          "UNSUPPORTED_CHART",
        ],
        [
          original.replace("| Effect |", "| Extremely long legend label |"),
          "UNSUPPORTED_CHART",
        ],
        [
          original.replace(
            "| Beta | 0 | 3 |",
            "| Beta | 0 | 3 |\n\nLost sibling.",
          ),
          "UNMAPPED_CHART_SOURCE",
        ],
        [
          original.replace(
            "{#effects .bento-chart",
            '{#effects x="100" .bento-chart',
          ),
          "COMPONENT_CHILD_GEOMETRY",
        ],
      ]
    ) {
      await Deno.writeTextFile(source, qmd);
      await refuses(() => renderProject(source), code);
      eq(await Deno.readTextFile(source), qmd);
      eq(await Deno.readTextFile(`${dir}/deck.bento.html`), output);
      eq((await readProject(source)).revision, first.state.revision);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("charts directly in columns keep full slot metrics and refuse box-only scaling", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source);
    await Deno.writeTextFile(
      source,
      original.replaceAll(" .bento-card", "").replace("### Effects\n\n", "")
        .replace("### Trend\n\n", ""),
    );
    const result = await renderProject(source);
    for (const chart of charts(result.state.emitted)) {
      eq([chart.w, chart.h], [544, 470]);
    }
    await nativeMetrics(result.state.emitted, "direct-columns");
    const chart = charts(result.state.emitted)[0] as Element;
    await refuses(
      () =>
        applyComponentDesign(
          [[chart]],
          parseDesignAttributes(["card", ["bento-card"], [["w", "300"], [
            "h",
            "600",
          ]]]),
        ),
      "COMPONENT_CONTENT_OVERFLOW",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("authored option edits and explicit parent geometry remain pending without guessed source synchronization", async () => {
  const { dir, source } = await fixture();
  try {
    const original = (await Deno.readTextFile(source)).replace(
      "{#grid .bento-layout",
      '{#grid x="80" .bento-layout',
    );
    await Deno.writeTextFile(source, original);
    const first = await renderProject(source),
      edit = structuredClone(first.state.emitted);
    charts(edit)[0].x = 110;
    const saved = await saveProject(source, edit, first.state.revision);
    ok(saved.pending.some((p) => p.path[0] === "x"));
    await refuses(() => previewSync(source), "UNMAPPED_DESIGN");
    const next = await renderProject(source);
    eq(charts(next.state.emitted)[0].x, 110);
    eq(next.state.pending.length, saved.pending.length);
    eq(await Deno.readTextFile(source), original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fractional composed chart frames preserve exact dimensions and typography", async () => {
  const { dir, source } = await fixture();
  try {
    const original = await Deno.readTextFile(source);
    await Deno.writeTextFile(
      source,
      original.replace(
        'bento-layout-name="two-column"',
        'bento-layout-name="two-column" w="1120.4"',
      ),
    );
    const first = await renderProject(source);
    for (const chart of charts(first.state.emitted)) {
      ok(Math.abs(Number(chart.w) - 496.2) < .000001);
      eq(chart.h, 362);
      eq(chart.groupId, "grid");
    }
    await nativeMetrics(first.state.emitted, "fractional");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
