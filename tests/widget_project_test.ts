import { join } from "node:path";
import {
  readProject,
  readProjectPresenter,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { projectPresenter, stageWidgets } from "../src/core/widgets.ts";
import { captureEdits, resolveChange } from "../src/state/merge.ts";
import { plotlyStaticElement } from "../src/widgets/presenter.ts";
import { scanSource } from "../src/source/mod.ts";
import { recoverProject } from "../src/core/recovery.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import { extractDocument } from "../src/render/html.ts";
import { canonical, sha256, StateStore, targetKey } from "../src/state/mod.ts";
import { hashSource } from "../src/source/mod.ts";
import { canonicalPlotlySvg } from "../src/widgets/snapshot.ts";
import { startStudio } from "../src/studio/server.ts";
function ok(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
async function refuses(fn: () => Promise<unknown>, message: RegExp) {
  try {
    await fn();
  } catch (e) {
    ok(
      message.test(
        String(e) + " " + (e instanceof Error && "code" in e ? e.code : ""),
      ),
      String(e),
    );
    return;
  }
  throw new Error("Expected refusal " + message);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
const qmd =
  "---\ntitle: Integrated Plotly\n---\n\n## Data {#data}\n\n::: {#plot-result}\n\n```{r}\n#| label: widget-values\n#| echo: false\ncat('executed\\n', file='executions.txt', append=TRUE)\nv <- read.csv('data.csv')\nplotly::plot_ly(x=v$x, y=v$y, type='scatter', mode='lines+markers')\n```\n\n:::\n";
Deno.test("Plotly SVG identities normalize without changing geometry", () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><defs><clipPath id="clip123"><rect width="20" height="20"/></clipPath></defs><g class="trace scatter traceabcd12" clip-path="url(#clip123)"><path d="M0,0L1,1"/></g></svg>';
  ok(
    canonicalPlotlySvg(svg, "a".repeat(64)) ===
      canonicalPlotlySvg(
        svg.replaceAll("clip123", "clip456").replace(
          "traceabcd12",
          "trace567890",
        ),
        "a".repeat(64),
      ),
  );
  const labels =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><text>id="foo" class="traceabcdef" url(#actual)</text></svg>';
  ok(
    canonicalPlotlySvg(labels, "a".repeat(64)) === labels,
    "normalization must preserve literal label text",
  );
});
Deno.test({
  name:
    "real widget project publishes trusted resources, preserves saved design, and refuses tampering",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qb-widget-project-" });
    let studio: Awaited<ReturnType<typeof startStudio>> | undefined;
    try {
      const source = join(dir, "deck.qmd"),
        csv = join(dir, "data.csv"),
        stateDir = join(dir, ".qbento");
      await Deno.writeTextFile(source, qmd);
      await Deno.writeTextFile(csv, "x,y\n1,2\n2,5\n3,4\n");
      const first = await renderProject(source);
      const widget = first.state.emitted.slides[0].elements.find((e) =>
        e.id === "plot-result"
      )!;
      ok(
        widget.type === "image" &&
          String(widget.src).startsWith("data:image/svg+xml;base64,"),
      );
      ok(!canonical(first.state.emitted).includes("<script"));
      ok(
        first.state.widgets?.generation === first.state.output?.generation &&
          first.presenter,
      );
      ok(
        first.state
          .provenance[targetKey({ slideId: "data", elementId: "plot-result" })]
          .producer === "widget-values",
      );
      ok(
        (await Deno.readTextFile(join(dir, "executions.txt"))).trim().split(
          "\n",
        ).length === 1,
        "producer executed exactly once",
      );
      const again = await renderProject(source);
      ok(
        again.state.emitted.slides[0].elements.find((e) =>
          e.id === "plot-result"
        )!.src === widget.src,
        "same data must retain exact SVG",
      );
      const edited = structuredClone(again.state.emitted),
        image = edited.slides[0].elements.find((e) => e.id === "plot-result")!;
      image.x = 125;
      image.y = 145;
      image.w = 530;
      image.h = 310;
      const saved = await saveProject(source, edited, again.state.revision);
      const html = await readProjectPresenter(source, saved.revision);
      const payload = JSON.parse(
        html.match(
          /<script id="qb-presenter-data" type="application\/json">([\s\S]*?)<\/script>/,
        )![1],
      );
      const presented = extractDocument(payload.deck).slides[0].elements.find(
        (e) => e.id === "plot-result",
      )!;
      ok(
        presented.x === 125 && presented.w === 530,
        "Presenter takes current saved visual authority",
      );
      await Deno.writeTextFile(csv, "x,y\n1,2\n2,20\n3,4\n");
      const changed = await renderProject(source),
        changedImage = changed.state.emitted.slides[0].elements.find((e) =>
          e.id === "plot-result"
        )!;
      ok(
        changed.state.docId === first.state.docId &&
          changedImage.src !== widget.src,
      );
      ok(
        changedImage.x === 125 && changedImage.y === 145 &&
          changedImage.w === 530 && changedImage.h === 310,
        "changed data preserves geometry",
      );
      ok(
        changed.state.pending.length === 0 &&
          await Deno.readTextFile(source) === qmd,
      );
      const publication = changed.state.widgets!,
        generationDir = join(stateDir, "widgets", publication.generation),
        entry = publication.entries[0];
      const bundlePath = join(generationDir, entry.file),
        original = await Deno.readTextFile(bundlePath),
        fake = JSON.parse(original);
      fake.candidate.spec.data[0].y[1] = 666;
      fake.candidate.specHash = hashSource(canonical(fake.candidate.spec));
      await Deno.writeTextFile(bundlePath, canonical(fake));
      await refuses(
        () => readProjectPresenter(source, changed.state.revision),
        /trusted state receipt/,
      );
      await Deno.writeTextFile(bundlePath, original);
      const pagePath = join(generationDir, entry.presenter),
        page = await Deno.readTextFile(pagePath);
      await Deno.writeTextFile(pagePath, page + "tampered");
      await refuses(
        () => readProjectPresenter(source, changed.state.revision),
        /trusted receipt/,
      );
      await Deno.writeTextFile(pagePath, page);
      const realRead = Deno.readTextFile;
      let reads = 0;
      Deno.readTextFile = async (path, options) => {
        const contents = await realRead(path, options);
        return String(path) === pagePath && ++reads === 2
          ? contents + "tampered second read"
          : contents;
      };
      try {
        await refuses(
          () => readProjectPresenter(source, changed.state.revision),
          /changed while preparing/,
        );
      } finally {
        Deno.readTextFile = realRead;
      }
      const detachedDoc = structuredClone(changed.state.emitted);
      detachedDoc.slides[0].elements.find((e) => e.id === "plot-result")!.src =
        "data:image/svg+xml;base64," +
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        );
      const captured = captureEdits(changed.state, detachedDoc);
      const detached = resolveChange(
        captured,
        captured.pending.find((p) => p.path[0] === "src")!.id,
        "detach",
      );
      const detachedHtml = await projectPresenter(source, stateDir, detached);
      const readPayload = (html: string) =>
        JSON.parse(
          html.match(
            /<script id="qb-presenter-data" type="application\/json">([\s\S]*?)<\/script>/,
          )![1],
        );
      ok(
        readPayload(detachedHtml).widgets.length === 0,
        "explicit detached content is static only",
      );
      const bundle = JSON.parse(original), mapping = scanSource(qmd);
      const runtime = {
        javascript: await Deno.readTextFile(join(generationDir, "plotly.js")),
        license: await Deno.readTextFile(join(generationDir, "LICENSE")),
      };
      const staticProjection = plotlyStaticElement(bundle, {
        source: mapping,
        expectedReceipt: entry.receipt as never,
      });
      const detachedPublication = await stageWidgets(
        stateDir,
        crypto.randomUUID(),
        detached.docId,
        mapping,
        {
          bundles: [bundle],
          runtime,
          projections: new Map([["plot-result", {
            ...staticProjection,
            slideId: "data",
            outputHash: bundle.candidate.source.outputHash,
          }]]),
        },
        detached.emitted,
        new Set([targetKey({ slideId: "data", elementId: "plot-result" })]),
      );
      ok(
        readPayload(
          await Deno.readTextFile(
            join(
              stateDir,
              "widgets",
              detachedPublication!.generation,
              "presenter.html",
            ),
          ),
        ).widgets.length === 0,
        "published detached content is static only",
      );
      await Deno.writeTextFile(source, qmd + "\nchanged source\n");
      await refuses(
        () => readProjectPresenter(source, changed.state.revision),
        /current QMD|source|provenance/i,
      );
      await Deno.writeTextFile(source, qmd);
      await refuses(
        () => readProjectPresenter(source, 0),
        /STALE_REVISION|newer project/,
      );
      if (canServe) {
        studio = await startStudio(source);
        const root = await (await fetch(studio.url)).text();
        const token = JSON.parse(root.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
        const post = (headers: Record<string, string>) =>
          fetch(studio!.url + "/api/presenter", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ revision: changed.state.revision }),
          });
        const unauthorized = await post({});
        ok(unauthorized.status === 403);
        await unauthorized.body?.cancel();
        const authorized = await post({ "x-qbento-token": token });
        ok(authorized.status === 200);
        const capability = await authorized.json();
        const result = await fetch(studio.url + capability.url);
        ok(
          result.status === 200 &&
            (await result.text()).includes("qb-presenter-data"),
        );
        const unknown = await fetch(studio.url + "/presenter/unknown");
        ok(unknown.status === 404);
        await unknown.body?.cancel();
      }
      const output = await Deno.readTextFile(changed.output),
        executions = await Deno.readTextFile(join(dir, "executions.txt"));
      await Deno.writeTextFile(changed.output, output + "native saved edit");
      await refuses(() => renderProject(source), /UNCAPTURED_HTML_EDITS/);
      await refuses(
        () => readProjectPresenter(source, changed.state.revision),
        /UNCAPTURED_HTML_EDITS/,
      );
      ok(
        await Deno.readTextFile(join(dir, "executions.txt")) === executions,
        "guard runs before execution",
      );
      await Deno.writeTextFile(changed.output, output);
      // Simulate interruption after state commit; resources must be valid to finish.
      const store = new StateStore(stateDir),
        state = await store.save(changed.state),
        staging = changed.output + ".pending-" + crypto.randomUUID(),
        backup = join(
          stateDir,
          "history",
          "output-" + crypto.randomUUID() + ".html",
        );
      await Deno.rename(changed.output, backup);
      await Deno.writeTextFile(staging, output);
      await Deno.writeTextFile(
        join(stateDir, "render-transaction.json"),
        JSON.stringify({
          version: 1,
          staging,
          backup,
          output: changed.output,
          oldRevision: changed.state.revision,
          nextRevision: state.revision,
          sha256: await sha256(output),
          previousOutput: changed.state.output,
        }),
      );
      ok((await recoverProject(source)).available.includes("finish"));
      await Deno.writeTextFile(pagePath, "tampered");
      const inspection = await recoverProject(source);
      ok(
        !inspection.available.includes("finish") &&
          inspection.available.includes("rollback"),
      );
      await refuses(() => recoverProject(source, "finish"), /RECOVERY_BLOCKED/);
      await Deno.writeTextFile(pagePath, page);
      await recoverProject(source, "rollback");
      ok(
        (await readProject(source)).widgets?.generation ===
          publication.generation,
      );
      ok(await Deno.readTextFile(changed.output) === output);
      const validState = await Deno.readTextFile(store.path);
      await Deno.writeTextFile(
        source,
        qmd + "\n```{=html}\n<div>unsupported</div>\n```\n",
      );
      await refuses(
        () => renderProject(source),
        /UNSUPPORTED_RAW|raw HTML|RawBlock|unsupported/i,
      );
      ok(
        await Deno.readTextFile(changed.output) === output &&
          await Deno.readTextFile(store.path) === validState,
        "unconsumed raw HTML cannot publish",
      );
    } finally {
      await studio?.shutdown();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "installed offline Quarto extension includes widget runtime and executes producer once",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qb-widget-installed-" });
    try {
      const source = join(dir, "deck.qmd");
      await Deno.writeTextFile(source, qmd);
      await Deno.writeTextFile(join(dir, "data.csv"), "x,y\n1,2\n2,5\n3,4\n");
      await installQuartoProject(source);
      const child = await new Deno.Command("quarto", {
        args: ["render", "deck.qmd"],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      }).output();
      ok(child.success, new TextDecoder().decode(child.stderr));
      const state = await readProject(source);
      ok(
        state.widgets?.entries.length === 1 &&
          state.emitted.slides[0].elements.some((e) =>
            e.id === "plot-result" && e.type === "image"
          ),
      );
      ok(
        (await Deno.readTextFile(join(dir, "executions.txt"))).trim().split(
          "\n",
        ).length === 1,
      );
      ok(
        (await Deno.stat(
          join(dir, "_extensions/qbento/runtime/src/widgets/deck.ts"),
        )).isFile,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
