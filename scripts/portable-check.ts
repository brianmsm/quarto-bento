/** Local, authored-only smoke; installers and hosted runners are a separate CI step. */
import { basename, join, resolve } from "node:path";
import { buildDevelopmentPackage } from "./package.ts";
import type { BentoDoc, ProjectState } from "../src/state/types.ts";

const decoder = new TextDecoder();
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`PORTABLE_SMOKE_FAILED: ${message}`);
}
function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
/** Only bounded smoke arguments, not a general cmd.exe escaping API. */
export function windowsBatchArguments(executable: string, args: string[]) {
  const tokens = [executable, ...args];
  for (const token of tokens) {
    // Percent expansion still happens inside quotes. Reject shell syntax instead
    // of interpreting it; all smoke arguments are controlled filenames/commands.
    if (
      !token || /["%!&|<>^]/.test(token) || token.endsWith("\\") ||
      [...token].some((c) =>
        c.codePointAt(0)! < 0x20 || c.codePointAt(0) === 0x7f
      )
    ) {
      throw new Error("UNSAFE_SMOKE_ARGUMENT: unsupported Windows batch token");
    }
  }
  // /s removes the enclosing pair, leaving a quoted executable and each argument.
  return [
    "/d",
    "/s",
    "/v:off",
    "/c",
    '"' + tokens.map((t) => '"' + t + '"').join(" ") + '"',
  ];
}
async function command(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  batch = false,
) {
  const output = await new Deno.Command(
    batch ? Deno.env.get("COMSPEC") ?? "cmd.exe" : executable,
    {
      args: batch ? windowsBatchArguments(executable, args) : args,
      windowsRawArguments: batch,
      cwd,
      env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    },
  ).output();
  return {
    success: output.success,
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}
type Output = Awaited<ReturnType<typeof command>>;
function json<T>(output: Output, label: string): T {
  assert(
    output.success,
    `${label}: exit ${output.code}\n${output.stderr}\n${output.stdout}`,
  );
  try {
    return JSON.parse(output.stdout);
  } catch {
    throw new Error(
      `PORTABLE_SMOKE_FAILED: ${label} did not emit JSON: ${output.stdout}`,
    );
  }
}
interface Snapshot {
  docId: string;
  revision: number;
  deck: BentoDoc;
  pending: ProjectState["pending"];
}
function finding(snapshot: Snapshot) {
  const slide = snapshot.deck.slides.find((item) => item.id === "portable");
  const element = slide?.elements.find((item) =>
    item.id === "finding/paragraph:1"
  );
  assert(element, "stable authored finding element is missing");
  return element;
}
function pendingSignature(pending: Snapshot["pending"]) {
  return JSON.stringify(
    pending.map(({ source: _observedSource, ...change }) => change),
  );
}
function retained(snapshot: Snapshot, docId: string, pending: string) {
  const element = finding(snapshot);
  assert(snapshot.docId === docId, "docId changed after rebuild");
  assert(
    element.x === 137 && element.fontSize === 28,
    "saved visual override lost",
  );
  assert(element.html === "Saved draft: café.", "saved authored edit lost");
  assert(
    pendingSignature(snapshot.pending) === pending,
    "pending edit changed or disappeared",
  );
  for (const change of snapshot.pending) {
    assert(
      !change.source ||
        JSON.stringify(change.source) === JSON.stringify(change.before),
      "rebuild did not observe the unchanged authored baseline",
    );
  }
}
async function unchanged(source: string, bytes: Uint8Array) {
  assert(
    sameBytes(await Deno.readFile(source), bytes),
    "QMD bytes changed without sync",
  );
}

/** Runs only in its own fresh temporary directory and removes it on completion. */
export async function portableCheck() {
  assert(
    ["linux", "darwin", "windows"].includes(Deno.build.os),
    "unsupported smoke OS",
  );
  assert(
    Deno.version.deno === "2.9.6",
    "install Deno 2.9.6 before running this pinned smoke",
  );
  const directory = await Deno.makeTempDir({
    prefix: "qbento-portable-smoke-",
  });
  try {
    const built = join(directory, "built");
    const distribution = join(directory, "portable distribution with spaces");
    const manifest = await buildDevelopmentPackage({ destination: built });
    await Deno.rename(built, distribution);
    const env = {
      DENO_DIR: join(directory, "fresh deno cache"),
      XDG_CACHE_HOME: join(directory, "fresh quarto cache"),
      QUARTO_RUN_NO_NETWORK: "true",
      QBENTO_INTERNAL_RENDER: "0",
    };
    const project = join(directory, "authored project with spaces");
    await Deno.mkdir(project);
    const sourceName = "slides with spaces.qmd";
    let source = join(project, sourceName);
    // No chunk, language engine, package, external asset, font or remote input.
    await Deno.writeTextFile(
      source,
      "## Portable café {#portable}\r\n\r\n::: {#finding}\r\nOffline authored content.\r\n:::\r\n",
    );
    const original = await Deno.readFile(source);
    const launcher = join(
      distribution,
      "bin",
      Deno.build.os === "windows" ? "qbento.cmd" : "qbento",
    );
    const cli = (args: string[], cwd = project) =>
      command(launcher, args, cwd, env, Deno.build.os === "windows");
    // The launchers must ignore caller Deno configuration, even with an empty cache.
    await Deno.writeTextFile(
      join(project, "deno.json"),
      JSON.stringify({
        imports: { "node:path": "https://invalid.example/forbidden.ts" },
      }),
    );
    const doctor = json<Record<string, string>>(
      await cli(["doctor"]),
      "doctor",
    );
    assert(
      doctor.deno === "2.9.6" && doctor.quarto === "1.10.19" &&
        doctor.os === Deno.build.os,
      "doctor requires installed Deno 2.9.6 and Quarto 1.10.19",
    );
    const initial = json<{ output: string; docId: string; pending: number }>(
      await cli(["render", sourceName]),
      "render",
    );
    assert(
      initial.output === source.replace(/\.qmd$/, ".bento.html") &&
        initial.pending === 0,
      "initial render output or pending count differs",
    );
    const valid = json<{ valid: boolean; docId: string }>(
      await cli(["validate", basename(initial.output)]),
      "validate",
    );
    assert(
      valid.valid && valid.docId === initial.docId,
      "rendered deck is invalid",
    );
    await unchanged(source, original);
    const unknown = await cli(["unknown-smoke-command"]);
    assert(
      unknown.code === 1 && unknown.stderr.includes("UNKNOWN_COMMAND"),
      "launcher lost failure exit status",
    );
    const before = json<Snapshot>(await cli(["get", sourceName]), "get");
    finding(before);
    const patchName = "approved visual and pending patch.json";
    await Deno.writeTextFile(
      join(project, patchName),
      JSON.stringify({
        version: 1,
        docId: before.docId,
        expectedRevision: before.revision,
        operations: [{
          op: "element.patch",
          slideId: "portable",
          elementId: "finding/paragraph:1",
          fields: { x: 137, fontSize: 28, html: "Saved draft: café." },
        }],
      }),
    );
    const saved = json<Snapshot & { sourceUnchanged: boolean }>(
      await cli(["patch", sourceName, patchName]),
      "patch",
    );
    assert(
      saved.sourceUnchanged && saved.pending.length === 1,
      "save did not retain one pending authored edit",
    );
    const pending = pendingSignature(saved.pending);
    retained(saved, initial.docId, pending);
    await unchanged(source, original);

    // Reconstruct a clean checkout using only QMD and durable state, without old
    // HTML, execution output, history, extension or the original project paths.
    const rebuilt = join(directory, "rebuilt checkout with spaces");
    await Deno.mkdir(join(rebuilt, ".qbento"), { recursive: true });
    await Deno.copyFile(source, join(rebuilt, sourceName));
    for (const file of ["state.json", "project.json"]) {
      await Deno.copyFile(
        join(project, ".qbento", file),
        join(rebuilt, ".qbento", file),
      );
    }
    await Deno.remove(project, { recursive: true });
    source = join(rebuilt, sourceName);
    env.DENO_DIR = join(directory, "second fresh deno cache");
    const rerender = json<{ docId: string; pending: number; output: string }>(
      await cli(["render", sourceName], rebuilt),
      "source + state rebuild",
    );
    assert(
      rerender.docId === initial.docId && rerender.pending === 1,
      "rebuild identity or pending count differs",
    );
    retained(
      json<Snapshot>(await cli(["get", sourceName], rebuilt), "rebuilt get"),
      initial.docId,
      pending,
    );
    assert(
      json<{ valid: boolean }>(
        await cli(["validate", basename(rerender.output)], rebuilt),
        "rebuilt validate",
      ).valid,
      "rebuilt output invalid",
    );
    await unchanged(source, original);
    json(await cli(["init", sourceName], rebuilt), "init");
    await Deno.stat(
      join(
        rebuilt,
        "_extensions",
        "qbento",
        "runtime",
        "vendor",
        "bento",
        "LICENSE",
      ),
    );
    await unchanged(source, original);

    // The installed extension must be self-contained after its project moves
    // and the portable distribution is removed.
    const ordinary = join(directory, "relocated ordinary project with spaces");
    await Deno.rename(rebuilt, ordinary);
    await Deno.remove(distribution, { recursive: true });
    source = join(ordinary, sourceName);
    const output = source.replace(/\.qmd$/, ".bento.html");
    const statePath = join(ordinary, ".qbento", "state.json");
    const stateBefore = await Deno.readFile(statePath);
    const htmlBefore = await Deno.readFile(output);
    if (Deno.build.os === "linux") await Deno.remove(output);
    const ordinaryRender = await command(
      "quarto",
      ["render", sourceName],
      ordinary,
      env,
    );
    let ordinaryResult: string;
    if (Deno.build.os === "linux") {
      assert(
        ordinaryRender.success,
        `ordinary Quarto failed: ${ordinaryRender.stderr}`,
      );
      ordinaryResult = "rendered";
    } else {
      // Keep the Linux-only process-verification guard until native evidence
      // justifies its extension. A silent bypass must fail this smoke.
      assert(
        !ordinaryRender.success &&
          (ordinaryRender.stderr + ordinaryRender.stdout).includes(
            "QUARTO_EXTENSION_PLATFORM",
          ),
        `ordinary Quarto must refuse unsupported platform: ${ordinaryRender.stderr}`,
      );
      assert(
        sameBytes(await Deno.readFile(statePath), stateBefore),
        "ordinary refusal changed saved state",
      );
      assert(
        sameBytes(await Deno.readFile(output), htmlBefore),
        "ordinary refusal changed generated HTML",
      );
      ordinaryResult = "refused: QUARTO_EXTENSION_PLATFORM";
    }
    const installedCli = resolve(
      ordinary,
      "_extensions/qbento/runtime/src/cli.ts",
    );
    const installed = (args: string[]) =>
      command(
        Deno.execPath(),
        [
          "run",
          "--no-config",
          "--no-remote",
          "--no-npm",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env",
          installedCli,
          ...args,
        ],
        ordinary,
        env,
      );
    assert(
      json<{ valid: boolean }>(
        await installed(["validate", basename(output)]),
        "installed validate",
      ).valid,
      "installed runtime could not validate output",
    );
    retained(
      json<Snapshot>(await installed(["get", sourceName]), "installed get"),
      initial.docId,
      pending,
    );
    await unchanged(source, original);
    return {
      os: Deno.build.os,
      deno: doctor.deno,
      quarto: doctor.quarto,
      packageFiles: manifest.files.length,
      bentoRevision: manifest.bento.revision,
      portableCli: "doctor/render/validate/get/patch/init",
      rebuild: "QMD + .qbento/{project.json,state.json}; no previous HTML",
      pending: 1,
      ordinaryQuarto: ordinaryResult,
      verification:
        "authored source, CLI and document/state assertions; no browser or computation engine required",
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
if (import.meta.main) {
  try {
    assert(Deno.args.length === 0, "usage: portable-check.ts (no arguments)");
    console.log(JSON.stringify(await portableCheck(), null, 2));
  } catch (error) {
    console.error(String(error));
    Deno.exitCode = 1;
  }
}
