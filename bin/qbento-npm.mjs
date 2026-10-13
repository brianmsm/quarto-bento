#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the installed file, not the npm/mise symlink or the caller's cwd.
const packageRoot = resolve(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "..",
);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  const metadata = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  console.log(`qbento ${metadata.version}`);
} else {
  const cli = resolve(packageRoot, "distribution/runtime/src/cli.ts");
  const child = spawn("deno", [
    "run",
    "--no-config",
    "--no-remote",
    "--no-npm",
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env",
    "--allow-net=127.0.0.1",
    cli,
    ...args,
  ], { stdio: "inherit", shell: false });
  const forward = (signal) => {
    try {
      child.kill(signal);
    } catch { /* Child may already have exited. */ }
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.once("error", (error) => {
    if (error.code === "ENOENT") {
      console.error(
        "QBENTO_DENO_REQUIRED: Install Deno and make it available on PATH (tested: 2.9.6). Quarto must also be installed for rendering.",
      );
      process.exitCode = 127;
    } else {
      console.error(`QBENTO_START_FAILED: ${error.message}`);
      process.exitCode = 1;
    }
  });
  child.once("close", (code, signal) => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
    if (signal) {
      process.kill(process.pid, signal);
    } else if (code !== null && process.exitCode === undefined) {
      process.exitCode = code;
    }
  });
}
