/** Optional local Chromium exporter; requires a compatible browser already installed. */
import { pathToFileURL } from "node:url";
import {
  createPlotlyBundle,
  createPlotlySnapshotPage,
  type PlotlyBundle,
  type PlotlyRuntime,
} from "./presenter.ts";
import { fail, type PlotlyCandidate } from "./plotly.ts";
export async function snapshotPlotly(
  candidate: PlotlyCandidate,
  runtime: PlotlyRuntime,
  options: { chromium?: string; timeoutMs?: number } = {},
): Promise<PlotlyBundle> {
  const page = await createPlotlySnapshotPage(candidate, runtime);
  const dir = await Deno.makeTempDir({ prefix: "qbento-plotly-snapshot-" });
  let child: Deno.ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Deno.writeTextFile(`${dir}/snapshot.html`, page);
    child = new Deno.Command(options.chromium ?? "chromium", {
      args: [
        "--headless",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-extensions",
        "--disable-sync",
        "--no-pings",
        `--user-data-dir=${dir}/profile`,
        "--dump-dom",
        "--virtual-time-budget=5000",
        pathToFileURL(`${dir}/snapshot.html`).href,
      ],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          child?.kill("SIGKILL");
        } catch { /* Already exited. */ }
        reject(
          new Error(
            "WIDGET_SNAPSHOT_TIMEOUT: local Chromium did not produce a snapshot",
          ),
        );
      }, options.timeoutMs ?? 30_000);
    });
    const output = await Promise.race([child.output(), timeout]);
    if (!output.success) {
      fail(
        `local Chromium export failed: ${
          new TextDecoder().decode(output.stderr).slice(-2000)
        }`,
      );
    }
    const dom = new TextDecoder().decode(output.stdout);
    const matched = dom.match(
      /<script id="qb-widget-result" type="application\/json">([\s\S]*?)<\/script>/,
    );
    if (!matched) fail("Chromium did not emit an export result");
    const result = JSON.parse(matched![1]);
    if (result.ready !== true || typeof result.svg !== "string") {
      fail(
        `Chromium did not finish SVG export${
          result.error ? `: ${result.error}` : ""
        }`,
      );
    }
    return createPlotlyBundle(candidate, result.svg);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await Deno.remove(dir, { recursive: true });
  }
}
