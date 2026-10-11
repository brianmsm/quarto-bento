import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageFile {
  path: string;
  bytes: number;
  sha256: string;
  executable: boolean;
}
export interface PackageManifest {
  schemaVersion: 1;
  kind: "development-portable";
  bento: { revision: string; version: string; shellSha256: string };
  files: PackageFile[];
}
const root = fileURLToPath(new URL("../", import.meta.url));
const fixedFiles = [
  "vendor/bento/shell.html",
  "vendor/bento/slides.schema.json",
  "vendor/bento/pin.json",
  "vendor/bento/LICENSE",
  "vendor/bento/THIRD_PARTY_NOTICES.md",
  "_extensions/qbento/_extension.yml",
  "_extensions/qbento/pre.ts",
  "_extensions/qbento/post.ts",
  "_extensions/qbento/capture.lua",
  "_extensions/qbento/guard.lua",
];
function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}
async function hash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function filesIn(directory: string): Promise<string[]> {
  const info = await Deno.lstat(directory);
  if (info.isSymlink || !info.isDirectory) {
    throw new Error(
      `UNSAFE_PACKAGE_INPUT: expected real directory ${directory}`,
    );
  }
  const entries = [];
  for await (const entry of Deno.readDir(directory)) entries.push(entry);
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      throw new Error(`UNSAFE_PACKAGE_INPUT: symbolic link ${path}`);
    }
    if (stat.isDirectory) files.push(...await filesIn(path));
    else if (stat.isFile && /\.(ts|js|html|lua)$/.test(entry.name)) {
      files.push(path);
    } else {
      throw new Error(`UNSAFE_PACKAGE_INPUT: unexpected runtime file ${path}`);
    }
  }
  return files;
}
async function regularBytes(path: string): Promise<Uint8Array> {
  // Reject symlinks in every parent as well as in the selected file.
  for (let parent = dirname(path);; parent = dirname(parent)) {
    if ((await Deno.lstat(parent)).isSymlink) {
      throw new Error(`UNSAFE_PACKAGE_INPUT: symbolic link ${parent}`);
    }
    if (parent === dirname(parent)) break;
  }
  const stat = await Deno.lstat(path);
  if (stat.isSymlink || !stat.isFile) {
    throw new Error(`UNSAFE_PACKAGE_INPUT: expected regular file ${path}`);
  }
  return await Deno.readFile(path);
}
/** Build an offline directory, refusing existing destinations and unknown inputs. */
export async function buildDevelopmentPackage(options: {
  destination: string;
  sourceRoot?: string;
}): Promise<PackageManifest> {
  const sourceRoot = resolve(options.sourceRoot ?? root);
  const destination = resolve(options.destination);
  for (
    const tree of ["src", "vendor", "_extensions", "bin", "scripts", "docs"]
  ) {
    if (inside(resolve(sourceRoot, tree), destination)) {
      throw new Error(
        "UNSAFE_PACKAGE_DESTINATION: destination overlaps inputs",
      );
    }
  }
  if (inside(destination, sourceRoot)) {
    throw new Error(
      "UNSAFE_PACKAGE_DESTINATION: destination contains source root",
    );
  }
  const payload: { path: string; bytes: Uint8Array; executable: boolean }[] =
    [];
  for (const path of await filesIn(resolve(sourceRoot, "src"))) {
    const name = relative(sourceRoot, path).split(sep).join("/");
    payload.push({
      path: `runtime/${name}`,
      bytes: await regularBytes(path),
      executable: false,
    });
  }
  for (const name of fixedFiles) {
    payload.push({
      path: `runtime/${name}`,
      bytes: await regularBytes(resolve(sourceRoot, name)),
      executable: false,
    });
  }
  for (const name of ["bin/qbento", "bin/qbento.cmd", "docs/PACKAGING.md"]) {
    const bytes = await regularBytes(resolve(sourceRoot, name));
    payload.push({
      path: name === "docs/PACKAGING.md" ? "PACKAGING.md" : name,
      // Keep source diffs clean while shipping native batch-file line endings.
      bytes: name === "bin/qbento.cmd"
        ? new TextEncoder().encode(
          new TextDecoder().decode(bytes).replace(/\r?\n/g, "\r\n"),
        )
        : bytes,
      executable: name === "bin/qbento",
    });
  }
  payload.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const pin = JSON.parse(new TextDecoder().decode(
    payload.find((f) => f.path === "runtime/vendor/bento/pin.json")!.bytes,
  ));
  const shell = payload.find((f) =>
    f.path === "runtime/vendor/bento/shell.html"
  )!;
  if (
    !/^[0-9a-f]{40}$/.test(pin.revision) || typeof pin.version !== "string" ||
    !/^[0-9a-f]{64}$/.test(pin.shellSha256) ||
    await hash(shell.bytes) !== pin.shellSha256
  ) {
    throw new Error(
      "BENTO_PIN_MISMATCH: shell does not match the pinned manifest",
    );
  }
  const manifest: PackageManifest = {
    schemaVersion: 1,
    kind: "development-portable",
    bento: {
      revision: pin.revision,
      version: pin.version,
      shellSha256: pin.shellSha256,
    },
    files: await Promise.all(payload.map(async (f) => ({
      path: f.path,
      bytes: f.bytes.length,
      sha256: await hash(f.bytes),
      executable: f.executable,
    }))),
  };
  // Exclusive directory creation prevents replacing user content. Failed builds
  // remove only the directory created by this invocation.
  await Deno.mkdir(destination, { mode: 0o755 });
  try {
    for (const file of payload) {
      const target = resolve(destination, file.path);
      await Deno.mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await Deno.writeFile(target, file.bytes, {
        createNew: true,
        mode: file.executable ? 0o755 : 0o644,
      });
      if (Deno.build.os !== "windows") {
        await Deno.chmod(target, file.executable ? 0o755 : 0o644);
      }
    }
    await Deno.writeTextFile(
      resolve(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { createNew: true, mode: 0o644 },
    );
  } catch (error) {
    await Deno.remove(destination, { recursive: true });
    throw error;
  }
  return manifest;
}
if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) {
      throw new Error(
        "USAGE: deno run --no-config --allow-read --allow-write scripts/package.ts <new-directory>",
      );
    }
    const manifest = await buildDevelopmentPackage({
      destination: Deno.args[0],
    });
    console.log(JSON.stringify(
      {
        destination: resolve(Deno.args[0]),
        kind: manifest.kind,
        files: manifest.files.length,
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
