import { producerOutputChildren } from "../render/producer-capture.ts";
import { readExternalWidgetFile } from "./external-reader.ts";
import { resolve } from "node:path";
import { originalThemeAttributes } from "../render/theme-styles.ts";
import { canonical } from "../state/json.ts";
/** Bounded, data-only adapter for executed R Plotly htmlwidgets. */
import { hashSource, scanSource, type SourceDocument } from "../source/mod.ts";
import type { Ast, Node } from "../render/types.ts";

type ObjectValue = Record<string, unknown>;
export interface PlotlyCandidate {
  version: 1;
  kind: "plotly";
  source: {
    sourceHash: string;
    sourceId: string;
    producerId: string;
    slideId: string;
    chunkHash: string;
    outputHash: string;
    external?: { path: string; sha256: string };
  };
  spec: { data: ObjectValue[]; layout: ObjectValue; config: ObjectValue };
  specHash: string;
  width: number;
  height: number;
}
export interface PlotlyCamera {
  eye?: { x?: number; y?: number; z?: number };
  center?: { x?: number; y?: number; z?: number };
  up?: { x?: number; y?: number; z?: number };
  projection?: { type: "perspective" | "orthographic" };
}
/** Explicit visual camera state, never arbitrary Plotly relayout properties. */
export function parsePlotlyCamera(value: unknown): PlotlyCamera {
  const camera = object(value, "scene.camera");
  keys(camera, "eye center up projection", "scene.camera");
  if (!Object.keys(camera).length) fail("camera must not be empty");
  for (const key of ["eye", "center", "up"]) {
    if (camera[key] === undefined) continue;
    const vector = object(camera[key], `camera.${key}`);
    keys(vector, "x y z", `camera.${key}`);
    if (
      !Object.keys(vector).length ||
      Object.values(vector).some((n) =>
        typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10000
      )
    ) fail("camera vectors require bounded finite coordinates");
  }
  if (camera.projection !== undefined) {
    const projection = object(camera.projection, "camera.projection");
    keys(projection, "type", "camera.projection");
    if (
      projection.type !== "perspective" && projection.type !== "orthographic"
    ) {
      fail("unsupported camera projection");
    }
  }
  return structuredClone(camera) as PlotlyCamera;
}
export function applyPlotlyCamera(
  candidate: PlotlyCandidate,
  value: unknown,
): PlotlyCandidate {
  if (!candidate.spec.data.some((trace) => trace.type === "scatter3d")) {
    fail("camera requires scatter3d");
  }
  const camera = parsePlotlyCamera(value), result = structuredClone(candidate);
  result.spec.layout.scene = {
    ...(result.spec.layout.scene as ObjectValue | undefined),
    camera,
  };
  result.specHash = hashSource(canonical(result.spec));
  return result;
}
export function fail(message: string): never {
  throw new Error(`UNSUPPORTED_WIDGET: ${message}`);
}
function object(value: unknown, label: string): ObjectValue {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    fail(`${label} must be an object`);
  }
  return value as ObjectValue;
}
function keys(value: ObjectValue, allowed: string, label: string) {
  const set = new Set(allowed.split(" "));
  for (const key of Object.keys(value)) {
    if (!set.has(key)) fail(`${label}.${key} has no verified adapter`);
  }
}
function finiteTree(value: unknown, depth = 0): void {
  if (depth > 24) fail("payload nesting exceeds 24 levels");
  if (typeof value === "string") {
    if (
      value.length > 100_000 ||
      [...value].some((c) => c.charCodeAt(0) < 32 && !"\t\n\r".includes(c))
    ) {
      fail("invalid or oversized string");
    }
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("non-finite number");
  } else if (Array.isArray(value)) {
    if (value.length > 10_000) fail("array exceeds 10000 items");
    for (const item of value) finiteTree(item, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        fail("unsafe object key");
      }
      finiteTree(item, depth + 1);
    }
  } else if (value !== null && typeof value !== "boolean") {
    fail("non-JSON value");
  }
}
function plainText(value: unknown, label: string) {
  if (typeof value !== "string" || /[<>$]/.test(value)) {
    fail(`${label} requires plain text (HTML and MathJax are not bundled)`);
  }
}
function labelText(value: unknown, label: string) {
  if (typeof value !== "string") fail(`${label} requires text`);
  plainText(
    (value as string).replace(
      /<\/?(?:b|i|em|strong|sup|sub|extra)>|<br\s*\/?>/gi,
      "",
    ),
    label,
  );
}
function font(value: unknown) {
  const v = object(value, "font");
  keys(v, "family size color", "font");
  if (v.family !== undefined) plainText(v.family, "font.family");
}
function title(value: unknown) {
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === "string") return labelText(value, "title");
  const v = object(value, "title");
  keys(
    v,
    "text font standoff x y xanchor yanchor xref yref pad automargin",
    "title",
  );
  if (v.text !== undefined) labelText(v.text, "title.text");
  if (v.font) font(v.font);
}
function axis(value: unknown) {
  const v = object(value, "axis");
  keys(
    v,
    "title domain range autorange automargin type tickmode tickvals ticktext dtick tick0 ticks tickformat tickangle tickfont showgrid gridcolor gridwidth zeroline zerolinecolor zerolinewidth showline linecolor linewidth mirror fixedrange side anchor rangemode exponentformat showexponent categoryorder categoryarray visible",
    "axis",
  );
  if (v.title !== undefined) title(v.title);
  if (v.tickfont) font(v.tickfont);
  for (const key of ["ticktext", "categoryarray"]) {
    if (v[key] !== undefined) {
      if (!Array.isArray(v[key])) fail(`axis.${key} must be an array`);
      for (const text of v[key] as unknown[]) plainText(text, `axis.${key}`);
    }
  }
}
function trace(value: unknown): ObjectValue {
  const v = object(value, "trace");
  keys(
    v,
    "type x y z mode name marker line error_x error_y error_z xaxis yaxis scene frame text textposition textfont hovertext hoverinfo hovertemplate opacity visible showlegend legendgroup orientation width base offset fill fillcolor connectgaps cliponaxis",
    "trace",
  );
  if (!["scatter", "bar", "scatter3d"].includes(v.type as string)) {
    fail("only scatter, bar and scatter3d traces are supported");
  }
  if (v.frame !== undefined && v.frame !== null) {
    fail("animated frames need a separate adapter");
  }
  if (
    v.xaxis !== undefined && v.xaxis !== "x" ||
    v.yaxis !== undefined && v.yaxis !== "y"
  ) fail("multiple axes are not yet supported");
  if (
    !Array.isArray(v.x) || !Array.isArray(v.y) || v.x.length !== v.y.length ||
    !v.x.length
  ) fail("x and y must be equal nonempty arrays");
  if (v.type === "scatter3d") {
    if (
      !Array.isArray(v.z) || v.z.length !== v.x.length ||
      (v.scene !== undefined && v.scene !== "scene")
    ) fail("scatter3d requires matching z values and one scene");
    if (
      v.mode !== undefined &&
      ![
        "markers",
        "lines",
        "lines+markers",
        "text",
        "markers+text",
        "lines+text",
        "lines+markers+text",
      ].includes(String(v.mode))
    ) fail("unsupported scatter3d mode");
  } else if (
    v.z !== undefined || v.scene !== undefined || v.error_z !== undefined
  ) fail("3D fields require scatter3d");
  for (const key of v.type === "scatter3d" ? ["x", "y", "z"] : ["x", "y"]) {
    for (const item of v[key] as unknown[]) {
      if (typeof item === "string") labelText(item, key);
      else if (typeof item !== "number" && item !== null) {
        fail(`${key} values must be numeric, plain strings or null`);
      }
    }
  }
  for (const key of ["name", "text", "hovertext", "hovertemplate"]) {
    if (v[key] !== undefined) {
      for (
        const item of Array.isArray(v[key]) ? v[key] as unknown[] : [v[key]]
      ) labelText(item, key);
    }
  }
  if (v.textfont) font(v.textfont);
  if (v.line) {
    keys(
      object(v.line, "line"),
      "color width dash shape smoothing simplify",
      "line",
    );
  }
  if (v.marker) {
    const m = object(v.marker, "marker");
    keys(m, "color size symbol opacity line", "marker");
    if (m.line) {
      keys(object(m.line, "marker.line"), "color width", "marker.line");
    }
  }
  for (const key of ["error_x", "error_y", "error_z"]) {
    if (v[key]) {
      keys(
        object(v[key], key),
        "type array arrayminus symmetric value valueminus visible color thickness width",
        key,
      );
    }
  }
  const result = structuredClone(v);
  delete result.frame; // R Plotly's null frame marker is not a Plotly.js trace property.
  return result;
}
/** Does not evaluate htmlwidgets evals/hooks or reuse their executable binding. */
export function parsePlotlyPayload(payload: string): PlotlyCandidate["spec"] {
  if (payload.length > 2_000_000) fail("payload exceeds 2 MB");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    fail("malformed widget JSON");
  }
  finiteTree(parsed);
  const root = object(parsed, "htmlwidget");
  keys(root, "x evals jsHooks", "htmlwidget");
  for (const key of ["evals", "jsHooks"]) {
    if (!Array.isArray(root[key]) || root[key].length !== 0) {
      fail(`${key} must be empty`);
    }
  }
  const x = object(root.x, "plotly");
  keys(
    x,
    "visdat cur_data attrs layout source config data highlight shinyEvents base_url",
    "plotly",
  );
  if (!Array.isArray(x.data) || !x.data.length || x.data.length > 32) {
    fail("requires 1 to 32 traces");
  }
  const data = x.data.map(trace);
  const layout = structuredClone(object(x.layout, "layout"));
  keys(
    layout,
    "title xaxis yaxis scene margin hovermode hoverlabel showlegend legend font paper_bgcolor plot_bgcolor barmode bargap bargroupgap dragmode width height",
    "layout",
  );
  if (layout.title !== undefined) title(layout.title);
  for (const key of ["xaxis", "yaxis"]) {
    if (layout[key]) {
      axis(layout[key]);
      const a = layout[key] as ObjectValue;
      if (Array.isArray(a.title) && a.title.length === 0) delete a.title;
    }
  }
  if (layout.scene) {
    if (!data.some((trace) => trace.type === "scatter3d")) {
      fail("scene requires scatter3d data");
    }
    const scene = object(layout.scene, "scene");
    keys(
      scene,
      "xaxis yaxis zaxis camera aspectmode aspectratio bgcolor dragmode domain uirevision",
      "scene",
    );
    for (const key of ["xaxis", "yaxis", "zaxis"]) {
      if (scene[key]) axis(scene[key]);
    }
    if (
      scene.aspectmode !== undefined &&
      !["auto", "cube", "data", "manual"].includes(String(scene.aspectmode))
    ) fail("unsupported scene aspect mode");
    const vector = (value: unknown) => {
      const v = object(value, "scene vector");
      keys(v, "x y z", "scene vector");
      if (
        Object.values(v).some((n) =>
          typeof n !== "number" || !Number.isFinite(n)
        )
      ) fail("scene vectors require finite numbers");
    };
    if (scene.aspectratio) vector(scene.aspectratio);
    if (scene.domain) {
      keys(object(scene.domain, "scene.domain"), "x y", "scene.domain");
    }
    if (scene.camera !== undefined) parsePlotlyCamera(scene.camera);
  }
  if (layout.hoverlabel) {
    const label = object(layout.hoverlabel, "hoverlabel");
    keys(label, "align bgcolor bordercolor font namelength", "hoverlabel");
    if (label.font) font(label.font);
  }
  for (const key of ["width", "height"]) {
    if (
      layout[key] !== undefined &&
      (typeof layout[key] !== "number" || Number(layout[key]) < 100 ||
        Number(layout[key]) > 1600)
    ) fail("invalid layout dimensions");
  }
  if (layout.font) font(layout.font);
  if (layout.margin) {
    keys(object(layout.margin, "margin"), "l r b t pad autoexpand", "margin");
  }
  if (layout.legend) {
    keys(
      object(layout.legend, "legend"),
      "x y xanchor yanchor orientation bgcolor bordercolor borderwidth font traceorder",
      "legend",
    );
  }
  const config = structuredClone(object(x.config, "config"));
  keys(
    config,
    "modeBarButtonsToAdd showSendToCloud displayModeBar displaylogo scrollZoom doubleClick toImageButtonOptions",
    "config",
  );
  if (config.toImageButtonOptions) {
    keys(
      object(config.toImageButtonOptions, "toImageButtonOptions"),
      "format filename width height scale",
      "toImageButtonOptions",
    );
    delete config.toImageButtonOptions;
  }
  if (config.showSendToCloud !== false) fail("cloud links must be disabled");
  if (
    config.modeBarButtonsToAdd !== undefined &&
    (!Array.isArray(config.modeBarButtonsToAdd) ||
      config.modeBarButtonsToAdd.some((v) =>
        !["hoverclosest", "hovercompare"].includes(v)
      ))
  ) fail("unsupported modebar buttons");
  if (x.highlight) {
    const h = object(x.highlight, "highlight");
    keys(
      h,
      "on persistent dynamic selectize opacityDim selected debounce",
      "highlight",
    );
    if (
      h.on !== "plotly_click" || h.persistent !== false ||
      h.dynamic !== false || h.selectize !== false || h.debounce !== 0
    ) fail("custom htmlwidgets highlighting is not supported");
  }
  // No Shiny/crosstalk binding is attached. Trace keys/customdata are refused above.
  config.displaylogo = false;
  config.responsive = false;
  config.showSendToCloud = false;
  config.modeBarButtonsToRemove = ["toImage", "sendDataToCloud"];
  config.plotGlPixelRatio = 1;
  return { data, layout, config };
}

