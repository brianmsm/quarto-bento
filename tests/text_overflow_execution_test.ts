import {
  readProjectDiagnostics,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const original =
  "## Results {#results}\n\n<!-- qb:first -->\nA short finding.\n";
Deno.test("changed source text warns after saved geometry; fresh saved inspections clear without execution or QMD changes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-text-overflow-" }),
    path = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(path, original);
    const base = await renderProject(path),
      edited = structuredClone(base.state.emitted);
    Object.assign(edited.slides[0].elements.find((e) => e.id === "first")!, {
      x: 80,
      y: 166,
      w: 300,
      h: 80,
      fontSize: 26,
    });
    await saveProject(path, edited, base.state.revision);
    const grown = original.replace(
      "A short finding.",
      "A changed dataset produces a much longer conclusion with additional participants and confidence intervals. "
        .repeat(10).trim(),
    );
    await Deno.writeTextFile(path, grown);
    const changed = await renderProject(path),
      target = changed.state.emitted.slides[0].elements.find((e) =>
        e.id === "first"
      )!;
    assert(
      target.x === 80 && target.y === 166 && target.w === 300 &&
        target.h === 80 && target.fontSize === 26,
    );
    assert(
      changed.diagnostics.some((d) =>
        d.code === "TEXT_OVERFLOW" && d.elementId === "first"
      ),
      JSON.stringify(changed.diagnostics),
    );
    assert(changed.state.pending.length === 0);
    assert(
      (await readProjectDiagnostics(path)).some((d) =>
        d.code === "TEXT_OVERFLOW" && d.elementId === "first"
      ),
    );
    const corrected = structuredClone(changed.state.emitted);
    Object.assign(corrected.slides[0].elements.find((e) => e.id === "first")!, {
      w: 1100,
      h: 500,
      fontSize: 14,
    });
    const saved = await saveProject(path, corrected, changed.state.revision);
    assert((await Deno.readTextFile(path)) === grown, "Save rewrote QMD");
    assert(
      !(await readProjectDiagnostics(path)).some((d) =>
        d.code === "TEXT_OVERFLOW"
      ),
      "Fresh Save inspection retained warning",
    );
    assert(saved.pending.length === 0);
    const fitted = await renderProject(path);
    assert(
      !fitted.diagnostics.some((d) => d.code === "TEXT_OVERFLOW"),
      JSON.stringify(fitted.diagnostics),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("ordinary Quarto emits text overflow warning and retains source", async () => {
  const dir = await Deno.makeTempDir({
      prefix: "qbento-ordinary-text-overflow-",
    }),
    path = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(path, original);
    await installQuartoProject(path);
    const base = await renderProject(path),
      edited = structuredClone(base.state.emitted);
    Object.assign(edited.slides[0].elements.find((e) => e.id === "first")!, {
      w: 50,
      h: 10,
      fontSize: 36,
    });
    await saveProject(path, edited, base.state.revision);
    const before = await Deno.readTextFile(path);
    const result = await new Deno.Command("quarto", {
      args: ["render", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const log = new TextDecoder().decode(result.stdout) +
      new TextDecoder().decode(result.stderr);
    assert(result.success, log);
    assert(log.includes("TEXT_OVERFLOW"), log);
    assert(await Deno.readTextFile(path) === before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("unavailable Chromium warns but browser-free ordinary rendering remains usable", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-no-browser-text-" }),
    path = dir + "/deck.qmd",
    script = dir + "/run.ts";
  try {
    await Deno.writeTextFile(path, original);
    await Deno.writeTextFile(
      script,
      `import {renderProject,readProjectDiagnostics} from ${
        JSON.stringify(new URL("../src/core/project.ts", import.meta.url).href)
      };const r=await renderProject(${
        JSON.stringify(path)
      });console.log(JSON.stringify({diagnostics:r.diagnostics,pending:r.state.pending,read:await readProjectDiagnostics(${
        JSON.stringify(path)
      })}));`,
    );
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run=quarto",
        "--allow-net=127.0.0.1",
        script,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const log = new TextDecoder().decode(result.stdout),
      error = new TextDecoder().decode(result.stderr);
    assert(result.success, error);
    const receipt = JSON.parse(log);
    assert(receipt.pending.length === 0);
    assert(
      receipt.diagnostics.some((d: { code: string }) =>
        d.code === "TEXT_MEASUREMENT_UNAVAILABLE"
      ),
      log,
    );
    assert(
      receipt.read.some((d: { code: string }) =>
        d.code === "TEXT_MEASUREMENT_UNAVAILABLE"
      ),
      log,
    );
    assert(await Deno.readTextFile(path) === original);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
