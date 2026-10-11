import { basename, dirname, resolve } from "node:path";
import { extractDocument } from "../render/html.ts";
import { hashSource } from "../source/mod.ts";
import { assertOutputUnchanged, sha256, StateError } from "../state/mod.ts";
import {
  projectPaths,
  renderProjectFromAst,
  withProject,
} from "../core/project.ts";

import { assertSafeQuartoInvocation, processStartTime } from "./invocation.ts";

interface QuartoRun {
  version: 1;
  token: string;
  source: string;
  sourceHash: string;
  revision: number | null;
  backupHash: string | null;
  process: { pid: number; startTime: string };
}
const receiptName = "quarto-run.json";
const stageName = "quarto-stage";
function backupPath(stateDir: string, run: QuartoRun): string {
  return resolve(stateDir, "history", `quarto-baseline-${run.token}.html`);
}
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function checkOutput(
  state: Parameters<typeof assertOutputUnchanged>[0],
  output: string,
) {
  try {
    await assertOutputUnchanged(state, output);
  } catch (e) {
    if (e instanceof StateError) throw new Error(`${e.code}: ${e.message}`);
    throw e;
  }
}
/** inspect includes YAML inheritance; unlike rendering, it does not execute chunks. */
async function inspectOutput(source: string): Promise<void> {
  const inspected = await new Deno.Command("quarto", {
    args: ["inspect", source],
    cwd: dirname(source),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!inspected.success) {
    throw new Error(
      `QUARTO_INSPECT_FAILED: ${new TextDecoder().decode(inspected.stderr)}`,
    );
  }
  const formats =
    JSON.parse(new TextDecoder().decode(inspected.stdout)).formats;
  if (
    !formats || Object.keys(formats).length !== 1 || !formats["qbento-html"]
  ) {
    throw new Error(
      "QBENTO_FORMAT_REQUIRED: select only qbento-html in QMD/project YAML; remove format: html (source remains unchanged)",
    );
  }
  const expected = basename(source).replace(/\.qmd$/, ".qbento-stage.html");
  if (
    formats["qbento-html"].pandoc?.["output-file"] !== expected ||
    formats["qbento-html"].render?.["output-ext"] !== "qbento-stage.html"
  ) {
    throw new Error(
      "UNSAFE_QUARTO_OUTPUT: remove output-file/output-ext overrides; Quarto must write its disposable stage",
    );
  }
  const stageOutput = resolve(dirname(source), expected);
  if (await fileExists(stageOutput)) {
    const info = await Deno.lstat(stageOutput);
    if (
      !info.isFile || info.isSymlink || (info.nlink !== null && info.nlink > 1)
    ) {
      throw new Error(
        "UNSAFE_STAGE_PATH: disposable stage must be an ordinary unlinked file, never an alias to the final deck",
      );
    }
  }
  const outputDir = Deno.env.get("QUARTO_PROJECT_OUTPUT_DIR");
  if (outputDir && resolve(outputDir) !== dirname(source)) {
    throw new Error(
      "UNSUPPORTED_QUARTO_OUTPUT_DIR: keep the default project output directory for qbento",
    );
  }
}
async function fileList(name: "INPUT" | "OUTPUT"): Promise<string[]> {
  const file = Deno.env.get(`QUARTO_USE_FILE_FOR_PROJECT_${name}_FILES`);
  const value = file
    ? await Deno.readTextFile(file)
    : Deno.env.get(`QUARTO_PROJECT_${name}_FILES`) ?? "";
  return value.split(/\r?\n/).filter(Boolean);
}
async function realDirectory(path: string) {
  await Deno.mkdir(path, { recursive: true });
  const info = await Deno.lstat(path);
  if (!info.isDirectory || info.isSymlink) {
    throw new Error(`UNSAFE_STAGE_PATH: ${path} must be a real directory`);
  }
}
async function readReceipt(path: string): Promise<QuartoRun> {
  const value = JSON.parse(await Deno.readTextFile(path));
  if (
    value.version !== 1 || typeof value.token !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.token) ||
    typeof value.source !== "string" || typeof value.sourceHash !== "string" ||
    !(value.revision === null || Number.isInteger(value.revision)) ||
    !(value.backupHash === null || typeof value.backupHash === "string") ||
    !Number.isInteger(value.process?.pid) ||
    typeof value.process?.startTime !== "string"
  ) {
    throw new Error("INVALID_QUARTO_RECEIPT: inspect .qbento/quarto-run.json");
  }
  return value;
}