/** Recover a producer from one ORIGINAL identified wrapper and its only chunk. */
export function collectPlotlyCandidates(
  ast: Ast,
  source: SourceDocument,
): PlotlyCandidate[] {
  if (hashSource(source.text) !== source.hash) fail("source snapshot is stale");
  source = scanSource(source.text);
  if (source.diagnostics.length) {
    fail("source mapping diagnostics must be resolved first");
  }
  const ids = new Map<string, Node[]>();
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.t === "Div") {
        const [attrs, children] = node.c as [
          [string, string[], unknown[]],
          Node[],
        ];
        if (attrs[0]) ids.set(attrs[0], [...ids.get(attrs[0]) ?? [], node]);
        visit(children);
      }
    }
  };
  visit(ast.blocks);
  const result: PlotlyCandidate[] = [];
  for (
    const wrapper of source.blocks.filter((b) => b.kind === "div" && b.stable)
  ) {
    const nodes = ids.get(wrapper.id) ?? [];
    if (!nodes.some((n) => JSON.stringify(n).includes("plotly html-widget"))) {
      continue;
    }
    if (nodes.length !== 1) fail(`ambiguous executed wrapper ${wrapper.id}`);
    const children = source.blocks.filter((b) => b.parentId === wrapper.id);
    if (children.length && children.every((child) => child.kind === "div")) {
      continue;
    }
    if (
      children.length !== 1 || children[0].kind !== "chunk" ||
      !children[0].stable || !children[0].slideId
    ) {
      fail(
        `wrapper ${wrapper.id} must contain exactly one labeled original executable chunk`,
      );
    }
    const chunk = children[0];
    if (/results\s*[:=]\s*["']?asis|asis_output\s*\(/i.test(chunk.raw)) {
      fail("explicit asis output cannot establish widget provenance");
    }
    const current = producerOutputChildren(
      ast,
      (nodes[0].c as [unknown, Node[]])[1],
      source.hash,
      chunk.id,
    );
    const outputs: string[] = [];
    const visitOutput = (nodes: Node[]) => {
      for (const node of nodes) {
        if (node.t === "Div") visitOutput((node.c as [unknown, Node[]])[1]);
        else if (node.t === "RawBlock") {
          const [format, html] = node.c as [string, string];
          if (format === "html" && html.includes("plotly html-widget")) {
            outputs.push(html);
          }
        }
      }
    };
    visitOutput(current);
    if (outputs.length !== 1) {
      fail(
        "one Plotly display output is required per identified producer wrapper",
      );
    }
    const html = outputs[0];
    const matched = html.match(
      /^<div class="plotly html-widget html-fill-item" id="(htmlwidget-[a-f0-9]+)" style="width:100%;height:(\d+)px;"><\/div>\s*<script type="application\/json" data-for="\1">([\s\S]*)<\/script>\s*$/,
    );
    if (!matched) {
      fail("HTML does not match the supported Plotly htmlwidget envelope");
    }
    const height = Number(matched[2]);
    if (height < 100 || height > 1600) {
      fail("widget height must be between 100 and 1600 pixels");
    }
    const spec = parsePlotlyPayload(matched[3]);
    result.push({
      version: 1,
      kind: "plotly",
      source: {
        sourceHash: source.hash,
        sourceId: wrapper.id,
        producerId: chunk.id,
        slideId: chunk.slideId!,
        chunkHash: hashSource(chunk.raw),
        outputHash: hashSource(html),
      },
      spec,
      specHash: hashSource(canonical(spec)),
      width: 800,
      height,
    });
  }
  return result;
}

