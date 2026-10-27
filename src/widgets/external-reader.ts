import { isAbsolute, relative, resolve } from "node:path";
import { constants } from "node:fs";
import fs, { type FileHandle } from "node:fs/promises";

function fail(message: string): never {
  throw new Error(`UNSUPPORTED_WIDGET: ${message}`);
}

/** Linux-only bounded reader; this module never imports or executes artifact code. */
export async function readExternalWidgetFile(
  root: string,
  path: string,
): Promise<string> {
  if (
    !path || isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.includes("\\") || path.includes("\0") || !/\.html?$/i.test(path)
  ) fail("widget-src requires a local relative HTML file");
  const actualRoot = await Deno.realPath(root),
    file = resolve(actualRoot, path),
    rel = relative(actualRoot, file);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    fail("widget artifact is outside its source project");
  }
  const handles: FileHandle[] = [],
    limit = 16_000_000,
    invalid =
      "widget artifact must be a regular local HTML file without linked paths and at most 16 MB",
    flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try {
    let directory = await fs.open("/", flags | constants.O_DIRECTORY);
    handles.push(directory);
    const components = [
      ...actualRoot.split("/").filter(Boolean),
      ...rel.split("/"),
    ];
    // Linux procfs resolves only our pinned descriptor; every untrusted component is no-follow.
    for (const component of components.slice(0, -1)) {
      directory = await fs.open(
        `/proc/self/fd/${directory.fd}/${component}`,
        flags | constants.O_DIRECTORY,
      );
      handles.push(directory);
    }
    const artifact = await fs.open(
      `/proc/self/fd/${directory.fd}/${components.at(-1)}`,
      flags,
    );
    handles.push(artifact);
    const stat = await artifact.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) fail(invalid);
    const buffer = new Uint8Array(64 * 1024),
      decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let bytes = 0, text = "";
    while (true) {
      const { bytesRead } = await artifact.read(
        buffer,
        0,
        Math.min(buffer.length, limit - bytes + 1),
        null,
      );
      if (!bytesRead) return text + decoder.decode();
      bytes += bytesRead;
      if (bytes > limit) fail(invalid);
      text += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable) throw error;
    const code = error instanceof Error && "code" in error
      ? error.code
      : undefined;
    if (code === "ELOOP" || code === "ENOTDIR") fail(invalid);
    throw new Error(`Cannot read widget artifact "${path}": ${String(error)}`, {
      cause: error,
    });
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 2) {
      fail("artifact reader requires a project root and relative HTML path");
    }
    const bytes = new TextEncoder().encode(
      await readExternalWidgetFile(Deno.args[0], Deno.args[1]),
    );
    for (let offset = 0; offset < bytes.length;) {
      offset += await Deno.stdout.write(bytes.subarray(offset));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