/** A durable receipt prevents overlapping external renders. */
export async function beforeQuartoRender(): Promise<void> {
  if (Deno.env.get("QBENTO_INTERNAL_RENDER") === "1") return;
  const inputs = await fileList("INPUT");
  if (inputs.length !== 1 || !inputs[0].endsWith(".qmd")) {
    throw new Error(
      "SINGLE_QMD_REQUIRED: qbento project renders exactly one QMD",
    );
  }
  const source = resolve(inputs[0]);
  if (dirname(source) !== Deno.cwd()) {
    throw new Error(
      "SOURCE_AT_PROJECT_ROOT: place the single QMD beside _quarto.yml",
    );
  }
  const process = await assertSafeQuartoInvocation(source);
  await inspectOutput(source);
  await withProject(source, async (paths, store) => {
    const state = await store.load();
    await checkOutput(state, paths.output);
    const receipt = resolve(paths.stateDir, receiptName);
    const run: QuartoRun = {
      version: 1,
      token: crypto.randomUUID(),
      source,
      sourceHash: hashSource(await Deno.readTextFile(source)),
      revision: state?.revision ?? null,
      backupHash: null,
      process,
    };
    try {
      await Deno.writeTextFile(receipt, JSON.stringify(run, null, 2) + "\n", {
        createNew: true,
      });
    } catch (e) {
      if (e instanceof Deno.errors.AlreadyExists) {
        throw new Error(
          "QUARTO_RENDER_PENDING: another render or failed execution has a receipt; run the explicit Quarto recovery operation after the render stops (final HTML and project edits remain intact)",
        );
      }
      throw e;
    }
    // Independent copy: a hardlink would also be truncated by Pandoc --output.
    if (await fileExists(paths.output)) {
      const bytes = await Deno.readFile(paths.output);
      if (await sha256(bytes) !== state?.output?.sha256) {
        throw new Error(
          "UNCAPTURED_HTML_EDITS: output changed during preflight; execution refused",
        );
      }
      await realDirectory(resolve(paths.stateDir, "history"));
      await Deno.writeFile(backupPath(paths.stateDir, run), bytes, {
        createNew: true,
      });
      run.backupHash = await sha256(bytes);
      await Deno.writeTextFile(receipt, JSON.stringify(run, null, 2) + "\n");
    }
    const stage = resolve(paths.stateDir, stageName);
    await realDirectory(stage);
    try {
      await Deno.remove(resolve(stage, "executed.json"));
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  });
}

/** Consume the actual executed AST once; never execute Quarto again here. */
export async function afterQuartoRender(): Promise<void> {
  if (Deno.env.get("QBENTO_INTERNAL_RENDER") === "1") return;
  const outputs = await fileList("OUTPUT");
  const staged = outputs.filter((path) => path.endsWith(".qbento-stage.html"));
  if (staged.length !== 1 || outputs.length !== 1) {
    throw new Error(
      "QBENTO_FORMAT_REQUIRED: render the single qbento-html format",
    );
  }
  const stateDir = resolve(Deno.cwd(), ".qbento");
  const receipt = resolve(stateDir, receiptName);
  const run = await readReceipt(receipt);
  const paths = projectPaths(run.source);
  if (
    paths.stateDir !== stateDir ||
    basename(staged[0]) !==
      basename(run.source).replace(/\.qmd$/, ".qbento-stage.html")
  ) {
    throw new Error(
      "QUARTO_SOURCE_MISMATCH: stage and receipt must belong to this project",
    );
  }
  const captured = JSON.parse(
    await Deno.readTextFile(resolve(stateDir, stageName, "executed.json")),
  );
  if (captured.token !== run.token || !Array.isArray(captured.ast?.blocks)) {
    throw new Error(
      "STALE_QUARTO_AST: stage was not produced by this execution",
    );
  }
  const result = await renderProjectFromAst(run.source, {
    ast: captured.ast,
    sourceHash: run.sourceHash,
    assetDirectories: [dirname(resolve(staged[0])), paths.directory],
    expectedRevision: run.revision,
  });
  await Deno.remove(receipt);
  console.log(`Bento output created: ${result.output}`);
  for (const diagnostic of result.diagnostics) {
    console.warn(`${diagnostic.code}: ${diagnostic.message}`);
  }
}

/** Explicit recovery after a failed external Quarto run. Retains both outputs. */
export async function recoverQuartoRender(
  source: string,
): Promise<{ restored: boolean; retainedOutput: string | null }> {
  return await withProject(source, async (paths, store) => {
    const receipt = resolve(paths.stateDir, receiptName);
    const run = await readReceipt(receipt);
    if (Deno.build.os !== "linux") {
      throw new Error(
        "QUARTO_RECOVERY_PLATFORM: verify interrupted render manually on this platform",
      );
    }
    if (await processStartTime(run.process.pid) === run.process.startTime) {
      throw new Error(
        "QUARTO_RENDER_ACTIVE: the original render process is still running",
      );
    }
    if (run.source !== paths.source) {
      throw new Error(
        "QUARTO_SOURCE_MISMATCH: recovery source differs from receipt",
      );
    }
    const state = await store.load();
    if ((state?.revision ?? null) !== run.revision) {
      throw new Error(
        "STALE_REVISION: project changed since this Quarto render; inspect receipt and history manually",
      );
    }
    let retainedOutput: string | null = null;
    if (run.backupHash) {
      const bytes = await Deno.readFile(backupPath(paths.stateDir, run));
      if (await sha256(bytes) !== run.backupHash) {
        throw new Error("INVALID_QUARTO_BACKUP: baseline checksum mismatch");
      }
      if (await fileExists(paths.output)) {
        if (
          await sha256(await Deno.readFile(paths.output)) !== run.backupHash
        ) {
          // Valid native edits remain in place for explicit capture after recovery.
          let nativeEdit = false;
          try {
            nativeEdit =
              extractDocument(await Deno.readTextFile(paths.output)).docId ===
                state?.docId;
          } catch { /* Truncated outputs are retained separately below. */ }
          if (nativeEdit) {
            await Deno.remove(receipt);
            return { restored: false, retainedOutput: paths.output };
          }
          retainedOutput = resolve(
            paths.stateDir,
            "history",
            `quarto-interrupted-${crypto.randomUUID()}.html`,
          );
          await Deno.rename(paths.output, retainedOutput);
        }
      }
      if (!(await fileExists(paths.output))) {
        const staging = resolve(
          paths.stateDir,
          stageName,
          `recovered-${crypto.randomUUID()}.html`,
        );
        await Deno.writeFile(staging, bytes, { createNew: true });
        await Deno.link(staging, paths.output);
        await Deno.remove(staging);
      }
    }
    await Deno.remove(receipt);
    return { restored: run.backupHash !== null, retainedOutput };
  });
}
