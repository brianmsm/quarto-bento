import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNpmPackage } from "../scripts/npm-package.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
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
async function absent(path: string) {
  try {
    await Deno.lstat(path);
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound, String(error));
    return;
  }
  throw new Error(`unexpected published output ${path}`);
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
function metadata(): Record<string, unknown> {
  return {
    name: "@brianmsm/quarto-bento",
    version: "0.1.0",
    private: true,
    type: "module",
    bin: { qbento: "bin/qbento-npm.mjs" },
    files: ["bin/qbento-npm.mjs", "distribution/**", "README.md", "LICENSE"],
    license: "MIT",
    engines: { node: ">=22" },
    os: ["linux"],
    publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
  };
}
async function fixture(directory: string) {
  for (const tree of ["src", "vendor", "_extensions"]) {
    await copyTree(resolve(root, tree), resolve(directory, tree));
  }
  await Deno.copyFile(resolve(root, "LICENSE"), resolve(directory, "LICENSE"));
  await Deno.mkdir(resolve(directory, "bin"));
  for (const path of ["bin/qbento", "bin/qbento.cmd"]) {
    await Deno.copyFile(resolve(root, path), resolve(directory, path));
  }
  await Deno.writeTextFile(
    resolve(directory, "bin/qbento-npm.mjs"),
    "#!/usr/bin/env node\n// deterministic fixture launcher\n",
  );
  await Deno.mkdir(resolve(directory, "docs"));
  await Deno.copyFile(
    resolve(root, "docs/PORTABLE_USAGE.md"),
    resolve(directory, "docs/PORTABLE_USAGE.md"),
  );
  await Deno.writeTextFile(
    resolve(directory, "docs/NPM_README.md"),
    "# npm CLI\n\nNpm-specific readme with usable published links.\n",
  );
  // Checkout-only documents and arbitrary files must never enter the payload.
  await Deno.writeTextFile(resolve(directory, "README.md"), "checkout readme");
  await Deno.writeTextFile(
    resolve(directory, "secret.txt"),
    "not a package input",
  );
  await Deno.writeTextFile(
    resolve(directory, "package.json"),
    JSON.stringify(metadata(), null, 2) + "\n",
  );
}
async function filesIn(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = prefix + entry.name;
    if (entry.isDirectory) {
      files.push(...await filesIn(resolve(directory, entry.name), path + "/"));
    } else {
      assert(entry.isFile, path);
      files.push(path);
    }
  }
  return files.sort();
}

