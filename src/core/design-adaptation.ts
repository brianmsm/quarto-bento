/** Optional, offline, one-time sampling of explicitly selected Reveal styles. */
import { withHeadlessChromium } from "../browser/chromium.ts";
import {
  DesignError,
  validateDesignDefaults,
  validateDesignValue,
} from "../render/design.ts";
import { sha256 } from "../state/store.ts";
import { type DesignPackage, validateDesignPackage } from "./design-package.ts";

export const MAX_REVEAL_REFERENCE_BYTES = 16 * 1024 * 1024;
interface NamedSample {
  selector: string;
  target: "text" | "code" | "card";
}
interface VariantSample {
  selector: string;
  title?: string;
  titleFrame?: unknown;
  contentFrame?: unknown;
  decorations?: unknown;
}
export interface RevealDesignMapping {
  version: 1;
  name: string;
  canvas: string;
  title: string;
  body: string;
  accent?: string;
  fontFallback?: string;
  code?: string;
  namedStyles?: Record<string, NamedSample>;
  variants?: Record<string, VariantSample>;
  defaultVariant?: string;
}
export interface DesignAdaptationReport {
  version: 1;
  sourceSha256: string;
  chromium: string;
  viewport: { width: 1280; height: 720 };
  samples: {
    name: string;
    selector: string;
    properties: Record<string, string | number>;
  }[];
  excluded: {
    scripts: number;
    externalStylesheets: number;
    inlinedDataStylesheets: number;
    cssImports: number;
    activeElements: number;
    resourceReferences: number;
  };
  warnings: string[];
  fonts: { family: string; embeddedInPackage: false }[];
}
function invalid(message: string): never {
  throw new DesignError("INVALID_REVEAL_DESIGN_MAPPING", message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Expected an object.");
  }
}
const safeName = /^[a-z][a-z0-9-]{0,63}$/;
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid("Unexpected mapping field.");
  }
}
function selector(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) {
    invalid("Selectors must be nonempty strings of at most 1024 characters.");
  }
}
export function validateRevealDesignMapping(
  value: unknown,
): RevealDesignMapping {
  object(value);
  keys(value, [
    "version",
    "name",
    "canvas",
    "title",
    "body",
    "accent",
    "fontFallback",
    "code",
    "namedStyles",
    "variants",
    "defaultVariant",
  ]);
  if (
    value.version !== 1 || typeof value.name !== "string" ||
    !safeName.test(value.name)
  ) invalid("Expected version 1 and a safe design name.");
  for (const name of ["canvas", "title", "body"]) selector(value[name]);
  if (value.code !== undefined) selector(value.code);
  if (value.accent !== undefined) {
    if (typeof value.accent !== "string") {
      invalid("accent must be a literal color.");
    }
    validateDesignValue("color", value.accent);
  }
  if (value.fontFallback !== undefined) {
    if (typeof value.fontFallback !== "string") {
      invalid("fontFallback must be a plain font stack.");
    }
    validateDesignValue("fontFamily", value.fontFallback);
  }
  if (value.namedStyles !== undefined) {
    object(value.namedStyles);
    if (Object.keys(value.namedStyles).length > 64) {
      invalid("At most 64 named styles.");
    }
    for (const [name, sample] of Object.entries(value.namedStyles)) {
      if (!safeName.test(name)) invalid("Unsafe named style name.");
      object(sample);
      keys(sample, ["selector", "target"]);
      selector(sample.selector);
      if (!["text", "code", "card"].includes(String(sample.target))) {
        invalid("Unknown named style target.");
      }
    }
  }
  if (value.variants !== undefined) {
    object(value.variants);
    if (Object.keys(value.variants).length > 32) {
      invalid("At most 32 variants.");
    }
    for (const [name, sample] of Object.entries(value.variants)) {
      if (!safeName.test(name)) invalid("Unsafe variant name.");
      object(sample);
      keys(sample, [
        "selector",
        "title",
        "titleFrame",
        "contentFrame",
        "decorations",
      ]);
      selector(sample.selector);
      if (sample.title !== undefined) selector(sample.title);
      for (const frame of [sample.titleFrame, sample.contentFrame]) {
        if (frame !== undefined) {
          validateDesignDefaults({ frame: frame as never });
        }
      }
    }
  }
  if (
    value.defaultVariant !== undefined &&
    (typeof value.defaultVariant !== "string" ||
      !Object.hasOwn(value.variants ?? {}, value.defaultVariant))
  ) invalid("defaultVariant must name a mapped variant.");
  // The final package validator checks supplied decorations and all theme fields.
  return structuredClone(value) as unknown as RevealDesignMapping;
}
/** Bounded UTF-8 reference input; directories, symlinks and changing inode are refused. */
export async function readRevealReferenceFile(path: string): Promise<string> {
  const before = await Deno.lstat(path);
  if (
    !before.isFile || before.isSymlink ||
    before.size > MAX_REVEAL_REFERENCE_BYTES
  ) {
    throw new DesignError(
      "UNSAFE_REVEAL_REFERENCE",
      "Expected a regular HTML file of at most 16 MiB.",
    );
  }
  const file = await Deno.open(path, { read: true });
  try {
    const opened = await file.stat();
    if (
      !opened.isFile || opened.ino !== before.ino ||
      opened.dev !== before.dev || opened.size > MAX_REVEAL_REFERENCE_BYTES
    ) {
      throw new DesignError(
        "UNSAFE_REVEAL_REFERENCE",
        "Reference changed while opening.",
      );
    }
    const bytes = new Uint8Array(MAX_REVEAL_REFERENCE_BYTES + 1);
    let size = 0;
    for (;;) {
      const read = await file.read(bytes.subarray(size));
      if (read === null) break;
      size += read;
      if (size > MAX_REVEAL_REFERENCE_BYTES) {
        throw new DesignError(
          "UNSAFE_REVEAL_REFERENCE",
          "Reference exceeds 16 MiB.",
        );
      }
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, size),
      );
    } catch {
      throw new DesignError(
        "INVALID_REVEAL_REFERENCE",
        "Reference must be UTF-8 HTML.",
      );
    }
  } finally {
    file.close();
  }
}

