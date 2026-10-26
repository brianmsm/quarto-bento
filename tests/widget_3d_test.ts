import { join } from "node:path";
import {
  readProjectPresenter,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { collectExternalPlotlyCandidates } from "../src/widgets/plotly.ts";
import {
  createPlotlyInlineView,
  createPlotlyReceipt,
  plotlyStaticElement,
  verifyStaticPng,
} from "../src/widgets/presenter.ts";
import { hashSource, scanSource } from "../src/source/mod.ts";
import { targetKey } from "../src/state/mod.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => Promise<unknown>, message: RegExp) {
  try {
    await action();
  } catch (error) {
    assert(message.test(String(error)), String(error));
    return;
  }
  throw new Error("Expected refusal");
}
const source = `## Three dimensions {#three}

::: {#cloud}

\`\`\`{r}
#| label: plot-cloud
#| echo: true
v <- read.csv("values.csv")
plotly::plot_ly(x=v$x, y=v$y, z=v$z, type="scatter3d", mode="markers") |>
  plotly::layout(scene=list(camera=list(eye=list(x=1.4,y=1.4,z=1.1))))
\`\`\`

:::
`;
Deno.test("real R Plotly3D echoes code, captures a PNG, keeps geometry and updates data", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-3d-" });
  try {
    const path = join(dir, "deck.qmd");
    await Deno.writeTextFile(path, source);
    await Deno.writeTextFile(
      join(dir, "values.csv"),
      "x,y,z\n1,2,3\n2,4,1\n3,1,5\n",
    );
    const first = await renderProject(path);
    assert(first.state.widgets?.entries.length === 1);
    const cloud = first.state.emitted.slides[0].elements.find((e) =>
      e.id === "cloud"
    )!;
    assert(
      cloud.type === "image" &&
        String(cloud.src).startsWith("data:image/png;base64,"),
    );
    const png = String(cloud.src).split(",")[1];
    verifyStaticPng(png);
    assert(png.length > 5000, "PNG must contain the actual3D chart");
    assert(
      first.state.emitted.slides[0].elements.some((e) =>
        e.type === "code" && String(e.content).includes("plotly::plot_ly")
      ),
      "echo was lost",
    );
    assert(
      first.state
        .provenance[targetKey({ slideId: "three", elementId: "cloud" })]
        .producer === "plot-cloud",
    );
    const doc = structuredClone(first.state.emitted),
      element = doc.slides[0].elements.find((e) => e.id === "cloud")!;
    element.x = 220;
    element.w = 700;
    await saveProject(path, doc, first.state.revision);
    await Deno.writeTextFile(
      join(dir, "values.csv"),
      "x,y,z\n1,2,3\n2,4,20\n3,1,5\n",
    );
    const second = await renderProject(path),
      updated = second.state.emitted.slides[0].elements.find((e) =>
        e.id === "cloud"
      )!;
    assert(
      second.state.docId === first.state.docId && updated.x === 220 &&
        updated.w === 700,
    );
    assert(
      updated.src !== cloud.src,
      "changed coordinates must update the snapshot",
    );
    const entry = second.state.widgets!.entries[0],
      bundle = JSON.parse(
        await Deno.readTextFile(
          join(
            dir,
            ".qbento/widgets",
            second.state.widgets!.generation,
            entry.file,
          ),
        ),
      );
    assert(bundle.candidate.spec.data[0].z[1] === 20);
    const runtimeDir = new TextDecoder().decode(
      (await new Deno.Command("Rscript", {
        args: [
          "--vanilla",
          "-e",
          'cat(system.file("htmlwidgets/lib/plotlyjs",package="plotly"))',
        ],
        stdout: "piped",
      }).output()).stdout,
    ).trim();
    const runtime = {
      javascript: await Deno.readTextFile(runtimeDir + "/plotly-latest.min.js"),
      license: await Deno.readTextFile(runtimeDir + "/LICENSE"),
    };
    const inline = await createPlotlyInlineView(bundle, runtime, {
      source: scanSource(source),
      expectedReceipt: createPlotlyReceipt(bundle),
    });
    assert(
      inline.includes("qbentoWidgetReady") &&
        inline.includes("qbentoWidgetEscape") &&
        inline.includes("ResizeObserver"),
    );
    assert(
      !inline.includes("allow-same-origin") &&
        inline.includes("connect-src 'none'"),
    );
    assert(await Deno.readTextFile(path) === source);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("local R htmlwidget import extracts only checked data and records artifact provenance", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-widget-import-" });
  try {
    const qmd =
        '## Imported {#imported}\n\n::: {#cloud widget-src="cloud.html"}\n:::\n',
      path = join(dir, "deck.qmd");
    await Deno.writeTextFile(path, qmd);
    const made = await new Deno.Command("Rscript", {
      cwd: dir,
      args: [
        "--vanilla",
        "-e",
        'htmlwidgets::saveWidget(plotly::plot_ly(x=1:3,y=c(2,1,3),z=c(4,1,6),type="scatter3d",mode="lines+markers"),"cloud.html",selfcontained=FALSE)',
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(made.success, new TextDecoder().decode(made.stderr));
    const bytes = await Deno.readTextFile(join(dir, "cloud.html"));
    const candidates = await collectExternalPlotlyCandidates(
      scanSource(qmd),
      dir,
    );
    assert(candidates.length === 1 && candidates[0].source.producerId === "");
    assert(candidates[0].source.external?.sha256 === hashSource(bytes));
    const result = await renderProject(path),
      entry = result.state.widgets!.entries[0];
    const origin = result.state
      .provenance[targetKey({ slideId: "imported", elementId: "cloud" })];
    assert(
      origin.origin === "authored" && origin.producer === undefined &&
        origin.source?.widget,
    );
    const bundle = JSON.parse(
      await Deno.readTextFile(
        join(
          dir,
          ".qbento/widgets",
          result.state.widgets!.generation,
          entry.file,
        ),
      ),
    );
    const projected = plotlyStaticElement(bundle, {
      source: scanSource(qmd),
      expectedReceipt: createPlotlyReceipt(bundle),
    });
    assert(projected.origin.origin === "authored" && projected.origin.widget);
    assert(
      (await readProjectPresenter(path, result.state.revision)).includes(
        "scatter3d",
      ),
    );
    await Deno.writeTextFile(
      join(dir, "cloud.html"),
      bytes + "\n<!-- changed -->",
    );
    await rejects(
      () => readProjectPresenter(path, result.state.revision),
      /artifact changed/,
    );
    await rejects(
      () =>
        collectExternalPlotlyCandidates(
          scanSource(qmd.replace("cloud.html", "../escape.html")),
          dir,
        ),
      /outside/,
    );
    await Deno.symlink(join(dir, "cloud.html"), join(dir, "linked.html"));
    await rejects(
      () =>
        collectExternalPlotlyCandidates(
          scanSource(qmd.replace("cloud.html", "linked.html")),
          dir,
        ),
      /regular local/,
    );
    await Deno.writeTextFile(
      join(dir, "cloud.html"),
      bytes.replace('"jsHooks":[]', '"jsHooks":[{"render":"alert(1)"}]'),
    );
    await rejects(
      () => collectExternalPlotlyCandidates(scanSource(qmd), dir),
      /jsHooks/,
    );
    assert(await Deno.readTextFile(path) === qmd);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
