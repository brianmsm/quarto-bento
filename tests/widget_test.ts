import { canonical } from "../src/state/json.ts";
import {
  collectPlotlyCandidates,
  parsePlotlyPayload,
} from "../src/widgets/plotly.ts";
import {
  createPlotlyBundle,
  createPlotlyPresenter,
  createPlotlyReceipt,
  plotlyStaticElement,
  verifyPlotlyRuntime,
  verifyStaticSvg,
} from "../src/widgets/presenter.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import type { Ast } from "../src/render/types.ts";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
function refuses(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("UNSUPPORTED_WIDGET:")) {
      return;
    }
    throw e;
  }
  throw new Error("expected widget refusal");
}
const raw = () => ({
  x: {
    data: [{
      type: "scatter",
      mode: "lines+markers",
      x: [1, 2, 3],
      y: [2, 5, 4],
      frame: null,
    }],
    layout: { xaxis: { title: [] }, yaxis: { title: [] }, showlegend: false },
    config: { showSendToCloud: false },
  },
  evals: [],
  jsHooks: [],
});
const source =
  "## Data {#data}\n\n::: {#plot-result}\n\n```{r}\n#| label: widget-values\n#| echo: false\nplotly::plot_ly(x=c(1,2,3), y=c(2,5,4), type='scatter')\n```\n\n:::\n";