Deno.test("npm staging is deterministic, guarded and preserves the complete portable payload", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-npm-package-" });
  try {
    const sourceRoot = resolve(directory, "source");
    await fixture(sourceRoot);
    const first = resolve(directory, "first");
    const second = resolve(directory, "second");
    const a = await buildNpmPackage({ sourceRoot, destination: first });
    const b = await buildNpmPackage({ sourceRoot, destination: second });
    assert(JSON.stringify(a) === JSON.stringify(b));
    assert(a.qbentoSource.kind === "unknown");
    const expected = [
      "LICENSE",
      "README.md",
      "package.json",
      "bin/qbento-npm.mjs",
      "distribution/manifest.json",
      ...a.files.map((file) => `distribution/${file.path}`),
    ].sort();
    assert(JSON.stringify(await filesIn(first)) === JSON.stringify(expected));
    assert(JSON.stringify(await filesIn(second)) === JSON.stringify(expected));
    for (const path of expected) {
      const firstBytes = await Deno.readFile(resolve(first, path));
      const secondBytes = await Deno.readFile(resolve(second, path));
      assert(
        firstBytes.length === secondBytes.length &&
          firstBytes.every((byte, index) => byte === secondBytes[index]),
        path,
      );
    }
    const sourceMetadata = JSON.parse(
      await Deno.readTextFile(resolve(sourceRoot, "package.json")),
    );
    const stagedMetadata = JSON.parse(
      await Deno.readTextFile(resolve(first, "package.json")),
    );
    assert(sourceMetadata.private === true);
    assert(!Object.hasOwn(stagedMetadata, "private"));
    delete sourceMetadata.private;
    assert(JSON.stringify(sourceMetadata) === JSON.stringify(stagedMetadata));
    assert(
      await Deno.readTextFile(resolve(first, "README.md")) ===
        await Deno.readTextFile(resolve(sourceRoot, "docs/NPM_README.md")),
    );
    assert(
      await Deno.readTextFile(resolve(first, "bin/qbento-npm.mjs")) ===
        await Deno.readTextFile(resolve(sourceRoot, "bin/qbento-npm.mjs")),
    );
    for (
      const path of [
        "LICENSE",
        "distribution/LICENSE",
        "distribution/runtime/LICENSE",
      ]
    ) {
      assert(
        await Deno.readTextFile(resolve(first, path)) ===
          await Deno.readTextFile(resolve(root, "LICENSE")),
      );
    }
    if (Deno.build.os !== "windows") {
      assert(
        (await Deno.stat(resolve(first, "bin/qbento-npm.mjs"))).mode! & 0o111,
      );
    }
    await Deno.writeTextFile(resolve(first, "user.txt"), "preserve existing");
    await rejects(
      () => buildNpmPackage({ sourceRoot, destination: first }),
      "AlreadyExists",
    );
    assert(
      await Deno.readTextFile(resolve(first, "user.txt")) ===
        "preserve existing",
    );
    await rejects(
      () =>
        buildNpmPackage({
          sourceRoot,
          destination: resolve(sourceRoot, "src/output"),
        }),
      "UNSAFE_PACKAGE_DESTINATION",
    );
    await rejects(
      () =>
        buildNpmPackage({
          sourceRoot,
          destination: resolve(directory, "absent/output"),
        }),
      "NotFound",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("npm staging rejects unsafe metadata, alias inputs and upstream tampering without publishing", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-npm-refusal-" });
  try {
    const sourceRoot = resolve(directory, "source");
    await fixture(sourceRoot);
    const metadataPath = resolve(sourceRoot, "package.json");
    const changes = [
      { bin: { qbento: "../../outside" } },
      { files: ["**"] },
      { dependencies: { surprise: "*" } },
      { optionalDependencies: { surprise: "*" } },
      { scripts: { prepack: "touch /tmp/surprise" } },
      { private: false },
      { name: "different-package" },
      { version: "1.0.0" },
      { os: ["darwin", "win32"] },
      { publishConfig: { access: "public", registry: "https://example.com" } },
      { engines: { node: ">=18" } },
    ];
    for (const [index, change] of changes.entries()) {
      await Deno.writeTextFile(
        metadataPath,
        JSON.stringify({ ...metadata(), ...change }),
      );
      const destination = resolve(directory, `metadata-${index}`);
      await rejects(
        () => buildNpmPackage({ sourceRoot, destination }),
        "UNSAFE_NPM_PACKAGE_INPUT",
      );
      await absent(destination);
    }
    await Deno.writeTextFile(metadataPath, "{not JSON}");
    await rejects(
      () =>
        buildNpmPackage({
          sourceRoot,
          destination: resolve(directory, "malformed"),
        }),
      "UNSAFE_NPM_PACKAGE_INPUT",
    );
    await absent(resolve(directory, "malformed"));
    await Deno.writeTextFile(metadataPath, JSON.stringify(metadata()));
    const readmePath = resolve(sourceRoot, "docs/NPM_README.md");
    const readme = await Deno.readTextFile(readmePath);
    await Deno.remove(readmePath);
    await Deno.symlink(resolve(sourceRoot, "secret.txt"), readmePath);
    await rejects(
      () =>
        buildNpmPackage({
          sourceRoot,
          destination: resolve(directory, "aliased-readme"),
        }),
      "UNSAFE_NPM_PACKAGE_INPUT",
    );
    await absent(resolve(directory, "aliased-readme"));
    await Deno.remove(readmePath);
    await Deno.writeTextFile(readmePath, readme);
    const outside = resolve(directory, "outside");
    await Deno.mkdir(outside);
    await Deno.writeTextFile(resolve(outside, "user.txt"), "retain");
    await Deno.symlink(outside, resolve(directory, "alias"));
    await rejects(
      () =>
        buildNpmPackage({
          sourceRoot,
          destination: resolve(directory, "alias/staged"),
        }),
      "UNSAFE_NPM_PACKAGE_INPUT",
    );
    assert(await Deno.readTextFile(resolve(outside, "user.txt")) === "retain");
    await absent(resolve(outside, "staged"));
    // Reused pin validation refuses tampering and cleans only the new staging tree.
    await Deno.writeTextFile(
      resolve(sourceRoot, "vendor/bento/shell.html"),
      "tampered",
    );
    const destination = resolve(directory, "tampered");
    await rejects(
      () => buildNpmPackage({ sourceRoot, destination }),
      "BENTO_PIN_MISMATCH",
    );
    await absent(destination);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
