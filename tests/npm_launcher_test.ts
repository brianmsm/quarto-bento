import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function fixture() {
  const temporary = await Deno.makeTempDir({ prefix: "qbento-npm-launcher-" });
  const location = resolve(temporary, "package with spaces");
  const bin = resolve(location, "bin");
  const nodeResult = await new Deno.Command("node", {
    args: ["-p", "process.execPath"],
    stdout: "piped",
  }).output();
  assert(nodeResult.success, "Node is required for the npm launcher tests");
  const node = new TextDecoder().decode(nodeResult.stdout).trim();
  await Deno.mkdir(bin, { recursive: true });
  const launcher = resolve(bin, "qbento-npm.mjs");
  await Deno.copyFile(resolve(root, "bin/qbento-npm.mjs"), launcher);
  await Deno.writeTextFile(
    resolve(location, "package.json"),
    JSON.stringify({ version: "0.1.0", type: "module" }),
  );
  const links = resolve(temporary, "linked commands");
  await Deno.mkdir(links);
  const linked = resolve(links, "qbento");
  await Deno.symlink(launcher, linked);
  const caller = resolve(temporary, "caller β");
  await Deno.mkdir(caller);
  const fakeBin = resolve(temporary, "fake runtime");
  await Deno.mkdir(fakeBin);
  const deno = resolve(fakeBin, "deno");
  const record = resolve(temporary, "record.json");
  const run = (args: string[], path = fakeBin) =>
    new Deno.Command(node, {
      args: [linked, ...args],
      cwd: caller,
      env: { PATH: path, QBENTO_TEST_RECORD: record },
      stdout: "piped",
      stderr: "piped",
    });
  const fake = async (body: string) => {
    await Deno.writeTextFile(deno, `#!${node}\n${body}\n`);
    await Deno.chmod(deno, 0o755);
  };
  return {
    temporary,
    location,
    node,
    linked,
    caller,
    fakeBin,
    record,
    run,
    fake,
  };
}

Deno.test("npm launcher resolves linked installation, preserves argv/cwd and child status", async () => {
  const f = await fixture();
  try {
    await f.fake(
      `require('node:fs').writeFileSync(process.env.QBENTO_TEST_RECORD, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})); process.exit(37);`,
    );
    const args = [
      "render",
      "deck β with spaces.qmd",
      "$(touch forbidden);'\"?",
    ];
    const result = await f.run(args).output();
    assert(result.code === 37, "child exit status was not preserved");
    const record = JSON.parse(await Deno.readTextFile(f.record));
    assert(record.cwd === f.caller, "caller directory changed");
    const expected = [
      "run",
      "--no-config",
      "--no-remote",
      "--no-npm",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      "--allow-net=127.0.0.1",
      resolve(f.location, "distribution/runtime/src/cli.ts"),
      ...args,
    ];
    assert(
      JSON.stringify(record.args) === JSON.stringify(expected),
      "argv altered",
    );
  } finally {
    await Deno.remove(f.temporary, { recursive: true });
  }
});

Deno.test("npm launcher reports missing Deno and exposes package version without executing it", async () => {
  const f = await fixture();
  try {
    const result = await f.run(["doctor"]).output();
    assert(result.code === 127, "missing runtime must exit 127");
    assert(
      new TextDecoder().decode(result.stderr).includes("QBENTO_DENO_REQUIRED"),
      "missing-runtime diagnostic absent",
    );
    const version = await f.run(["--version"]).output();
    assert(version.success, "version should not require Deno");
    assert(
      new TextDecoder().decode(version.stdout) === "qbento 0.1.0\n",
      "wrong package version",
    );
  } finally {
    await Deno.remove(f.temporary, { recursive: true });
  }
});

Deno.test("npm launcher forwards termination to its long-running child", async () => {
  const f = await fixture();
  let process: Deno.ChildProcess | undefined;
  try {
    await f.fake(
      `require('node:fs').writeFileSync(process.env.QBENTO_TEST_RECORD, 'ready'); setInterval(()=>{},1000);`,
    );
    process = f.run(["edit", "deck.qmd"]).spawn();
    for (let i = 0; i < 100; i++) {
      try {
        if (await Deno.readTextFile(f.record) === "ready") break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert(
      await Deno.readTextFile(f.record) === "ready",
      "child never started",
    );
    process.kill("SIGTERM");
    const result = await process.output();
    process = undefined;
    assert(result.code === 143, "termination signal status was not preserved");
  } finally {
    try {
      process?.kill("SIGTERM");
      await process?.output();
    } catch { /* Already exited. */ }
    await Deno.remove(f.temporary, { recursive: true });
  }
});
