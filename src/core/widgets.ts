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
import {
  applyPlotlyCamera,
  collectExternalPlotlyCandidates,
  collectPlotlyCandidates,
  readExternalWidget,
} from "../widgets/plotly.ts";
import {
  createPlotlyInlineView,
  createPlotlyPresenter,
  createPlotlyReceipt,
  isPlotly3d,
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
import { type InlineWidget } from "../widgets/inline.ts";
import {
  type OutputOverflowTarget,
  outputOverflowTargets,
} from "../render/output-overflow.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";
import { savedPlotlyCamera } from "./widget-camera.ts";
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
  root: string,
  state?: ProjectState | null,
): Promise<PreparedWidgets> {
  const candidates = [
      ...collectPlotlyCandidates(ast, source),
      ...await collectExternalPlotlyCandidates(source, root),
    ],
    projections = new Map<string, WidgetProjection>();
  if (!candidates.length) return { bundles: [], projections };
  if (candidates.length > 8) {
    fail(
      "This bounded Presenter supports up to eight Plotly widgets per deck.",
    );
  }
  const runtime = await installedRuntime(), bundles: PlotlyBundle[] = [];
  for (const candidate of candidates) {
    const elementId = candidate.source.sourceId;
    const displaySlide = state?.emitted.slides.find((s) =>
      s.elements.some((e) => e.id === elementId)
    );
    const key = targetKey({
      slideId: displaySlide?.id ?? candidate.source.slideId,
      elementId,
    });
    const detached = state?.provenance[key]?.origin === "detached" ||
      state?.pending.some((p) =>
        p.origin === "detached" && p.target.elementId === elementId
      );
    const camera = isPlotly3d(candidate) && !detached
      ? savedPlotlyCamera(state, elementId)
      : undefined;
    const bundle = await snapshotPlotly(
        camera ? applyPlotlyCamera(candidate, camera) : candidate,
        runtime,
      ),
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
/** Only exact composed native fallbacks receive an interactive view. */
export async function preparedInlineWidgets(
  prepared: PreparedWidgets,
  source: SourceDocument,
  document: ProjectState["emitted"],
  detachedTargets: ReadonlySet<string> = new Set(),
): Promise<InlineWidget[]> {
  if (!prepared.runtime) return [];
  const views: InlineWidget[] = [];
  for (const bundle of prepared.bundles) {
    const elementId = bundle.candidate.source.sourceId;
    const slide = document.slides.find((s) =>
      s.elements.some((e) => e.id === elementId)
    );
    if (!slide) continue;
    const slideId = slide.id;
    const element = slide?.elements.find((e) => e.id === elementId);
    const context = { source, expectedReceipt: createPlotlyReceipt(bundle) };
    const expected = plotlyStaticElement(bundle, context).element;
    if (
      slide?.hidden === true || element?.type !== "image" ||
      element.src !== expected.src ||
      detachedTargets.has(targetKey({ slideId, elementId }))
    ) continue;
    views.push({
      slideId,
      elementId,
      html: await createPlotlyInlineView(bundle, prepared.runtime, context),
    });
  }
  return views;
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
  overflowTargets: OutputOverflowTarget[] = [],
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
    const slide = document.slides.find((s) =>
        s.elements.some((e) => e.id === bundle.candidate.source.sourceId)
      ),
      element = slide?.elements.find((e) =>
        e.id === bundle.candidate.source.sourceId
      );
    publication.entries.push({
      slideId: slide?.id ?? bundle.candidate.source.slideId,
      elementId: bundle.candidate.source.sourceId,
      file,
      presenter,
      presenterSha256: hashSource(html),
      receipt: receipt as unknown as JsonObject,
    });
    const expected =
      plotlyStaticElement(bundle, { source, expectedReceipt: receipt }).element;
    if (
      !detachedTargets.has(
        targetKey({
          slideId: slide?.id ?? bundle.candidate.source.slideId,
          elementId: bundle.candidate.source.sourceId,
        }),
      ) &&
      slide?.hidden !== true && element?.type === "image" &&
      element.src === expected.src
    ) {
      widgetPages.push({
        slideId: slide!.id,
        elementId: bundle.candidate.source.sourceId,
        html: await createPlotlyInlineView(bundle, prepared.runtime, {
          source,
          expectedReceipt: receipt,
        }),
      });
    }
  }
  const host = await createDeckPresenter(
    document,
    widgetPages,
    overflowTargets,
  );
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
  overflowTargets?: OutputOverflowTarget[],
): Promise<string> {
  if (!state.widgets?.entries.length) {
    fail(
      "No supported interactive widgets. Use Bento's ordinary presentation controls.",
    );
  }
  await assertWidgetFiles(stateDir, state);
  const source = scanSource(await Deno.readTextFile(sourcePath)),
    dir = generationDirectory(stateDir, state);
  if (source.hash !== state.widgets.sourceHash) {
    fail("Widget source snapshot is stale; render before presenting.");
  }
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
    const external = context.expectedReceipt.source.external;
    if (
      external &&
      hashSource(
          await readExternalWidget(dirname(sourcePath), external.path),
        ) !== external.sha256
    ) fail("External widget artifact changed; render before presenting it.");
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
    pages.push({
      slideId: entry.slideId,
      elementId: entry.elementId,
      html: await createPlotlyInlineView(bundle, runtime, context),
    });
  }
  if (hashSource(await Deno.readTextFile(sourcePath)) !== source.hash) {
    fail("QMD changed while preparing Presenter; retry after rendering.");
  }
  return await createDeckPresenter(
    state.emitted,
    pages,
    overflowTargets ??
      outputOverflowTargets(
        source,
        state.provenance,
        state.emitted as unknown as RenderDoc,
      ),
  );
}

