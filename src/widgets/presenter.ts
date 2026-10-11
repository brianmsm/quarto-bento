import { canonical } from "../state/json.ts";
import type { Element, Origin } from "../render/types.ts";
import { scanSource, type SourceDocument } from "../source/mod.ts";
import { hashSource } from "../source/mod.ts";
import { fail, parsePlotlyPayload, type PlotlyCandidate } from "./plotly.ts";

/** Exact local runtime proved by this adapter, never fetched from a CDN. */
export const PLOTLY_RUNTIME = {
  version: "2.25.2",
  sha256: "419deebe105f4c993feb7e6d1fe94fb1c2f7f98716db5d9b8fe3e37773838898",
  licenseSha256:
    "67a26cf80f03ff388f26945dfc1f6caed1a0746ff43871190339b3aee49b94bb",
} as const;
export interface PlotlyRuntime {
  javascript: string;
  license: string;
}
export interface PlotlyBundle {
  version: 1;
  candidate: PlotlyCandidate;
  runtime: typeof PLOTLY_RUNTIME;
  fallback: { mime: "image/svg+xml"; svg: string; sha256: string };
}
/** Store separately in the trusted generation receipt, never load from the bundle. */
export interface PlotlyReceipt {
  version: 1;
  bundleHash: string;
  source: PlotlyCandidate["source"];
  specHash: string;
  runtimeSha256: string;
}
export interface PlotlyContext {
  source: SourceDocument;
  expectedReceipt: PlotlyReceipt;
}
const encode = (value: string) => {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};
const html = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll(
    "<",
    "&lt;",
  ).replaceAll(">", "&gt;");
