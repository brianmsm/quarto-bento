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
  };
  spec: { data: ObjectValue[]; layout: ObjectValue; config: ObjectValue };
  specHash: string;
  width: number;
  height: number;
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
function font(value: unknown) {
  const v = object(value, "font");
  keys(v, "family size color", "font");
  if (v.family !== undefined) plainText(v.family, "font.family");
}
function title(value: unknown) {
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === "string") return plainText(value, "title");
  const v = object(value, "title");
  keys(
    v,
    "text font standoff x y xanchor yanchor xref yref pad automargin",
    "title",
  );
  if (v.text !== undefined) plainText(v.text, "title.text");
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
    "type x y mode name marker line error_x error_y xaxis yaxis frame text textposition textfont hovertext hoverinfo hovertemplate opacity visible showlegend legendgroup orientation width base offset fill fillcolor connectgaps cliponaxis",
    "trace",
  );
  if (!["scatter", "bar"].includes(v.type as string)) {
    fail("only SVG scatter and bar traces are supported");
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
  for (const key of ["x", "y"]) {
    for (const item of v[key] as unknown[]) {
      if (typeof item === "string") plainText(item, key);
      else if (typeof item !== "number" && item !== null) {
        fail(`${key} values must be numeric, plain strings or null`);
      }
    }
  }
  for (const key of ["name", "text", "hovertext", "hovertemplate"]) {
    if (v[key] !== undefined) {
      for (
        const item of Array.isArray(v[key]) ? v[key] as unknown[] : [v[key]]
      ) plainText(item, key);
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
  for (const key of ["error_x", "error_y"]) {
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
    "title xaxis yaxis margin hovermode showlegend legend font paper_bgcolor plot_bgcolor barmode bargap bargroupgap dragmode",
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
    "modeBarButtonsToAdd showSendToCloud displayModeBar displaylogo scrollZoom doubleClick",
    "config",
  );
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
    let current = (nodes[0].c as [unknown, Node[]])[1];
    for (const className of ["cell", "cell-output-display"]) {
      if (current.length !== 1 || current[0].t !== "Div") {
        fail(
          "widget output requires one cell and one display block; hide echoed source and messages",
        );
      }
      const [attrs, nested] = current[0].c as [
        [string, string[], unknown[]],
        Node[],
      ];
      if (attrs[1].length !== 1 || attrs[1][0] !== className) {
        fail("unsupported widget output container");
      }
      current = nested;
    }
    if (current.length !== 1 || current[0].t !== "RawBlock") {
      fail("expected one widget HTML output");
    }
    const [format, html] = current[0].c as [string, string];
    if (format !== "html") fail("widget requires HTML output");
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