/** Verified generation data, never a receipt supplied by a browser. */
export async function loadProjectWidgets(
  sourcePath: string,
  stateDir: string,
  state: ProjectState,
): Promise<PreparedWidgets & { source: SourceDocument }> {
  await assertWidgetFiles(stateDir, state);
  const source = scanSource(await Deno.readTextFile(sourcePath));
  const dir = generationDirectory(stateDir, state);
  const runtime = {
    javascript: await checkedRead(dir, "plotly.js"),
    license: await checkedRead(dir, "LICENSE"),
  };
  const bundles: PlotlyBundle[] = [];
  for (const entry of state.widgets!.entries) {
    const receipt = entry.receipt as unknown as PlotlyReceipt;
    if (
      receipt.source.external &&
      hashSource(
          await readExternalWidget(
            dirname(sourcePath),
            receipt.source.external.path,
          ),
        ) !== receipt.source.external.sha256
    ) {
      fail("External widget artifact changed; render before using it.");
    }
    bundles.push(
      await loadPlotlyBundle(await checkedRead(dir, entry.file), {
        source,
        runtime,
        expectedReceipt: receipt,
      }),
    );
  }
  if (hashSource(await Deno.readTextFile(sourcePath)) !== source.hash) {
    fail("QMD changed while loading widgets.");
  }
  return { source, runtime, bundles, projections: new Map() };
}

/** Studio must remain available for reconciliation when a generation is stale. */
export async function persistedInlineWidgets(
  sourcePath: string,
  stateDir: string,
  state: ProjectState,
): Promise<InlineWidget[]> {
  if (!state.widgets?.entries.length) return [];
  try {
    await assertWidgetFiles(stateDir, state);
    const source = scanSource(await Deno.readTextFile(sourcePath));
    const dir = generationDirectory(stateDir, state);
    const runtime = {
      javascript: await checkedRead(dir, "plotly.js"),
      license: await checkedRead(dir, "LICENSE"),
    };
    const prepared: PreparedWidgets = {
      bundles: [],
      runtime,
      projections: new Map(),
    };
    const detached = new Set(
      state.pending.filter((p) => p.origin === "detached").map((p) =>
        targetKey(p.target)
      ),
    );
    for (const entry of state.widgets.entries) {
      const key = targetKey({
        slideId: entry.slideId,
        elementId: entry.elementId,
      });
      if (state.provenance[key]?.origin === "detached") detached.add(key);
      const receipt = entry.receipt as unknown as PlotlyReceipt;
      if (
        receipt.source.external &&
        hashSource(
            await readExternalWidget(
              dirname(sourcePath),
              receipt.source.external.path,
            ),
          ) !== receipt.source.external.sha256
      ) continue;
      prepared.bundles.push(
        await loadPlotlyBundle(await checkedRead(dir, entry.file), {
          source,
          runtime,
          expectedReceipt: receipt,
        }),
      );
    }
    if (hashSource(await Deno.readTextFile(sourcePath)) !== source.hash) {
      return [];
    }
    return await preparedInlineWidgets(
      prepared,
      source,
      state.emitted,
      detached,
    );
  } catch {
    // A stale or invalid view is never activated; strict Presenter still reports the failure.
    return [];
  }
}
