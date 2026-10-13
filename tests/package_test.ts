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
async function copyTree(source: string, destination: string) {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = resolve(source, entry.name);
    const to = resolve(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
    else throw new Error(`unexpected fixture entry ${from}`);
  }
}
async function sourceFixture(destination: string) {
  for (const tree of ["src", "vendor", "_extensions"]) {
    await copyTree(resolve(root, tree), resolve(destination, tree));
  }
  await Deno.copyFile(
    resolve(root, "LICENSE"),
    resolve(destination, "LICENSE"),
  );
  await Deno.mkdir(resolve(destination, "bin"), { recursive: true });
  await Deno.copyFile(
    resolve(root, "bin/qbento"),
    resolve(destination, "bin/qbento"),
  );
  await Deno.copyFile(
    resolve(root, "bin/qbento.cmd"),
    resolve(destination, "bin/qbento.cmd"),
  );
  await Deno.mkdir(resolve(destination, "docs"), { recursive: true });
  await Deno.copyFile(
    resolve(root, "docs/PORTABLE_USAGE.md"),
    resolve(destination, "docs/PORTABLE_USAGE.md"),
  );
}
async function runGit(cwd: string, args: string[]) {
  const result = await new Deno.Command("git", {
    args: ["-C", cwd, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${decoder.decode(result.stderr)}`,
    );
  }
  return decoder.decode(result.stdout).trim();
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
    const projectLicense = await Deno.readTextFile(resolve(root, "LICENSE"));
    for (const path of ["LICENSE", "runtime/LICENSE"]) {
      assert(a.files.some((file) => file.path === path));
      assert(await Deno.readTextFile(resolve(first, path)) === projectLicense);
    }
    assert(
      a.files.some((f) =>
        f.path === "runtime/vendor/bento/THIRD_PARTY_NOTICES.md"
      ),
    );
    assert(
      a.files.some((f) => f.path === "runtime/vendor/bento/FONT_NOTICES.md"),
    );
    assert(
      a.files.some((f) =>
        f.path ===
          "runtime/vendor/bento/font-licenses/fraunces-OFL.txt"
      ),
    );
    assert(
      a.files.some((f) =>
        f.path ===
          "runtime/vendor/bento/font-licenses/instrument-sans-OFL.txt"
      ),
    );
    assert(a.files.some((f) => f.path === "runtime/_extensions/qbento/pre.ts"));
    assert(
      a.files.some((f) =>
        f.path === "runtime/vendor/bento/runtime-dependencies.json"
      ),
    );
    assert(a.files.some((f) =>
      f.path ===
        "runtime/vendor/bento/provenance/slides.package-lock.json"
    ));
    assert(
      a.files.some((f) =>
        f.path === "runtime/vendor/bento/provenance/slides.package.json"
      ),
    );
    assert(a.bento.runtimeDependencyInventorySha256.length === 64);
    assert(a.bento.runtimeLicenseInventorySha256.length === 64);
    assert(
      a.files.some((f) =>
        f.path === "runtime/vendor/bento/runtime-licenses.json"
      ),
    );
    const dependencyInventory = JSON.parse(
      await Deno.readTextFile(
        resolve(first, "runtime/vendor/bento/runtime-dependencies.json"),
      ),
    );
    assert(dependencyInventory.runtimePackages.length === 25);
    assert(
      dependencyInventory.rootDependencies.map((item: { name: string }) =>
        item.name
      ).join(",") === "moveable,reveal.js,selecto",
    );
    assert(
      dependencyInventory.noticeReview.status ===
        "font-texts-pinned-review-incomplete",
    );
    assert(
      dependencyInventory.embeddedFonts.map((item: { asset: string }) =>
        item.asset
      ).join(",") === "FRAUNCES_900,INSTRUMENT_VAR",
    );
    assert(
      dependencyInventory.embeddedFonts.map((item: { assetSha256: string }) =>
        item.assetSha256
      ).join(",") ===
        "628051c1bd196ee82e88cb02015e46b8fc30f505215b424d29627ec613395a0d,6219bc4bfdfc5d9b2201dcdf046218b122a758f932e25ed5f168f929b7ca2311",
    );
    assert(
      dependencyInventory.embeddedFonts.every((item: { version: unknown }) =>
        item.version === null
      ),
    );
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
      resolve(sourceRoot, "docs/PORTABLE_USAGE.md"),
    );
    const tamperedFiles = [
      "vendor/bento/shell.html",
      "vendor/bento/slides.schema.json",
      "vendor/bento/LICENSE",
      "vendor/bento/THIRD_PARTY_NOTICES.md",
      "vendor/bento/FONT_NOTICES.md",
      "vendor/bento/font-licenses/fraunces-OFL.txt",
      "vendor/bento/font-licenses/instrument-sans-OFL.txt",
      "vendor/bento/provenance/slides.package.json",
      "vendor/bento/provenance/slides.package-lock.json",
      "vendor/bento/runtime-dependencies.json",
      "vendor/bento/runtime-licenses.json",
    ];
    for (const [index, relativePath] of tamperedFiles.entries()) {
      const target = resolve(sourceRoot, relativePath);
      const original = await Deno.readFile(target);
      const changed = new Uint8Array(original.length + 1);
      changed.set(original);
      changed[original.length] = 0;
      await Deno.writeFile(target, changed);
      const destination = resolve(directory, `tampered-${index}`);
      await rejects(
        () => buildDevelopmentPackage({ destination, sourceRoot }),
        "BENTO_PIN_MISMATCH",
      );
      try {
        await Deno.lstat(destination);
        throw new Error(
          `failed build published destination for ${relativePath}`,
        );
      } catch (error) {
        assert(error instanceof Deno.errors.NotFound);
      }
      await Deno.writeFile(target, original);
    }
    const pinPath = resolve(sourceRoot, "vendor/bento/pin.json");
    const originalPin = await Deno.readTextFile(pinPath);
    const changedPin = JSON.parse(originalPin);
    changedPin.runtimeDependencyInventory.sha256 = "0".repeat(64);
    await Deno.writeTextFile(pinPath, JSON.stringify(changedPin));
    await rejects(
      () =>
        buildDevelopmentPackage({
          destination: resolve(directory, "tampered-pin"),
          sourceRoot,
        }),
      "BENTO_PIN_MISMATCH",
    );
    await Deno.writeTextFile(pinPath, originalPin);
    const shell = resolve(sourceRoot, "vendor/bento/shell.html");
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

Deno.test("portable license inventory refuses repinned false identities, altered text and hidden gaps", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-license-package-",
  });
  try {
    const sourceRoot = resolve(directory, "source");
    await sourceFixture(sourceRoot);
    const inventoryPath = resolve(
      sourceRoot,
      "vendor/bento/runtime-licenses.json",
    );
    const pinPath = resolve(sourceRoot, "vendor/bento/pin.json");
    const original = await Deno.readTextFile(inventoryPath);
    const originalPin = await Deno.readTextFile(pinPath);
    for (
      const scenario of [
        "identity",
        "text",
        "gap",
        "integrity",
        "range",
        "count",
      ]
    ) {
      const licenses = JSON.parse(original);
      if (scenario === "identity") licenses.packages[0].name = "forged-package";
      if (scenario === "count") licenses.packages.pop();
      if (scenario === "text") licenses.packages[0].texts[0].text += "changed";
      if (scenario === "gap") licenses.missingFullLicenseTexts = [];
      if (scenario === "integrity") {
        licenses.packages[0].integrity = "sha512-forged";
      }
      if (scenario === "range") {
        licenses.packages[0].texts[0].sources[0].startByte = -1;
      }
      const changed = new TextEncoder().encode(JSON.stringify(licenses));
      const pin = JSON.parse(originalPin);
      pin.runtimeLicenseInventory.sha256 = await digest(changed);
      await Deno.writeFile(inventoryPath, changed);
      await Deno.writeTextFile(pinPath, JSON.stringify(pin));
      const destination = resolve(directory, scenario);
      await rejects(
        () => buildDevelopmentPackage({ sourceRoot, destination }),
        "BENTO_PIN_MISMATCH",
      );
      await rejects(() => Deno.stat(destination), "NotFound");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("portable manifest records exact Git provenance or explicit unknown state", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-package-provenance-",
  });
  try {
    const checkout = resolve(directory, "git source with spaces");
    await sourceFixture(checkout);
    await runGit(checkout, ["init", "--quiet"]);
    await runGit(checkout, ["add", "-A"]);
    await runGit(checkout, [
      "-c",
      "user.name=qbento packaging test",
      "-c",
      "user.email=qbento-packaging@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture baseline",
    ]);
    const commit = await runGit(checkout, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ]);
    const clean = await buildDevelopmentPackage({
      destination: resolve(directory, "clean package"),
      sourceRoot: checkout,
    });
    assert(clean.schemaVersion === 2);
    assert(clean.qbentoSource.kind === "git");
    if (clean.qbentoSource.kind === "git") {
      assert(clean.qbentoSource.commit === commit);
      assert(clean.qbentoSource.dirty === false);
    }

    const cliPath = resolve(checkout, "src/cli.ts");
    const originalCli = await Deno.readFile(cliPath);
    await Deno.writeTextFile(
      cliPath,
      await Deno.readTextFile(cliPath) + "\n// dirty fixture\n",
    );
    const dirty = await buildDevelopmentPackage({
      destination: resolve(directory, "dirty package"),
      sourceRoot: checkout,
    });
    assert(dirty.qbentoSource.kind === "git");
    if (dirty.qbentoSource.kind === "git") {
      assert(dirty.qbentoSource.commit === commit);
      assert(dirty.qbentoSource.dirty === true);
    }

    await Deno.writeFile(cliPath, originalCli);
    const untrackedPath = resolve(checkout, "src/untracked-provenance.ts");
    await Deno.writeTextFile(untrackedPath, "// untracked fixture\n");
    const untracked = await buildDevelopmentPackage({
      destination: resolve(directory, "untracked package"),
      sourceRoot: checkout,
    });
    assert(untracked.qbentoSource.kind === "git");
    if (untracked.qbentoSource.kind === "git") {
      assert(untracked.qbentoSource.commit === commit);
      assert(untracked.qbentoSource.dirty === true);
    }
    await runGit(checkout, ["add", "src/untracked-provenance.ts"]);
    const staged = await buildDevelopmentPackage({
      destination: resolve(directory, "staged package"),
      sourceRoot: checkout,
    });
    assert(staged.qbentoSource.kind === "git");
    if (staged.qbentoSource.kind === "git") {
      assert(staged.qbentoSource.commit === commit);
      assert(staged.qbentoSource.dirty === true);
    }

    const archive = resolve(directory, "archive without git metadata");
    await sourceFixture(archive);
    const unknown = await buildDevelopmentPackage({
      destination: resolve(directory, "archive package"),
      sourceRoot: archive,
    });
    assert(unknown.qbentoSource.kind === "unknown");
    if (unknown.qbentoSource.kind === "unknown") {
      assert(unknown.qbentoSource.reason === "not-a-git-checkout");
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
        XDG_CACHE_HOME: resolve(directory, "fresh quarto cache"),
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
      assert(
        await Deno.readTextFile(
          resolve(project, "_extensions/qbento/runtime/LICENSE"),
        ) ===
          await Deno.readTextFile(resolve(root, "LICENSE")),
      );
      // The installed project is self-contained even after the portable runtime is removed.
      await Deno.remove(distribution, { recursive: true });
      // Fixed project-relative hooks retain ordinary rendering in a path with
      // spaces, even after the portable distribution has been removed.
      const ordinaryProject = resolve(directory, "relocated ordinary project");
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
