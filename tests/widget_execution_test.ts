import { canonical } from "../src/state/json.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { collectPlotlyCandidates } from "../src/widgets/plotly.ts";
import {
  createPlotlyPresenter,
  createPlotlyReceipt,
  loadPlotlyBundle,
  PLOTLY_RUNTIME,
} from "../src/widgets/presenter.ts";
import { snapshotPlotly } from "../src/widgets/snapshot.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
Deno.test({
  name:
    "real Quarto Plotly execution produces pinned offline Presenter and changed-data SVG",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-widget-test-" });
    try {
      const dependency = await new Deno.Command("Rscript", {
        args: [
          "-e",
          'cat(system.file("htmlwidgets/lib/plotlyjs", package="plotly"))',
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      ok(
        dependency.success,
        "R plotly must be installed in the compatible test environment",
      );
      const runtimeDir = new TextDecoder().decode(dependency.stdout).trim();
      ok(runtimeDir, "R plotly runtime not installed");
      const runtime = {
        javascript: await Deno.readTextFile(
          `${runtimeDir}/plotly-latest.min.js`,
        ),
        license: await Deno.readTextFile(`${runtimeDir}/LICENSE`),
      };
      let source =
        "---\ntitle: Offline Plotly\n---\n\n## Data {#data}\n\n::: {#plot-result}\n\n```{r}\n#| label: widget-values\n#| echo: false\nv <- read.csv('data.csv')\nplotly::plot_ly(x=v$x, y=v$y, type='scatter', mode='lines+markers')\n```\n\n:::\n";
      await Deno.writeTextFile(`${dir}/deck.qmd`, source);
      await Deno.writeTextFile(`${dir}/data.csv`, "x,y\n1,2\n2,5\n3,4\n");
      const render = async () => {
        const ast = await executeQuarto(`${dir}/deck.qmd`, `${dir}/build`);
        const candidates = collectPlotlyCandidates(ast, scanSource(source));
        ok(candidates.length === 1);
        return await snapshotPlotly(candidates[0], runtime);
      };
      const first = await render();
      ok(first.runtime.sha256 === PLOTLY_RUNTIME.sha256);
      ok(first.candidate.source.producerId === "widget-values");
      ok(first.fallback.svg.includes("scatterlayer"));
      ok(first.fallback.svg.includes('class="point"'));
      ok(first.fallback.sha256 === hashSource(first.fallback.svg));
      const context = {
        source: scanSource(source),
        expectedReceipt: createPlotlyReceipt(first),
      };
      const loaded = await loadPlotlyBundle(canonical(first), {
        ...context,
        runtime,
      });
      const html = await createPlotlyPresenter(loaded, runtime, context);
      ok(html.includes('sandbox="allow-scripts"'));
      ok(!html.includes("allow-same-origin"));
      ok(html.includes("connect-src 'none'"));
      ok(html.includes("data:text/javascript;base64,"));
      ok(html.includes("data:image/svg+xml;base64,"));
      await Deno.writeTextFile(`${dir}/data.csv`, "x,y\n1,2\n2,20\n3,4\n");
      const second = await render();
      ok(
        second.candidate.source.sourceHash ===
          first.candidate.source.sourceHash,
      );
      ok(
        second.candidate.source.chunkHash === first.candidate.source.chunkHash,
      );
      ok(second.candidate.specHash !== first.candidate.specHash);
      ok(
        second.candidate.spec.data[0].y instanceof Array &&
          second.candidate.spec.data[0].y[1] === 20,
      );
      ok(second.fallback.sha256 !== first.fallback.sha256);
      ok(second.fallback.svg.includes(">20<"));
      ok(await Deno.readTextFile(`${dir}/deck.qmd`) === source);
      source = source.replace(
        "type='scatter', mode='lines+markers'",
        "type='bar'",
      );
      await Deno.writeTextFile(`${dir}/deck.qmd`, source);
      const bars = await render();
      ok(bars.candidate.spec.data[0].type === "bar");
      ok(bars.fallback.svg.includes("barlayer"));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
