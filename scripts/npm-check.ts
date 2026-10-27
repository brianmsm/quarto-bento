/** Real local tarball installation; no registry publication or global config writes. */
import { basename, join } from "node:path";
import { buildNpmPackage } from "./npm-package.ts";
import type { BentoDoc, ProjectState } from "../src/state/types.ts";

const decoder = new TextDecoder();
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`NPM_SMOKE_FAILED: ${message}`);
}
async function command(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) {
  const result = await new Deno.Command(executable, {
    args,
    cwd,
    env,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: result.success,
    code: result.code,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}
function json<T>(
  output: Awaited<ReturnType<typeof command>>,
  label: string,
): T {
  assert(output.success, `${label}: ${output.stderr}\n${output.stdout}`);
  return JSON.parse(output.stdout);
}
async function hash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
}
interface Snapshot {
  docId: string;
  revision: number;
  deck: BentoDoc;
  pending: ProjectState["pending"];
}
function finding(snapshot: Snapshot) {
  const element = snapshot.deck.slides.find((s) => s.id === "npm")?.elements
    .find((e) => e.id === "finding/paragraph:1");
  assert(element, "authored element missing");
  return element;
}

export async function npmCheck() {
  assert(
    Deno.build.os === "linux",
    "npm CLI qualification currently covers Linux",
  );
  const temporary = await Deno.makeTempDir({ prefix: "qbento-npm-smoke-" });
  try {
    const stage = join(temporary, "staged package");
    const manifest = await buildNpmPackage({ destination: stage });
    const config = join(temporary, "empty npmrc");
    await Deno.writeTextFile(config, "");
    const env = {
      NPM_CONFIG_USERCONFIG: config,
      NPM_CONFIG_GLOBALCONFIG: join(temporary, "unused global npmrc"),
      NPM_CONFIG_CACHE: join(temporary, "npm cache"),
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      DENO_DIR: join(temporary, "fresh Deno cache"),
      XDG_CACHE_HOME: join(temporary, "fresh Quarto cache"),
      QUARTO_RUN_NO_NETWORK: "true",
      QBENTO_INTERNAL_RENDER: "0",
    };
    const packed = json<{
      filename: string;
      files: { path: string }[];
    }[]>(
      await command(
        "npm",
        [
          "pack",
          "--offline",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          temporary,
        ],
        stage,
        env,
      ),
      "npm pack",
    );
    assert(packed.length === 1, "expected one tarball");
    const expected = [
      "package.json",
      "README.md",
      "LICENSE",
      "bin/qbento-npm.mjs",
      "distribution/manifest.json",
      ...manifest.files.map((file) => `distribution/${file.path}`),
    ].sort();
    assert(
      JSON.stringify(packed[0].files.map((file) => file.path).sort()) ===
        JSON.stringify(expected),
      "tarball inventory differs from explicit payload",
    );
    const tarball = join(temporary, packed[0].filename);
    const prefix = join(temporary, "initial prefix");
    const installed = await command(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        tarball,
      ],
      temporary,
      env,
    );
    assert(installed.success, `npm install: ${installed.stderr}`);
    const relocated = join(temporary, "relocated npm prefix β");
    await Deno.rename(prefix, relocated);
    const packageRoot = join(
      relocated,
      "lib/node_modules/@brianmsm/quarto-bento",
    );
    for (const file of manifest.files) {
      const bytes = await Deno.readFile(
        join(packageRoot, "distribution", file.path),
      );
      assert(
        bytes.length === file.bytes && await hash(bytes) === file.sha256,
        `installed payload differs: ${file.path}`,
      );
    }
    const metadata = JSON.parse(
      await Deno.readTextFile(join(packageRoot, "package.json")),
    );
    assert(
      !metadata.private && !metadata.scripts && !metadata.dependencies,
      "installed package gained private guard, hooks or dependencies",
    );
    const caller = join(temporary, "authored caller β with spaces");
    await Deno.mkdir(caller);
    await Deno.writeTextFile(
      join(caller, "deno.json"),
      JSON.stringify({
        imports: { "node:path": "https://invalid.example/not-permitted.ts" },
      }),
    );
    const launcher = join(relocated, "bin/qbento");
    const cli = (args: string[], cwd = caller) =>
      command(launcher, args, cwd, env);
    const version = await cli(["--version"]);
    assert(
      version.success && version.stdout.trim() === `qbento ${metadata.version}`,
      "version failed",
    );
    const doctor = json<{ deno: string; quarto: string; os: string }>(
      await cli(["doctor"]),
      "doctor",
    );
    assert(
      doctor.deno === "2.9.8" && doctor.quarto === "1.10.19",
      "current 0.2.0 qualification baseline differs",
    );
    const sourceName = "deck café with spaces.qmd";
    let source = join(caller, sourceName);
    const original =
      "## npm café {#npm}\r\n\r\n::: {#finding}\r\nOriginal authored text.\r\n:::\r\n";
    await Deno.writeTextFile(source, original);
    const rendered = json<{ output: string; docId: string }>(
      await cli(["render", sourceName]),
      "render",
    );
    const valid = json<{ valid: boolean; docId: string }>(
      await cli(["validate", basename(rendered.output)]),
      "validate",
    );
    assert(
      valid.valid && valid.docId === rendered.docId,
      "invalid installed render",
    );
    const before = json<Snapshot>(await cli(["get", sourceName]), "get");
    finding(before);
    const patchName = "pending edit.json";
    await Deno.writeTextFile(
      join(caller, patchName),
      JSON.stringify({
        version: 1,
        docId: before.docId,
        expectedRevision: before.revision,
        operations: [{
          op: "element.patch",
          slideId: "npm",
          elementId: "finding/paragraph:1",
          fields: { x: 137, fontSize: 28, html: "Saved draft: café." },
        }],
      }),
    );
    const saved = json<Snapshot>(
      await cli(["patch", sourceName, patchName]),
      "patch",
    );
    assert(saved.pending.length === 1, "pending authored edit missing");
    assert(await Deno.readTextFile(source) === original, "save changed source");
    const rebuilt = join(temporary, "rebuilt source and state β");
    await Deno.mkdir(join(rebuilt, ".qbento"), { recursive: true });
    await Deno.copyFile(source, join(rebuilt, sourceName));
    for (const file of ["project.json", "state.json"]) {
      await Deno.copyFile(
        join(caller, ".qbento", file),
        join(rebuilt, ".qbento", file),
      );
    }
    await Deno.remove(caller, { recursive: true });
    await Deno.remove(stage, { recursive: true });
    env.DENO_DIR = join(temporary, "second fresh Deno cache");
    source = join(rebuilt, sourceName);
    await cli(["render", sourceName], rebuilt).then((out) => {
      assert(out.success, `rebuild: ${out.stderr}`);
    });
    const restored = json<Snapshot>(
      await cli(["get", sourceName], rebuilt),
      "rebuilt get",
    );
    const element = finding(restored);
    assert(
      restored.docId === rendered.docId && restored.pending.length === 1 &&
        element.x === 137 && element.fontSize === 28 &&
        element.html === "Saved draft: café.",
      "state-only reconstruction lost identity, pending content or visual design",
    );
    assert(await Deno.readTextFile(source) === original, "rebuild changed QMD");
    const sibling = "other.qmd";
    await Deno.writeTextFile(
      join(rebuilt, sibling),
      "## Other\n\nDifferent source.\n",
    );
    for (const operation of ["status", "diff", "get", "edit"]) {
      const refused = await cli([operation, sibling], rebuilt);
      assert(
        refused.code === 1 &&
          refused.stderr.includes("PROJECT_SOURCE_MISMATCH"),
        `${operation} adopted a sibling source`,
      );
    }
    const selectionName = "selected sync.json";
    await Deno.writeTextFile(
      join(rebuilt, selectionName),
      JSON.stringify({
        version: 1,
        docId: restored.docId,
        expectedRevision: restored.revision,
        selectedChangeIds: [restored.pending[0].id],
      }),
    );
    const plan = json<{ selectedChangeIds: string[] }>(
      await cli(["sync", sourceName, "--select", selectionName], rebuilt),
      "installed selective sync preview",
    );
    assert(
      plan.selectedChangeIds[0] === restored.pending[0].id,
      "wrong selection",
    );
    await Deno.writeTextFile(join(rebuilt, "plan.json"), JSON.stringify(plan));
    const receipt = json<{ pendingRetained: boolean; renderNeeded: boolean }>(
      await cli(["sync", sourceName, "--apply", "plan.json"], rebuilt),
      "installed selective sync apply",
    );
    assert(
      receipt.pendingRetained && receipt.renderNeeded,
      "sync receipt differs",
    );
    assert(
      (json<Snapshot>(await cli(["get", sourceName], rebuilt), "post-sync get"))
        .pending.length === 1,
      "sync prematurely cleared pending content",
    );
    json(await cli(["render", sourceName], rebuilt), "post-sync render");
    const completed = json<Snapshot>(
      await cli(["get", sourceName], rebuilt),
      "completed get",
    );
    assert(
      completed.docId === restored.docId && completed.pending.length === 0 &&
        finding(completed).x === 137 &&
        finding(completed).html === "Saved draft: café.",
      "installed sync/render lost identity, content or retained design",
    );
    const invalid = await cli(["unknown-npm-smoke-command"], rebuilt);
    assert(
      invalid.code === 1 && invalid.stderr.includes("UNKNOWN_COMMAND"),
      "failure status lost",
    );
    return {
      os: doctor.os,
      deno: doctor.deno,
      quarto: doctor.quarto,
      package: `${metadata.name}@${metadata.version}`,
      tarballFiles: expected.length,
      verifiedRuntimeFiles: manifest.files.length,
      npmInstall: "offline tarball, isolated prefix, relocated launcher",
      cli:
        "version/doctor/render/validate/get/patch/selected-sync and sibling-source refusals",
      rebuild: "QMD plus project/state; no previous HTML or staging directory",
      pendingBeforeSync: restored.pending.length,
      pendingAfterVerifiedSync: completed.pending.length,
      registryPublication: false,
    };
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}
if (import.meta.main) console.log(JSON.stringify(await npmCheck(), null, 2));
