/** Optional local Chromium exporter; requires a compatible browser already installed. */
import { withHeadlessChromium } from "../browser/chromium.ts";
import { pathToFileURL } from "node:url";
import {
  createPlotlyBundle,
  createPlotlySnapshotPage,
  isPlotly3d,
  type PlotlyBundle,
  type PlotlyRuntime,
  verifyStaticSvg,
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
    if (isPlotly3d(candidate)) {
      const png = await withHeadlessChromium(options, async (browser) => {
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width: candidate.width,
          height: candidate.height,
          deviceScaleFactor: 2,
          mobile: false,
        });
        await browser.send("Page.navigate", {
          url: pathToFileURL(`${dir}/snapshot.html`).href,
        });
        const ready = await browser.send<
          { result: { value?: { ready?: boolean; error?: string } } }
        >("Runtime.evaluate", {
          expression:
            `new Promise(resolve=>{const poll=()=>{const result=JSON.parse(document.getElementById('qb-widget-result')?.textContent||'{}');if(result.ready||result.error)requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(result)));else setTimeout(poll,25);};poll();})`,
          awaitPromise: true,
          returnByValue: true,
        });
        if (ready.result.value?.ready !== true) {
          fail(
            `Chromium did not render the3D widget: ${
              ready.result.value?.error ?? "unknown error"
            }`,
          );
        }
        const screenshot = await browser.send<{ data: string }>(
          "Page.captureScreenshot",
          {
            format: "png",
            clip: {
              x: 0,
              y: 0,
              width: candidate.width,
              height: candidate.height,
              scale: 1,
            },
            captureBeyondViewport: false,
          },
        );
        return screenshot.data;
      });
      return createPlotlyBundle(candidate, png);
    }
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
    if (
      result.ready !== true ||
      typeof result[isPlotly3d(candidate) ? "png" : "svg"] !== "string"
    ) {
      fail(
        `Chromium did not finish static export${
          result.error ? `: ${result.error}` : ""
        }`,
      );
    }
    return createPlotlyBundle(
      candidate,
      isPlotly3d(candidate)
        ? result.png
        : canonicalPlotlySvg(result.svg, candidate.specHash),
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await Deno.remove(dir, { recursive: true });
  }
}

/** Plotly assigns random SVG IDs/trace class tokens; never rewrite user label text. */
export function canonicalPlotlySvg(svg: string, specHash: string): string {
  verifyStaticSvg(svg);
  const ids = new Map<string, string>();
  const tags = (
    input: string,
    update: (name: string, value: string) => string,
  ) =>
    input.replace(
      /<[A-Za-z][^<>]*>/g,
      (tag) =>
        tag.replace(/\s([\w:-]+)=(["'])(.*?)\2/g, (_, name, quote, value) =>
          ` ${name}=${quote}${update(name, value)}${quote}`),
    );
  tags(svg, (name, value) => {
    if (name === "id") {
      if (ids.has(value)) fail("duplicate SVG identity");
      ids.set(value, `qb-plotly-${specHash.slice(0, 16)}-${ids.size}`);
    }
    return value;
  });
  svg = tags(svg, (name, value) => {
    if (name === "id") return ids.get(value)!;
    if (name === "class") {
      return value.split(/\s+/).filter((c) => !/^trace[0-9a-f]{6}$/.test(c))
        .join(" ");
    }
    return value.replace(/url\(#([^)]+)\)/g, (_, id) => {
      if (!ids.has(id)) fail("unbound SVG fragment");
      return `url(#${ids.get(id)})`;
    });
  });
  verifyStaticSvg(svg);
  return svg;
}
