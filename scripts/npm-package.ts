import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevelopmentPackage, type PackageManifest } from "./package.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmFiles = [
  "bin/qbento-npm.mjs",
  "distribution/**",
  "README.md",
  "LICENSE",
];
const metadataKeys = new Set([
  "name",
  "version",
  "description",
  "bin",
  "files",
  "license",
  "author",
  "repository",
  "homepage",
  "bugs",
  "keywords",
  "engines",
  "publishConfig",
  "type",
  "private",
  "os",
]);
function fail(message: string): never {
  throw new Error(`UNSAFE_NPM_PACKAGE_INPUT: ${message}`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}
async function realDirectories(directory: string) {
  for (let current = directory;; current = dirname(current)) {
    const info = await Deno.lstat(current);
    if (info.isSymlink || !info.isDirectory) {
      fail(`expected real directory ${current}`);
    }
    if (current === dirname(current)) break;
  }
}
async function regularBytes(path: string) {
  await realDirectories(dirname(path));
  const info = await Deno.lstat(path);
  if (info.isSymlink || !info.isFile) fail(`expected regular file ${path}`);
  return await Deno.readFile(path);
}
function validateMetadata(bytes: Uint8Array) {
  let metadata: unknown;
  try {
    metadata = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("package.json must be valid JSON");
  }
  if (!isRecord(metadata)) fail("package.json must be an object");
  for (const key of Object.keys(metadata)) {
    if (!metadataKeys.has(key)) fail(`unsupported package.json field ${key}`);
  }
  const files = metadata.files;
  if (
    metadata.name !== "@brianmsm/quarto-bento" ||
    metadata.version !== "0.2.0" || metadata.license !== "MIT" ||
    metadata.private !== true ||
    !isRecord(metadata.bin) || Object.keys(metadata.bin).length !== 1 ||
    metadata.bin.qbento !== "bin/qbento-npm.mjs" ||
    !Array.isArray(files) || files.length !== npmFiles.length ||
    !npmFiles.every((path) => files.includes(path))
  ) {
    fail(
      "package.json identity, license, bin or files differs from npm payload",
    );
  }
  if (
    metadata.type !== undefined && metadata.type !== "module" ||
    !isRecord(metadata.publishConfig) ||
    Object.keys(metadata.publishConfig).length !== 2 ||
    metadata.publishConfig.access !== "public" ||
    metadata.publishConfig.registry !== "https://registry.npmjs.org" ||
    !isRecord(metadata.engines) ||
    Object.keys(metadata.engines).length !== 1 ||
    metadata.engines.node !== ">=22" ||
    !Array.isArray(metadata.os) || metadata.os.length !== 1 ||
    metadata.os[0] !== "linux"
  ) {
    fail("package.json module type or public access is invalid");
  }
  const publishable = { ...metadata };
  delete publishable.private;
  return new TextEncoder().encode(JSON.stringify(publishable, null, 2) + "\n");
}

/** Stage an explicit npm payload without installing packages or running hooks. */
export async function buildNpmPackage(options: {
  destination: string;
  sourceRoot?: string;
}): Promise<PackageManifest> {
  const sourceRoot = resolve(options.sourceRoot ?? root);
  const destination = resolve(options.destination);
  await realDirectories(sourceRoot);
  await realDirectories(dirname(destination));
  if (
    inside(destination, sourceRoot) ||
    ["src", "vendor", "_extensions", "bin", "scripts", "docs"].some((tree) =>
      inside(resolve(sourceRoot, tree), destination)
    )
  ) {
    throw new Error("UNSAFE_PACKAGE_DESTINATION: destination overlaps inputs");
  }
  // Preserve document and launcher bytes. Only the private source guard changes.
  const payload = await Promise.all([
    "package.json",
    "docs/NPM_README.md",
    "LICENSE",
    "bin/qbento-npm.mjs",
  ].map(async (path) => ({
    path: path === "docs/NPM_README.md" ? "README.md" : path,
    bytes: await regularBytes(resolve(sourceRoot, path)),
  })));
  payload[0].bytes = validateMetadata(payload[0].bytes);
  if (
    !new TextDecoder().decode(payload[3].bytes).startsWith(
      "#!/usr/bin/env node\n",
    )
  ) {
    fail("npm launcher requires the Node shebang");
  }
  // Exclusive creation means a failed invocation can clean up only its own tree.
  await Deno.mkdir(destination, { mode: 0o755 });
  try {
    const manifest = await buildDevelopmentPackage({
      destination: resolve(destination, "distribution"),
      sourceRoot,
    });
    for (const file of payload) {
      const path = resolve(destination, file.path);
      const mode = file.path === "bin/qbento-npm.mjs" ? 0o755 : 0o644;
      await Deno.mkdir(dirname(path), { recursive: true, mode: 0o755 });
      await Deno.writeFile(path, file.bytes, { createNew: true, mode });
      if (Deno.build.os !== "windows") await Deno.chmod(path, mode);
    }
    return manifest;
  } catch (error) {
    await Deno.remove(destination, { recursive: true });
    throw error;
  }
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) {
      throw new Error(
        "USAGE: deno run --no-config --allow-read --allow-write --allow-run=git scripts/npm-package.ts <new-directory>",
      );
    }
    const manifest = await buildNpmPackage({ destination: Deno.args[0] });
    console.log(JSON.stringify(
      {
        destination: resolve(Deno.args[0]),
        kind: "npm-development-cli",
        qbentoSource: manifest.qbentoSource,
        runtimeFiles: manifest.files.length,
        bento: manifest.bento,
      },
      null,
      2,
    ));
  } catch (error) {
    console.error(String(error));
    Deno.exitCode = 1;
  }
}