// This function is evaluated only in an isolated Chromium document. It deliberately
// uses a JavaScript string: source HTML never becomes executable program text.
const sampler = String.raw`async (html, mapping) => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const excluded = {scripts: parsed.querySelectorAll('script').length,
    externalStylesheets: 0, inlinedDataStylesheets: 0,
    cssImports: 0, activeElements: 0, resourceReferences: 0};
  const warnings = ['Only inline CSS, embedded data:text/css stylesheets and style attributes are sampled. External stylesheets, scripts, images and frames are excluded.',
    'No slide layout, semantic content or QMD conversion is performed. Explicit template geometry must be reviewed in native Bento.',
    'Fonts are not embedded in the design package; the sampled family must be available on each machine. Font metrics may differ.',
    'Reveal JavaScript is disabled. The canvas is normalized to 1280 by 720; responsive, runtime and presentation-state styles may differ.'];
  // Quarto embed-resources writes stylesheets as data:text/css links. Decode
  // those bytes locally and replace the node in place, preserving cascade order.
  // Never ask the browser to load the data URL or any referenced CSS imports.
  let cssBytes = [...parsed.querySelectorAll('style')].reduce((n,el)=>n+new TextEncoder().encode(el.textContent).length,0);
  cssBytes += [...parsed.querySelectorAll('[style]')].reduce((n,el)=>n+new TextEncoder().encode(el.getAttribute('style')).length,0);
  for(const link of parsed.querySelectorAll('link[rel~="stylesheet"]')) {
    const href=(link.getAttribute('href')||'').trim();
    if(!/^data:/i.test(href)){excluded.externalStylesheets++;continue;}
    const match=href.match(/^data:text\/css(?:;charset=(utf-8|us-ascii))?(;base64)?,([\s\S]*)$/i);
    if(!match)throw new Error('INVALID_EMBEDDED_REVEAL_CSS: expected UTF-8 text/css data URL');
    let css;
    try {
      if(match[2]){
        if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[3]))throw new Error('Malformed base64');
        const bytes=Uint8Array.from(atob(match[3]),c=>c.charCodeAt(0));
        if(match[1]?.toLowerCase()==='us-ascii' && bytes.some(byte=>byte>127))throw new Error('Non-ASCII data');
        css=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      } else {
        css=decodeURIComponent(match[3]);
        if(match[1]?.toLowerCase()==='us-ascii' && /[^\x00-\x7f]/.test(css))throw new Error('Non-ASCII data');
      }
    } catch {throw new Error('INVALID_EMBEDDED_REVEAL_CSS: invalid percent/base64 encoding or UTF-8');}
    cssBytes+=new TextEncoder().encode(css).length;
    if(cssBytes>16777216)throw new Error('REVEAL_CSS_TOO_LARGE: decoded CSS exceeds 16 MiB');
    const style=parsed.createElement('style');style.textContent=css;
    if(link.hasAttribute('media'))style.setAttribute('media',link.getAttribute('media'));
    if(link.hasAttribute('disabled'))style.setAttribute('media','not all');
    link.replaceWith(style);excluded.inlinedDataStylesheets++;
  }
  if(cssBytes>16777216)throw new Error('REVEAL_CSS_TOO_LARGE: decoded CSS exceeds 16 MiB');
  excluded.cssImports = [...parsed.querySelectorAll('style')].reduce((n, el) => n + (el.textContent.match(/@import\b/gi) || []).length, 0);
  for (const el of parsed.querySelectorAll('script,base,meta,link,iframe,frame,frameset,object,embed,img,picture,source,video,audio,track,input,button,select,textarea,form,template,svg,math')) {
    excluded.activeElements++; el.remove();
  }
  for (const el of parsed.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^(?:on|src|href|action|formaction|poster|data$|background$|ping$)/i.test(attr.name) || attr.name === 'is' || attr.name === 'srcdoc') {
        excluded.resourceReferences++; el.removeAttribute(attr.name);
      }
    }
  }
  // Adopt sanitized nodes into the existing CSP document; never replace its head.
  for (const [source, target] of [[parsed.documentElement, document.documentElement], [parsed.body, document.body]]) {
    for (const attr of [...source.attributes]) {
      if (/^(?:id|class|lang|dir|style|role|title|data-[\w-]+|aria-[\w-]+)$/.test(attr.name)) {
        target.setAttribute(attr.name, attr.value);
      }
    }
  }
  for (const el of parsed.head.querySelectorAll('style')) document.head.appendChild(document.importNode(el, true));
  document.body.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)));
  const normalize = document.createElement('style');
  normalize.textContent = 'html,body{margin:0!important;width:1280px!important;height:720px!important}.reveal{width:1280px!important;height:720px!important}.reveal .slides{width:1280px!important;height:720px!important;transform:none!important;inset:0!important}*,*::before,*::after{animation:none!important;transition:none!important}';
  document.head.appendChild(normalize);
  await document.fonts.ready;
  const samples = [], fonts = new Set();
  const one = (selector) => {
    let nodes; try { nodes = document.querySelectorAll(selector); } catch { throw new Error('INVALID_REVEAL_SELECTOR: ' + selector); }
    if (nodes.length !== 1) throw new Error((nodes.length ? 'AMBIGUOUS_REVEAL_SELECTOR: ' : 'MISSING_REVEAL_SELECTOR: ') + selector + ' matched ' + nodes.length + ' elements');
    return nodes[0];
  };
  const rgba = value => {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    if (!match) throw new Error('UNSUPPORTED_REVEAL_COLOR: ' + value);
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(v => !Number.isFinite(v))) throw new Error('UNSUPPORTED_REVEAL_COLOR: ' + value);
    return [parts[0],parts[1],parts[2],parts.length > 3 ? parts[3] : 1];
  };
  const hex = parts => '#' + parts.map((v,i) => Math.max(0,Math.min(255,Math.round(i === 3 ? v*255 : v))).toString(16).padStart(2,'0')).join('');
  const color = value => { const parts = rgba(value); return hex(parts[3] === 1 ? parts.slice(0,3) : parts); };
  const background = el => {
    const layers=[];
    for(let node=el;node;node=node.parentElement){const css=getComputedStyle(node);layers.push(rgba(css.backgroundColor));if(css.backgroundImage !== 'none')warnings.push('Background image/gradient omitted for ' + node.tagName);}
    let out=[255,255,255];
    for(const layer of layers.reverse())out=out.map((v,i)=>layer[i]*layer[3]+v*(1-layer[3]));
    return hex(out);
  };
  const px = value => { if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(value))throw new Error('UNSUPPORTED_REVEAL_LENGTH: '+value);return parseFloat(value); };
  const text = (el,target) => {
    const css=getComputedStyle(el), props={fontSize:px(css.fontSize),fontFamily:css.fontFamily.replace(/["']/g,''),color:color(css.color)};
    if(mapping.fontFallback && !/(?:^|,)\s*(?:sans-serif|serif|monospace|system-ui|cursive|fantasy)\s*(?:,|$)/i.test(props.fontFamily)){
      props.fontFamily += ', ' + mapping.fontFallback;
      warnings.push('Explicit fallback font stack appended: '+mapping.fontFallback+'. Requested fonts are not installed or embedded by adaptation.');
    }
    fonts.add(props.fontFamily);
    if(css.lineHeight !== 'normal')props.lineHeight=px(css.lineHeight)/props.fontSize;
    else warnings.push('Normal line-height omitted for '+el.tagName+'; Bento default requires visual review.');
    const align=css.textAlign === 'start' ? (css.direction === 'rtl'?'right':'left') : css.textAlign === 'end' ? (css.direction === 'rtl'?'left':'right') : css.textAlign;
    if(['left','center','right'].includes(align))props.align=align;
    else warnings.push('Unsupported text alignment omitted: '+align);
    if(target !== 'code'){props.fontWeight=Number(css.fontWeight);props.letterSpacing=css.letterSpacing==='normal'?0:px(css.letterSpacing);}
    if(target === 'card'){
      props.fill=color(css.backgroundColor);props.opacity=Number(css.opacity);
      const widths=[css.borderTopWidth,css.borderRightWidth,css.borderBottomWidth,css.borderLeftWidth];
      const colors=[css.borderTopColor,css.borderRightColor,css.borderBottomColor,css.borderLeftColor];
      if(new Set(widths).size===1 && new Set(colors).size===1){props.strokeWidth=px(widths[0]);props.stroke=color(colors[0]);}
      else warnings.push('Asymmetric card border omitted; review native style.');
      const radii=[css.borderTopLeftRadius,css.borderTopRightRadius,css.borderBottomLeftRadius,css.borderBottomRightRadius];
      if(new Set(radii).size===1 && /^\d+(?:\.\d+)?px$/.test(radii[0]))props.radius=px(radii[0]);
      else warnings.push('Nonuniform/relative card radius omitted; review native style.');
      if(css.boxShadow !== 'none')warnings.push('Card box shadow omitted; unsupported by the bounded design style.');
    }
    return props;
  };
  const sample = (name,selector,target) => {const props=text(one(selector),target);samples.push({name,selector,properties:props});return props;};
  const canvas=one(mapping.canvas), title=sample('title',mapping.title,'text'), body=sample('body',mapping.body,'text');
  const theme={background:background(canvas),color:body.color,accent:mapping.accent || title.color,fontFamily:body.fontFamily,styles:{title,body}};
  samples.push({name:'canvas',selector:mapping.canvas,properties:{background:theme.background}});
  if(!mapping.accent)warnings.push('Accent was not supplied; selected title color was used.');
  if(mapping.code)theme.styles.code=sample('code',mapping.code,'code');
  if(mapping.namedStyles){theme.namedStyles={};for(const [name,row]of Object.entries(mapping.namedStyles))theme.namedStyles[name]={target:row.target,properties:sample(name,row.selector,row.target)};}
  if(mapping.variants){theme.variants={};for(const [name,row]of Object.entries(mapping.variants)){
    const props={background:background(one(row.selector))};samples.push({name:'variant:'+name,selector:row.selector,properties:{background:props.background}});
    if(row.title)props.title=sample('variant-title:'+name,row.title,'text');
    for(const key of ['titleFrame','contentFrame','decorations'])if(row[key]!==undefined)props[key]=row[key];
    theme.variants[name]=props;
  }}
  if(mapping.defaultVariant)theme.defaultVariant=mapping.defaultVariant;
  return {theme,samples,excluded,warnings:[...new Set(warnings)],fonts:[...fonts].map(family=>({family,embeddedInPackage:false}))};
}`;