const ast = (payload = JSON.stringify(raw())): Ast => ({
  meta: {},
  blocks: [{
    t: "Div",
    c: [["plot-result", [], []], [{
      t: "Div",
      c: [["", ["cell"], []], [{
        t: "Div",
        c: [["", ["cell-output-display"], []], [{
          t: "RawBlock",
          c: [
            "html",
            `<div class="plotly html-widget html-fill-item" id="htmlwidget-abc123" style="width:100%;height:464px;"></div>\n<script type="application/json" data-for="htmlwidget-abc123">${payload}</script>`,
          ],
        }]],
      }]],
    }]],
  }],
});
Deno.test("Plotly projects executed data with original wrapper/chunk hashes and no scripts", () => {
  const c = collectPlotlyCandidates(ast(), scanSource(source));
  ok(c.length === 1);
  ok(c[0].source.sourceId === "plot-result");
  ok(c[0].source.producerId === "widget-values");
  ok(c[0].source.slideId === "data");
  ok(c[0].source.sourceHash === hashSource(source));
  ok(!("frame" in c[0].spec.data[0]));
  ok(!("title" in (c[0].spec.layout.xaxis as object)));
  ok(!JSON.stringify(c[0].spec).includes("<script"));
});
Deno.test("Plotly refuses hooks, unfamiliar traces, fields, HTML, frames and network-bearing layouts", () => {
  const mutate = (fn: (v: ReturnType<typeof raw>) => void) => {
    const v = raw();
    fn(v);
    refuses(() => parsePlotlyPayload(JSON.stringify(v)));
  };
  mutate((v) => (v.evals as unknown[]).push("x.data[0].callback"));
  mutate((v) => (v.jsHooks as unknown[]).push({ render: "alert(1)" }));
  mutate((v) => v.x.data[0].type = "scattermapbox");
  mutate((v) => Object.assign(v.x.data[0], { customdata: ["crosstalk"] }));
  mutate((v) =>
    Object.assign(v.x.data[0], { text: "<img src=x onerror=alert(1)>" })
  );
  mutate((v) => Object.assign(v.x.data[0], { frame: "animation" }));
  mutate((v) =>
    Object.assign(v.x.layout, {
      images: [{ source: "https://example.org/image.png" }],
    })
  );
  mutate((v) => Object.assign(v.x, { frames: [{}] }));
  mutate((v) => v.x.config.showSendToCloud = true);
  mutate((v) =>
    Object.assign(v.x, { highlight: { on: "plotly_hover", persistent: true } })
  );
  refuses(() =>
    parsePlotlyPayload('{"x":{"__proto__":{}},"evals":[],"jsHooks":[]}')
  );
});
Deno.test("Plotly producer mapping refuses ambiguous/source-forged wrappers and explicit asis", () => {
  refuses(() =>
    collectPlotlyCandidates(
      ast(),
      scanSource(source.replace("plotly::plot_ly", "knitr::asis_output")),
    )
  );
  refuses(() =>
    collectPlotlyCandidates(
      ast(),
      scanSource(
        source.replace("#| echo: false", "#| echo: false\n#| results: asis"),
      ),
    )
  );
  refuses(() =>
    collectPlotlyCandidates(
      ast(),
      scanSource(source.replace("\n```{r}", "\nAuthored content.\n\n```{r}")),
    )
  );
  refuses(() =>
    collectPlotlyCandidates(
      ast(),
      scanSource(source.replace("#| label: widget-values\n", "")),
    )
  );
  const duplicate = ast();
  duplicate.blocks.push(structuredClone(duplicate.blocks[0]));
  refuses(() => collectPlotlyCandidates(duplicate, scanSource(source)));
  const stale = scanSource(source);
  stale.text += "changed";
  refuses(() => collectPlotlyCandidates(ast(), stale));
  const forged = scanSource(
    source.replace(/```\{r\}[\s\S]*?```/, "Literal source."),
  );
  forged.blocks = scanSource(source).blocks;
  refuses(() => collectPlotlyCandidates(ast(), forged));
  ok(
    collectPlotlyCandidates(
      ast(),
      scanSource(source.replace("plot-result", "unrelated")),
    ).length === 0,
  );
});
Deno.test("SVG fallback refuses active content, navigation and external resources", () => {
  verifyStaticSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="p"><rect width="1"/></clipPath></defs><g clip-path="url(#p)"><text>Value &amp; result</text></g></svg>',
  );
  refuses(() =>
    verifyStaticSvg(
      String
        .raw`<svg xmlns="http://www.w3.org/2000/svg" style="background-image:u\rl(https://example.org/pixel)"><rect width="20"/></svg>`,
    )
  );
  refuses(() =>
    verifyStaticSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" style='background-image:image-set("https://example.org/pixel" 1x)'><rect width="20"/></svg>`,
    )
  );
  refuses(() =>
    verifyStaticSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><rect fill='image-set("https://example.org/pixel" 1x)'/></svg>`,
    )
  );
  for (
    const svg of [
      "<svg><script>alert(1)</script></svg>",
      '<svg xmlns="x"><foreignObject/></svg>',
      '<svg xmlns="x"><image href="data:image/svg+xml,x"/></svg>',
      '<svg xmlns="x" onload="alert(1)"></svg>',
      '<svg xmlns="x" xml:base="https://example.org"><g fill="url(#foo)"/></svg>',
      '<svg xmlns="x"><g fill="url(https://example.org/x)"/></svg>',
      '<svg xmlns="x"><text>&#60;script</text></svg>',
    ]
  ) refuses(() => verifyStaticSvg(svg));
});
Deno.test("Bundle integrity rechecks altered payload even if its hash was recomputed", () => {
  const candidate = collectPlotlyCandidates(ast(), scanSource(source))[0];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Five</text></svg>';
  const bundle = createPlotlyBundle(candidate, svg);
  ok(bundle.fallback.sha256 === hashSource(svg));
  const projected = plotlyStaticElement(bundle, {
    source: scanSource(source),
    expectedReceipt: createPlotlyReceipt(bundle),
  });
  ok(projected.origin.origin === "computed");
  ok(projected.origin.producer === "widget-values");
  ok(projected.element.type === "image");
  ok(
    typeof projected.element.src === "string" &&
      projected.element.src.startsWith("data:image/svg+xml;base64,"),
  );
  ok(!JSON.stringify(projected.element).includes("javascript"));

  candidate.spec.data[0].type = "scattermapbox";
  candidate.specHash = hashSource(canonical(candidate.spec));
  refuses(() => createPlotlyBundle(candidate, svg));
});
Deno.test("Presenter refuses modified runtime and modified static snapshot before executing anything", async () => {
  let rejected = false;
  try {
    await verifyPlotlyRuntime({ javascript: "alert(1)", license: "MIT" });
  } catch (e) {
    rejected = e instanceof Error &&
      e.message.startsWith("UNSUPPORTED_WIDGET:");
  }
  ok(rejected);
  const bundle = createPlotlyBundle(
    collectPlotlyCandidates(ast(), scanSource(source))[0],
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Five</text></svg>',
  );
  const context = {
    source: scanSource(source),
    expectedReceipt: createPlotlyReceipt(bundle),
  };
  bundle.fallback.svg = bundle.fallback.svg.replace("Five", "Six");
  refuses(() =>
    createPlotlyPresenter(bundle, { javascript: "", license: "" }, context)
  );
});

Deno.test("Computed widget projection requires current original QMD and an external receipt", () => {
  const bundle = createPlotlyBundle(
    collectPlotlyCandidates(ast(), scanSource(source))[0],
    '<svg xmlns="http://www.w3.org/2000/svg"><text>Five</text></svg>',
  );
  const context = {
    source: scanSource(source),
    expectedReceipt: createPlotlyReceipt(bundle),
  };
  refuses(() =>
    plotlyStaticElement(bundle, {
      ...context,
      source: scanSource(source.replace("x=c(1,2,3)", "x=c(3,2,1)")),
    })
  );
  const changed = structuredClone(bundle);
  changed.fallback.svg = changed.fallback.svg.replace(
    "Five",
    "False computed number",
  );
  changed.fallback.sha256 = hashSource(changed.fallback.svg);
  refuses(() => plotlyStaticElement(changed, context));
  const forged = structuredClone(bundle);
  forged.candidate.source.producerId = "forged-producer";
  refuses(() =>
    plotlyStaticElement(forged, {
      ...context,
      expectedReceipt: createPlotlyReceipt(forged),
    })
  );
});