/** Original source references an exported R htmlwidget; its executable scripts are never reused. */
export async function collectExternalPlotlyCandidates(
  source: SourceDocument,
  root: string,
): Promise<PlotlyCandidate[]> {
  if (hashSource(source.text) !== source.hash) fail("source snapshot is stale");
  source = scanSource(source.text);
  const result: PlotlyCandidate[] = [];
  for (const wrapper of source.blocks.filter((block) => block.kind === "div")) {
    const attr = originalThemeAttributes(wrapper);
    const paths = attr?.[2].filter(([key]) => key === "widget-src") ?? [];
    if (!paths.length) continue;
    if (
      paths.length !== 1 || !wrapper.stable || !wrapper.slideId ||
      source.blocks.some((block) => block.parentId === wrapper.id)
    ) {
      fail(
        "external widget needs an empty identified original div under a slide",
      );
    }
    const path = paths[0][1];
    const file = await readExternalWidget(root, path);
    const matches = [
      ...file.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
    ].flatMap((match) => {
      if (!/\btype=["']application\/json["']/i.test(match[1])) return [];
      const attributes = [...match[1].matchAll(
        /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
      )].filter((attribute) => attribute[1].toLowerCase() === "data-for");
      if (!attributes.length) return [];
      const id = attributes[0][2] ?? attributes[0][3] ?? attributes[0][4];
      if (
        attributes.length !== 1 || !/^htmlwidget-[a-z0-9]+$/i.test(id ?? "")
      ) {
        fail(
          "external HTML requires one valid data-for identifier per payload",
        );
      }
      return [{ id, payload: match[2] }];
    });
    if (matches.length !== 1) {
      fail(
        "external HTML must contain exactly one identified R htmlwidget payload",
      );
    }
    const { id, payload } = matches[0];
    if (
      !new RegExp(
        `<div[^>]*class=["'][^"']*\\bplotly\\b[^"']*html-widget[^"']*["'][^>]*id=["']${id}["']|<div[^>]*id=["']${id}["'][^>]*class=["'][^"']*\\bplotly\\b[^"']*html-widget[^"']*["']`,
        "i",
      ).test(file)
    ) fail("external HTML lacks its matching Plotly widget container");
    const spec = parsePlotlyPayload(payload);
    const height = Number(spec.layout.height ?? 500),
      width = Number(spec.layout.width ?? 800);
    result.push({
      version: 1,
      kind: "plotly",
      source: {
        sourceHash: source.hash,
        sourceId: wrapper.id,
        producerId: "",
        slideId: wrapper.slideId,
        chunkHash: hashSource(wrapper.raw),
        outputHash: hashSource(file),
        external: { path, sha256: hashSource(file) },
      },
      spec,
      specHash: hashSource(canonical(spec)),
      width,
      height,
    });
  }
  return result;
}
export async function readExternalWidget(
  root: string,
  path: string,
): Promise<string> {
  try {
    return await readExternalWidgetFile(root, path);
  } catch (error) {
    if (
      !(error instanceof Deno.errors.NotCapable) ||
      !error.message.includes("all access") ||
      !error.message.includes("/proc/self/fd/")
    ) throw error;
    const artifact = resolve(await Deno.realPath(root), path);
    const permission = await Deno.permissions.query({
      name: "read",
      path: artifact,
    });
    if (permission.state !== "granted") {
      fail("widget artifact read permission is not granted");
    }
    // Deno gates directory descriptors on -A; only this fixed data-only child receives it.
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--no-config",
        "--no-remote",
        "--no-npm",
        "--no-lock",
        "--allow-all",
        import.meta.resolve("./external-reader.ts"),
        root,
        path,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    if (!result.success) {
      throw new Error(decoder.decode(result.stderr).trim());
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      result.stdout,
    );
  }
}
