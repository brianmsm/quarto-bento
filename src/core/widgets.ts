/** Generation-scoped widget resources. The checksummed state, never these files, owns receipts. */
import { dirname, resolve } from "node:path";
import {
  canonical,
  type JsonObject,
  type ProjectState,
  StateError,
  targetKey,
  type WidgetPublication,
} from "../state/mod.ts";
import { hashSource, scanSource, type SourceDocument } from "../source/mod.ts";
import { type Ast } from "../render/types.ts";
import { collectPlotlyCandidates } from "../widgets/plotly.ts";
import {
  createPlotlyPresenter,
  createPlotlyReceipt,
  loadPlotlyBundle,
  PLOTLY_RUNTIME,
  type PlotlyBundle,
  type PlotlyReceipt,
  type PlotlyRuntime,
  plotlyStaticElement,
  verifyPlotlyRuntime,
} from "../widgets/presenter.ts";
import { snapshotPlotly } from "../widgets/snapshot.ts";
import type { WidgetProjection } from "../render/project.ts";
import { syncDirectory, writeDurable } from "./io.ts";
import { createDeckPresenter } from "../widgets/deck.ts";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function fail(message: string): never {
  throw new StateError("WIDGET_REBUILD_REQUIRED", message);
}
async function regular(path: string, directory = false): Promise<void> {
  for (let p = resolve(path);; p = dirname(p)) {
    const stat = await Deno.lstat(p);
    if (
      stat.isSymlink ||
      (p === resolve(path) && !directory ? !stat.isFile : !stat.isDirectory)
    ) {
      fail(
        `Widget resource must be a real ${
          directory ? "directory" : "file"
        }: ${p}`,
      );
    }
    if (dirname(p) === p) break;
  }
}
async function makeDirectory(path: string) {
  await Deno.mkdir(path, { recursive: true });
  await regular(path, true);
}
async function installedRuntime(): Promise<PlotlyRuntime> {
  const r = await new Deno.Command("Rscript", {
    args: [
      "--vanilla",
      "-e",
      'cat(system.file("htmlwidgets/lib/plotlyjs", package="plotly"))',
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const path = new TextDecoder().decode(r.stdout).trim();
  if (!r.success || !path) {
    fail(
      "Install a compatible R plotly package and Chromium to render this widget; qbento does not manage environments.",
    );
  }
  await regular(resolve(path, "plotly-latest.min.js"));
  await regular(resolve(path, "LICENSE"));
  const runtime = {
    javascript: await Deno.readTextFile(resolve(path, "plotly-latest.min.js")),
    license: await Deno.readTextFile(resolve(path, "LICENSE")),
  };
  await verifyPlotlyRuntime(runtime);
  return runtime;
}
export interface PreparedWidgets {
  bundles: PlotlyBundle[];
  runtime?: PlotlyRuntime;
  projections: Map<string, WidgetProjection>;
}
export async function prepareWidgets(
  ast: Ast,
  source: SourceDocument,
): Promise<PreparedWidgets> {
  const candidates = collectPlotlyCandidates(ast, source),
    projections = new Map<string, WidgetProjection>();
  if (!candidates.length) return { bundles: [], projections };
  if (candidates.length > 8) {
    fail(
      "This bounded Presenter supports up to eight Plotly widgets per deck.",
    );
  }
  const runtime = await installedRuntime(), bundles: PlotlyBundle[] = [];
  for (const candidate of candidates) {
    const bundle = await snapshotPlotly(candidate, runtime),
      expectedReceipt = createPlotlyReceipt(bundle);
    const projected = plotlyStaticElement(bundle, { source, expectedReceipt });
    projections.set(candidate.source.sourceId, {
      ...projected,
      slideId: candidate.source.slideId,
      outputHash: candidate.source.outputHash,
    });
    bundles.push(bundle);
  }
  return { bundles, runtime, projections };
}
/** Write immutable generation first; only publication of state activates its external receipt. */
export async function stageWidgets(
  stateDir: string,
  generation: string,
  docId: string,
  source: SourceDocument,
  prepared: PreparedWidgets,
  document: ProjectState["emitted"],
  detachedTargets: ReadonlySet<string> = new Set(),
): Promise<WidgetPublication | undefined> {
  if (!prepared.bundles.length) return undefined;
  if (!uuid.test(generation) || !prepared.runtime) {
    fail("Invalid widget publication generation");
  }
  const base = resolve(stateDir, "widgets");
  await makeDirectory(base);
  const staging = resolve(base, `.staging-${crypto.randomUUID()}`),
    destination = resolve(base, generation);
  await Deno.mkdir(staging);
  await regular(staging, true);
  const publication: WidgetPublication = {
    version: 1,
    generation,
    docId,
    sourceHash: source.hash,
    runtimeSha256: PLOTLY_RUNTIME.sha256,
    licenseSha256: PLOTLY_RUNTIME.licenseSha256,
    presenterSha256: "",
    entries: [],
  };
  const widgetPages: { slideId: string; elementId: string; html: string }[] =
    [];
  await writeDurable(
    resolve(staging, "plotly.js"),
    prepared.runtime.javascript,
  );
  await writeDurable(resolve(staging, "LICENSE"), prepared.runtime.license);
  for (const [index, bundle] of prepared.bundles.entries()) {
    const receipt = createPlotlyReceipt(bundle),
      html = await createPlotlyPresenter(bundle, prepared.runtime, {
        source,
        expectedReceipt: receipt,
      });
    const file = `widget-${index}.json`, presenter = `widget-${index}.html`;
    await writeDurable(resolve(staging, file), canonical(bundle));
    await writeDurable(resolve(staging, presenter), html);
    publication.entries.push({
      slideId: bundle.candidate.source.slideId,
      elementId: bundle.candidate.source.sourceId,
      file,
      presenter,
      presenterSha256: hashSource(html),
      receipt: receipt as unknown as JsonObject,
    });
    const slide = document.slides.find((s) =>
        s.id === bundle.candidate.source.slideId
      ),
      element = slide?.elements.find((e) =>
        e.id === bundle.candidate.source.sourceId
      );
    const expected =
      plotlyStaticElement(bundle, { source, expectedReceipt: receipt }).element;
    if (
      !detachedTargets.has(
        targetKey({
          slideId: bundle.candidate.source.slideId,
          elementId: bundle.candidate.source.sourceId,
        }),
      ) &&
      slide?.hidden !== true && element?.type === "image" &&
      element.src === expected.src
    ) {
      widgetPages.push({
        slideId: bundle.candidate.source.slideId,
        elementId: bundle.candidate.source.sourceId,
        html,
      });
    }
  }
  const host = await createDeckPresenter(document, widgetPages);
  publication.presenterSha256 = hashSource(host);
  await writeDurable(resolve(staging, "presenter.html"), host);
  await syncDirectory(staging);
  await Deno.rename(staging, destination);
  await syncDirectory(base);
  return publication;
}
function generationDirectory(stateDir: string, state: ProjectState): string {
  const p = state.widgets;
  if (
    !p || !uuid.test(p.generation) || p.docId !== state.docId ||
    p.generation !== state.output?.generation
  ) fail("Render the project before opening its widget Presenter.");
  return resolve(stateDir, "widgets", p.generation);
}
/** Recovery checks resources without assuming current QMD still equals the interrupted source. */
export async function assertWidgetFiles(
  stateDir: string,
  state: ProjectState,
): Promise<void> {
  if (!state.widgets) return;
  const dir = generationDirectory(stateDir, state);
  await regular(dir, true);
  const runtime = {
    javascript: await checkedRead(dir, "plotly.js"),
    license: await checkedRead(dir, "LICENSE"),
  };
  await verifyPlotlyRuntime(runtime);
  const host = await checkedRead(dir, "presenter.html");
  if (hashSource(host) !== state.widgets.presenterSha256) {
    fail("Published widget Presenter differs from its receipt.");
  }
  for (const entry of state.widgets.entries) {
    const bundle = JSON.parse(await checkedRead(dir, entry.file));
    if (hashSource(canonical(bundle)) !== entry.receipt.bundleHash) {
      fail("Widget bundle differs from the trusted state receipt.");
    }
    if (
      hashSource(await checkedRead(dir, entry.presenter)) !==
        entry.presenterSha256
    ) fail("Widget Presenter differs from its trusted receipt.");
  }
}
async function checkedRead(dir: string, file: string) {
  if (
    !/^(?:plotly\.js|LICENSE|presenter\.html|widget-\d+\.(?:json|html))$/.test(
      file,
    )
  ) fail("Invalid widget resource filename");
  const path = resolve(dir, file);
  await regular(path);
  return await Deno.readTextFile(path);
}
/** Build from saved design and verified generation resources, refusing stale/computed edits. */
export async function projectPresenter(
  sourcePath: string,
  stateDir: string,
  state: ProjectState,
): Promise<string> {
  if (!state.widgets?.entries.length) {
    fail(
      "No supported interactive widgets. Use Bento's ordinary presentation controls.",
    );
  }
  await assertWidgetFiles(stateDir, state);
  const source = scanSource(await Deno.readTextFile(sourcePath)),
    dir = generationDirectory(stateDir, state);
  const runtime = {
    javascript: await checkedRead(dir, "plotly.js"),
    license: await checkedRead(dir, "LICENSE"),
  };
  const pages: { slideId: string; elementId: string; html: string }[] = [];
  for (const entry of state.widgets.entries) {
    const slide = state.emitted.slides.find((s) => s.id === entry.slideId),
      element = slide?.elements.find((e) => e.id === entry.elementId);
    if (!slide || slide.hidden === true || !element) continue;
    if (
      state
          .provenance[
            targetKey({ slideId: entry.slideId, elementId: entry.elementId })
          ]?.origin === "detached" ||
      state.pending.some((change) =>
        change.origin === "detached" &&
        change.target.slideId === entry.slideId &&
        change.target.elementId === entry.elementId
      )
    ) continue;
    const context = {
      source,
      expectedReceipt: entry.receipt as unknown as PlotlyReceipt,
    };
    const bundle = await loadPlotlyBundle(await checkedRead(dir, entry.file), {
      ...context,
      runtime,
    });
    const expected = plotlyStaticElement(bundle, context).element;
    if (element.type !== "image" || element.src !== expected.src) {
      fail(
        "A computed widget image was edited or reconciled. Render or resolve it before opening the interactive Presenter.",
      );
    }
    const html = await checkedRead(dir, entry.presenter);
    if (hashSource(html) !== entry.presenterSha256) {
      fail("Widget Presenter changed while preparing the snapshot.");
    }
    pages.push({ slideId: entry.slideId, elementId: entry.elementId, html });
  }
  if (hashSource(await Deno.readTextFile(sourcePath)) !== source.hash) {
    fail("QMD changed while preparing Presenter; retry after rendering.");
  }
  return await createDeckPresenter(state.emitted, pages);
}
