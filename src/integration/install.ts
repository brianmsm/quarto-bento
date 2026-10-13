import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}
async function copyTree(source: string, destination: string): Promise<void> {
  const info = await Deno.lstat(source);
  if (info.isSymlink) {
    throw new Error(`UNSAFE_INSTALL_SOURCE: symbolic link ${source}`);
  }
  if (info.isDirectory) {
    await Deno.mkdir(destination, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
      await copyTree(
        resolve(source, entry.name),
        resolve(destination, entry.name),
      );
    }
  } else if (info.isFile) {
    await Deno.copyFile(source, destination);
  } else throw new Error(`UNSAFE_INSTALL_SOURCE: unsupported file ${source}`);
}
/** Install a self-contained, offline extension without rewriting existing config. */
export async function installQuartoProject(
  source: string,
  options: { configure?: boolean } = {},
) {
  source = resolve(source);
  if (!source.endsWith(".qmd") || !(await Deno.stat(source)).isFile) {
    throw new Error("SOURCE_TYPE: expected an existing single QMD");
  }
  const directory = dirname(source);
  const config = resolve(directory, "_quarto.yml");
  const extension = resolve(directory, "_extensions", "qbento");
  const configure = options.configure ?? true;
  if (
    configure &&
    (await exists(config) || await exists(resolve(directory, "_quarto.yaml")))
  ) {
    throw new Error(
      "QUARTO_CONFIG_EXISTS: preserve your configuration; install with configure:false and merge project type qbento explicitly",
    );
  }
  if (await exists(extension)) {
    throw new Error(
      "QUARTO_EXTENSION_EXISTS: existing extension retained; review it before upgrading",
    );
  }
  const extensions = dirname(extension);
  await Deno.mkdir(extensions, { recursive: true });
  const info = await Deno.lstat(extensions);
  if (info.isSymlink || !info.isDirectory) {
    throw new Error(
      "UNSAFE_INSTALL_PATH: _extensions must be a real directory",
    );
  }
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const stage = resolve(extensions, `.qbento-install-${crypto.randomUUID()}`);
  try {
    await copyTree(resolve(root, "_extensions", "qbento"), stage);
    await copyTree(resolve(root, "src"), resolve(stage, "runtime", "src"));
    await copyTree(
      resolve(root, "LICENSE"),
      resolve(stage, "runtime", "LICENSE"),
    );
    await copyTree(
      resolve(root, "vendor"),
      resolve(stage, "runtime", "vendor"),
    );
    // Refuse races with another installer rather than replacing existing content.
    await Deno.mkdir(extension);
    for await (const entry of Deno.readDir(stage)) {
      await Deno.rename(
        resolve(stage, entry.name),
        resolve(extension, entry.name),
      );
    }
    if (configure) {
      await Deno.writeTextFile(
        config,
        `# Quarto-Bento: publication uses the project's guarded post-render hook.\nproject:\n  type: qbento\n  render:\n    - ${
          JSON.stringify(basename(source))
        }\n`,
        { createNew: true },
      );
    }
  } finally {
    if (await exists(stage)) await Deno.remove(stage, { recursive: true });
  }
  return { extension, config: configure ? config : null, source };
}
