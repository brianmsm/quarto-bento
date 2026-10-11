import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevelopmentPackage } from "../scripts/package.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const decoder = new TextDecoder();
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
  } catch (error) {
    assert(String(error).includes(message), String(error));
    return;
  }
  throw new Error(`expected ${message}`);
}
async function digest(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.test("portable payload is deterministic, complete and refuses existing destinations", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-package-" });
  try {
    const first = resolve(directory, "one");
    const second = resolve(directory, "two");
    const a = await buildDevelopmentPackage({ destination: first });
    const b = await buildDevelopmentPackage({ destination: second });
    assert(JSON.stringify(a) === JSON.stringify(b));
    assert(
      await Deno.readTextFile(resolve(first, "manifest.json")) ===
        await Deno.readTextFile(resolve(second, "manifest.json")),
    );
    assert(a.files.some((f) => f.path === "runtime/vendor/bento/LICENSE"));
    assert(
      a.files.some((f) =>
        f.path === "runtime/vendor/bento/THIRD_PARTY_NOTICES.md"
      ),
    );
    assert(a.files.some((f) => f.path === "runtime/_extensions/qbento/pre.ts"));
    assert(
      !a.files.some((f) =>
        /(?:^|\/)(\.git|node_modules|\.qbento|fixtures)(?:\/|$)/.test(f.path)
      ),
    );
    for (const file of a.files) {
      const bytes = await Deno.readFile(resolve(first, file.path));
      assert(
        bytes.length === file.bytes && await digest(bytes) === file.sha256,
        file.path,
      );
      if (Deno.build.os !== "windows") {
        assert(
          ((await Deno.stat(resolve(first, file.path))).mode! &
            0o777) === (file.executable ? 0o755 : 0o644),
        );
      }
    }
    await Deno.writeTextFile(resolve(first, "user.txt"), "retain this");
    await rejects(
      () => buildDevelopmentPackage({ destination: first }),
      "AlreadyExists",
    );
    assert(
      await Deno.readTextFile(resolve(first, "user.txt")) === "retain this",
    );
    await rejects(
      () =>
        buildDevelopmentPackage({
          destination: resolve(root, "src", "bad-package"),
        }),
      "UNSAFE_PACKAGE_DESTINATION",
    );
    // A relocated source fixture lets us exercise refusal without changing checkout inputs.
    const sourceRoot = resolve(first, "runtime");
    await Deno.mkdir(resolve(sourceRoot, "bin"));
    await Deno.mkdir(resolve(sourceRoot, "docs"));
    await Deno.copyFile(
      resolve(first, "bin/qbento"),
      resolve(sourceRoot, "bin/qbento"),
    );
    await Deno.copyFile(
      resolve(first, "bin/qbento.cmd"),
      resolve(sourceRoot, "bin/qbento.cmd"),
    );
    await Deno.copyFile(
      resolve(first, "PACKAGING.md"),
      resolve(sourceRoot, "docs/PACKAGING.md"),
    );
    const shell = resolve(sourceRoot, "vendor/bento/shell.html");
    await Deno.writeTextFile(shell, "tampered shell");
    await rejects(
      () =>
        buildDevelopmentPackage({
          destination: resolve(directory, "tampered"),
          sourceRoot,
        }),
      "BENTO_PIN_MISMATCH",
    );
    try {
      await Deno.lstat(resolve(directory, "tampered"));
      throw new Error("failed build published destination");
    } catch (error) {
      assert(error instanceof Deno.errors.NotFound);
    }
    if (Deno.build.os !== "windows") {
      await Deno.remove(shell);
      await Deno.symlink(
        resolve(second, "runtime/vendor/bento/shell.html"),
        shell,
      );
      await rejects(
        () =>
          buildDevelopmentPackage({
            destination: resolve(directory, "linked"),
            sourceRoot,
          }),
        "UNSAFE_PACKAGE_INPUT",
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test({
  name:
    "relocated Unix launcher renders and installs offline with a fresh cache and source reads denied",
  ignore: Deno.build.os !== "linux",
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-package-live-",
    });
    try {
      const built = resolve(directory, "built");
      const distribution = resolve(directory, "portable distribution");
      await buildDevelopmentPackage({ destination: built });
      await Deno.rename(built, distribution);
      const project = resolve(directory, "project with spaces");
      await Deno.mkdir(project);
      const source = resolve(project, "slides with spaces.qmd");
      await Deno.writeTextFile(
        source,
        "## Portable {#portable}\n\n::: {#finding}\nOffline source content.\n:::\n",
      );
      const sourceBytes = await Deno.readFile(source);
      // Reject accidental source-asset reads by the packaged CLI. Module imports
      // resolve exclusively inside the relocated runtime, whose inventory is checked above.
      const shimDir = resolve(directory, "deno shim");
      await Deno.mkdir(shimDir);
      const quote = (s: string) => {
        return "'" + s.replaceAll("'", "'\\''") + "'";
      };
      await Deno.writeTextFile(
        resolve(shimDir, "deno"),
        `#!/bin/sh\nset -eu\nif [ "$1" = run ]; then\n  shift\n  exec ${
          quote(Deno.execPath())
        } run ${
          quote(`--deny-read=${root.replace(/\/$/, "")}`)
        } "$@"\nfi\nexec ${quote(Deno.execPath())} "$@"\n`,
        { mode: 0o755 },
      );
      const launcher = resolve(distribution, "bin/qbento");
      const env = {
        DENO_DIR: resolve(directory, "fresh deno cache"),
        PATH: `${shimDir}:${Deno.env.get("PATH")}`,
        QUARTO_RUN_NO_NETWORK: "true",
      };
      const command = async (args: string[], executable = launcher) => {
        const result = await new Deno.Command(executable, {
          args,
          cwd: project,
          env,
          stdout: "piped",
          stderr: "piped",
        }).output();
        return {
          ...result,
          text: decoder.decode(result.stdout),
          error: decoder.decode(result.stderr),
        };
      };
      await Deno.writeTextFile(
        resolve(project, "deno.json"),
        '{"imports":{"node:path":"https://invalid.example/forbidden.ts"}}\n',
      );
      const doctor = await command(["doctor"]);
      assert(doctor.success, doctor.error);
      const versions = JSON.parse(doctor.text);
      assert(
        versions.deno === Deno.version.deno &&
          versions.quarto !== "unavailable",
      );
      const render = await command(["render", "slides with spaces.qmd"]);
      assert(render.success, render.error);
      const rendered = JSON.parse(render.text);
      const output = resolve(project, "slides with spaces.bento.html");
      assert(rendered.output === output && rendered.pending === 0);
      const validate = await command(["validate", output]);
      assert(validate.success, validate.error);
      assert(JSON.parse(validate.text).docId === rendered.docId);
      assert(
        await digest(sourceBytes) === await digest(await Deno.readFile(source)),
      );
      const failure = await command(["command-that-does-not-exist"]);
      assert(
        !failure.success && failure.code === 1 &&
          failure.error.includes("UNKNOWN_COMMAND"),
      );
      await Deno.remove(resolve(project, "deno.json"));
      const init = await command(["init", "slides with spaces.qmd"]);
      assert(init.success, init.error);
      assert(
        (await Deno.stat(
          resolve(project, "_extensions/qbento/runtime/vendor/bento/LICENSE"),
        )).isFile,
      );
      // The installed project is self-contained even after the portable runtime is removed.
      await Deno.remove(distribution, { recursive: true });
      // Quarto 1.10.19 splits extension hook paths containing spaces. Keep
      // launcher/path coverage above, then validate ordinary integration in its
      // currently supported project-directory form without changing the QMD name.
      const ordinaryProject = resolve(directory, "ordinary-project");
      await Deno.remove(output);
      await Deno.rename(project, ordinaryProject);
      const ordinary = await new Deno.Command("quarto", {
        args: ["render", "slides with spaces.qmd"],
        cwd: ordinaryProject,
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(ordinary.success, decoder.decode(ordinary.stderr));
      const html = await Deno.readTextFile(
        resolve(ordinaryProject, "slides with spaces.bento.html"),
      );
      assert(
        html.includes(rendered.docId) &&
          html.includes("Offline source content."),
      );
      assert(
        await digest(sourceBytes) ===
          await digest(
            await Deno.readFile(
              resolve(ordinaryProject, "slides with spaces.qmd"),
            ),
          ),
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});