const json = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
async function sha256(value: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyPlotlyRuntime(
  runtime: PlotlyRuntime,
): Promise<void> {
  if (
    await sha256(runtime.javascript) !== PLOTLY_RUNTIME.sha256 ||
    await sha256(runtime.license) !== PLOTLY_RUNTIME.licenseSha256
  ) fail("Plotly runtime or license differs from the verified local pin");
}
/** Deliberately rejects active elements, hyperlinks, images and nonlocal CSS refs. */
export function verifyStaticSvg(svg: string): void {
  if (
    svg.length > 5_000_000 || !/^<svg\s/.test(svg) || !/<\/svg>\s*$/.test(svg)
  ) fail("invalid or oversized SVG snapshot");
  if (
    /<!|<\?|\bon[a-z]+\s*=|(?:href|src|xml:base)\s*=|@import|\\|&(?!(?:amp|lt|gt|quot|apos);)/i
      .test(svg)
  ) fail("active or external SVG content");
  const tags = new Set(
    "svg g defs clipPath rect path line polyline polygon circle ellipse text tspan title desc"
      .split(" "),
  );
  for (const matched of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g)) {
    if (!tags.has(matched[1])) {
      fail(`SVG element ${matched[1]} is not supported`);
    }
  }
  const attributes = new Set(
    "xmlns xmlns:xlink class id d x y x1 y1 x2 y2 cx cy r rx ry dx dy height width viewBox transform style clip-path text-anchor dominant-baseline fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style vector-effect points"
      .split(" "),
  );
  const properties = new Set(
    "font-family font-size font-weight font-style fill fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity white-space vector-effect display visibility paint-order"
      .split(" "),
  );
  for (const tag of svg.matchAll(/<([A-Za-z][\w:-]*)([^>]*)>/g)) {
    let rest = tag[2].replace(/\/\s*$/, "");
    while (rest.trim()) {
      const attribute = rest.match(/^\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/);
      if (!attribute || !attributes.has(attribute[1])) {
        fail("unsupported SVG attribute syntax");
      }
      const name = attribute[1], value = attribute[2].slice(1, -1);
      if (name === "style") {
        for (
          const declaration of value.split(";").map((v) => v.trim()).filter(
            Boolean,
          )
        ) {
          const colon = declaration.indexOf(":");
          if (
            colon < 0 || !properties.has(declaration.slice(0, colon).trim())
          ) fail("unsupported SVG style property");
          const css = declaration.slice(colon + 1);
          if (
            /[{}@&]/.test(css) ||
            [...css.matchAll(/([\w-]+)\s*\(/g)].some((m) =>
              !["rgb", "rgba", "url"].includes(m[1])
            )
          ) fail("unsupported SVG style function");
        }
      } else if (["fill", "stroke", "clip-path"].includes(name)) {
        if (
          /[{}@&]/.test(value) ||
          [...value.matchAll(/([\w-]+)\s*\(/g)].some((m) =>
            !["rgb", "rgba", "url"].includes(m[1])
          )
        ) fail("unsupported SVG presentation function");
      }
      rest = rest.slice(attribute[0].length);
    }
  }
  for (const matched of svg.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^#[A-Za-z0-9_.:-]+$/.test(matched[1])) {
      fail("SVG CSS reference is not an internal fragment");
    }
  }
}
function verifyCandidate(candidate: PlotlyCandidate) {
  if (
    candidate.version !== 1 || candidate.kind !== "plotly" ||
    candidate.specHash !== hashSource(canonical(candidate.spec))
  ) fail("widget candidate changed after projection");
  const config = structuredClone(candidate.spec.config);
  if (
    config.responsive !== false || config.displaylogo !== false ||
    config.plotGlPixelRatio !== 1 ||
    JSON.stringify(config.modeBarButtonsToRemove) !==
      JSON.stringify(["toImage", "sendDataToCloud"])
  ) fail("widget config changed after projection");
  delete config.responsive;
  delete config.plotGlPixelRatio;
  delete config.modeBarButtonsToRemove;
  const checked = parsePlotlyPayload(
    JSON.stringify({
      x: { data: candidate.spec.data, layout: candidate.spec.layout, config },
      evals: [],
      jsHooks: [],
    }),
  );
  if (canonical(checked) !== canonical(candidate.spec)) {
    fail("widget spec changed after projection");
  }
  if (
    !Number.isInteger(candidate.width) || !Number.isInteger(candidate.height) ||
    candidate.width < 100 || candidate.width > 1600 || candidate.height < 100 ||
    candidate.height > 1600
  ) fail("invalid widget dimensions");
}
export function createPlotlyBundle(
  candidate: PlotlyCandidate,
  svg: string,
): PlotlyBundle {
  verifyCandidate(candidate);
  verifyStaticSvg(svg);
  return {
    version: 1,
    candidate: structuredClone(candidate),
    runtime: PLOTLY_RUNTIME,
    fallback: { mime: "image/svg+xml", svg, sha256: hashSource(svg) },
  };
}
function innerPage(
  candidate: PlotlyCandidate,
  runtime: PlotlyRuntime,
  nonce: string,
  exportSvg: boolean,
) {
  const csp =
    `default-src 'none'; script-src 'nonce-${nonce}' data:; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'`;
  const script = `"use strict";
const spec=${
    json(candidate.spec)
  }, width=${candidate.width}, height=${candidate.height};
window.PlotlyConfig={MathJaxConfig:'local'};
const chart=document.getElementById('chart');
const report=value=>parent.postMessage({qbentoWidget:${
    json(nonce)
  },...value},'*');
const layout={...spec.layout,width,height};
Plotly.newPlot(chart,spec.data,layout,spec.config).then(async()=>{
  if(${exportSvg}){
    const uri=await Plotly.toImage(chart,{format:'svg',width,height});
    if(!uri.startsWith('data:image/svg+xml,'))throw new Error('Expected an SVG data URI');
    report({svg:decodeURIComponent(uri.slice(uri.indexOf(',')+1)),ready:true});
  }else report({ready:true});
}).catch(error=>report({error:String(error)}));`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${
    html(csp)
  }"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#chart{width:${candidate.width}px;height:${candidate.height}px}</style></head><body><div id="chart"></div><script nonce="${nonce}" src="data:text/javascript;base64,${
    encode(runtime.javascript)
  }"></script><script nonce="${nonce}">${script}</script></body></html>`;
}
/** Isolated opaque-origin child; no same-origin, forms, downloads, popups or navigation grants. */
async function page(
  candidate: PlotlyCandidate,
  runtime: PlotlyRuntime,
  bundle?: PlotlyBundle,
): Promise<string> {
  verifyCandidate(candidate);
  await verifyPlotlyRuntime(runtime);
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp =
    `default-src 'none'; script-src 'nonce-${nonce}' data:; style-src 'unsafe-inline'; img-src data:; frame-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'`;
  const child = innerPage(candidate, runtime, nonce, !bundle);
  const fallback = bundle
    ? `<img id="fallback" alt="Gráfico calculado; versión estática" width="${candidate.width}" height="${candidate.height}" src="data:image/svg+xml;base64,${
      encode(bundle.fallback.svg)
    }">`
    : "";
  const controls = bundle
    ? '<button id="activate" disabled>Activar gráfico interactivo</button><p id="status" role="status">Cargando recursos locales…</p>'
    : '<p id="status">Preparando SVG…</p>';
  const script = `"use strict";const iframe=document.getElementById('widget');
const result=document.getElementById('qb-widget-result'),status=document.getElementById('status');
window.addEventListener('message',event=>{
 if(event.source!==iframe.contentWindow||event.origin!=='null'||event.data?.qbentoWidget!==${
    json(nonce)
  })return;
 if(event.data.error){status.textContent='No se pudo representar el widget: '+event.data.error;result.textContent=JSON.stringify({error:event.data.error});return;}
 if(event.data.ready){status.textContent='Listo · recursos incluidos · sin conexión';result.textContent=JSON.stringify({ready:true,svg:event.data.svg});const button=document.getElementById('activate');if(button)button.disabled=false;}
});
const button=document.getElementById('activate');if(button)button.addEventListener('click',()=>{const active=iframe.hidden;iframe.hidden=!active;document.getElementById('fallback').hidden=active;button.textContent=active?'Mostrar versión estática':'Activar gráfico interactivo';});
iframe.srcdoc=${json(child)};`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${
    html(csp)
  }"><title>Plotly · Presenter aislado</title><style>body{margin:24px;font:16px system-ui;background:#f4f6f7;color:#172a35}main{max-width:${candidate.width}px;margin:auto}iframe{border:0;background:white}button{padding:10px 16px}img{display:block}img[hidden],iframe[hidden]{display:none}@media print{body{margin:0}button,#status,details,iframe{display:none!important}#fallback{display:block!important}}details{margin-top:20px}pre{white-space:pre-wrap;font-size:12px}</style></head><body><main>${controls}${fallback}<iframe id="widget" title="Gráfico Plotly aislado" sandbox="allow-scripts" referrerpolicy="no-referrer" width="${candidate.width}" height="${candidate.height}" ${
    bundle ? "hidden" : ""
  }></iframe><script id="qb-widget-result" type="application/json">{}</script><details><summary>Plotly ${PLOTLY_RUNTIME.version} · licencia</summary><pre>${
    html(runtime.license)
  }</pre></details></main><script nonce="${nonce}">${script}</script></body></html>`;
}
export const createPlotlySnapshotPage = (
  candidate: PlotlyCandidate,
  runtime: PlotlyRuntime,
): Promise<string> => page(candidate, runtime);
/** Call only for a newly captured bundle, before its generation is published. */
export function createPlotlyReceipt(bundle: PlotlyBundle): PlotlyReceipt {
  verifyCandidate(bundle.candidate);
  verifyStaticSvg(bundle.fallback.svg);
  if (
    bundle.version !== 1 ||
    bundle.fallback.sha256 !== hashSource(bundle.fallback.svg) ||
    canonical(bundle.runtime) !== canonical(PLOTLY_RUNTIME)
  ) fail("invalid freshly captured widget bundle");
  return {
    version: 1,
    bundleHash: hashSource(canonical(bundle)),
    source: structuredClone(bundle.candidate.source),
    specHash: bundle.candidate.specHash,
    runtimeSha256: PLOTLY_RUNTIME.sha256,
  };
}
/** Validate against current QMD and a receipt obtained from the trusted core generation. */
function verifyBundleContext(
  bundle: PlotlyBundle,
  context: PlotlyContext,
): void {
  const receipt = createPlotlyReceipt(bundle);
  if (canonical(receipt) !== canonical(context.expectedReceipt)) {
    fail("bundle does not match the expected generation receipt");
  }
  const original = context.source;
  if (
    hashSource(original.text) !== original.hash ||
    original.hash !== receipt.source.sourceHash
  ) fail("widget source snapshot is stale");
  const source = scanSource(original.text);
  if (source.diagnostics.length) {
    fail("source mapping diagnostics must be resolved first");
  }
  const wrapper = source.blocks.find((b) =>
    b.id === receipt.source.sourceId && b.kind === "div" && b.stable
  );
  const children = wrapper
    ? source.blocks.filter((b) => b.parentId === wrapper.id)
    : [];
  if (
    children.length !== 1 || children[0].kind !== "chunk" ||
    !children[0].stable || children[0].id !== receipt.source.producerId ||
    children[0].slideId !== receipt.source.slideId ||
    hashSource(children[0].raw) !== receipt.source.chunkHash
  ) fail("widget producer no longer matches original source");
  if (/results\s*[:=]\s*["']?asis|asis_output\s*\(/i.test(children[0].raw)) {
    fail("unsupported asis producer");
  }
}
/** Loading untrusted persisted JSON always requires both fresh QMD and an external receipt. */
export async function loadPlotlyBundle(
  serialized: string,
  options: PlotlyContext & { runtime: PlotlyRuntime },
): Promise<PlotlyBundle> {
  if (serialized.length > 8_000_000) fail("widget bundle exceeds 8 MB");
  let bundle: PlotlyBundle;
  try {
    bundle = JSON.parse(serialized);
    verifyBundleContext(bundle, options);
  } catch (error) {
    if (
      error instanceof Error && error.message.startsWith("UNSUPPORTED_WIDGET:")
    ) throw error;
    fail("malformed widget bundle or context");
  }
  await verifyPlotlyRuntime(options.runtime);
  return bundle!;
}
export function createPlotlyPresenter(
  bundle: PlotlyBundle,
  runtime: PlotlyRuntime,
  context: PlotlyContext,
): Promise<string> {
  verifyBundleContext(bundle, context);
  if (
    bundle.version !== 1 || bundle.runtime.sha256 !== PLOTLY_RUNTIME.sha256 ||
    bundle.fallback.sha256 !== hashSource(bundle.fallback.svg)
  ) fail("widget bundle integrity mismatch");
  verifyStaticSvg(bundle.fallback.svg);
  return page(bundle.candidate, runtime, bundle);
}

/** Integration boundary: only the checked static image enters pure-data BentoDoc. */
export function plotlyStaticElement(
  bundle: PlotlyBundle,
  context: PlotlyContext,
): { element: Element; origin: Origin } {
  verifyBundleContext(bundle, context);
  if (bundle.fallback.sha256 !== hashSource(bundle.fallback.svg)) {
    fail("widget fallback changed");
  }
  verifyCandidate(bundle.candidate);
  verifyStaticSvg(bundle.fallback.svg);
  const c = bundle.candidate;
  return {
    element: {
      id: c.source.sourceId,
      type: "image",
      x: 160,
      y: 130,
      w: 880,
      h: Math.min(480, c.height),
      rotation: 0,
      opacity: 1,
      src: `data:image/svg+xml;base64,${encode(bundle.fallback.svg)}`,
      fit: "contain",
    },
    origin: {
      origin: "computed",
      sourceId: c.source.sourceId,
      producer: c.source.producerId,
    },
  };
}