export async function adaptRevealDesign(
  html: string,
  mapping: unknown,
): Promise<{ package: DesignPackage; report: DesignAdaptationReport }> {
  const checked = validateRevealDesignMapping(mapping);
  if (typeof html !== "string") {
    throw new DesignError(
      "INVALID_REVEAL_REFERENCE",
      "Reference HTML must be a string.",
    );
  }
  if (new TextEncoder().encode(html).length > MAX_REVEAL_REFERENCE_BYTES) {
    throw new DesignError(
      "REVEAL_REFERENCE_TOO_LARGE",
      "Reference exceeds 16 MiB.",
    );
  }
  return await withHeadlessChromium({}, async (browser) => {
    await browser.send("Network.enable");
    await browser.send("Network.setBlockedURLs", { urls: ["*"] });
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html:
        "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\"></head><body></body></html>",
    });
    const result = await browser.send<
      {
        result: {
          value?:
            & { theme: unknown }
            & Omit<
              DesignAdaptationReport,
              "version" | "sourceSha256" | "chromium" | "viewport"
            >;
        };
        exceptionDetails?: {
          exception?: { description?: string };
          text?: string;
        };
      }
    >("Runtime.evaluate", {
      expression: `(${sampler})(${JSON.stringify(html)},${
        JSON.stringify(checked)
      })`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails || !result.result?.value) {
      throw new DesignError(
        "REVEAL_ADAPTATION_FAILED",
        result.exceptionDetails?.exception?.description ??
          result.exceptionDetails?.text ?? "Style sampling failed.",
      );
    }
    const { theme, ...sampled } = result.result.value;
    const pkg = validateDesignPackage({
      format: "qbento/design",
      version: 1,
      name: checked.name,
      registry: {
        schemaVersion: 1,
        themes: { [checked.name]: theme },
        activeTheme: checked.name,
      },
    });
    return {
      package: pkg,
      report: {
        version: 1,
        sourceSha256: await sha256(html),
        chromium: browser.version,
        viewport: { width: 1280, height: 720 },
        ...sampled,
      },
    };
  });
}
