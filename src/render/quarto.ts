import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import type { Ast } from "./types.ts";
import {
  assertCompatibleProducerFilters,
  attachProducerCapture,
  prepareProducerCapture,
} from "./producer-capture.ts";

/** Match the installed format's SVG default without replacing authored options. */
function figureFormatArguments(
  inspected: {
    project?: { config?: Record<string, unknown> };
    fileInformation?: Record<string, { metadata?: Record<string, unknown> }>;
  } | undefined,
): string[] {
  if (!inspected) return [];
  const declared = (value: Record<string, unknown> | undefined): boolean => {
    if (!value || typeof value !== "object") return false;
    // External metadata has its own precedence; leave its device choice intact.
    if (
      value["fig-format"] !== undefined ||
      value["metadata-file"] !== undefined ||
      value["metadata-files"] !== undefined
    ) return true;
    const execute = value.execute as Record<string, unknown> | undefined;
    if (execute?.["fig-format"] !== undefined) return true;
    const formats = value.format as Record<string, unknown> | undefined;
    return declared(formats?.html as Record<string, unknown> | undefined) ||
      declared(formats?.["qbento-html"] as Record<string, unknown> | undefined);
  };
  if (
    declared(inspected.project?.config) ||
    Object.values(inspected.fileInformation ?? {}).some((file) =>
      declared(file.metadata)
    )
  ) return [];
  return ["-M", "fig-format:svg"];
}

async function assertPrivateBuild(buildRoot: string): Promise<void> {
  const pending = [buildRoot];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++entries > 50_000) {
      throw new Error(
        "UNSAFE_BUILD_PATH: generated tree is too large to verify",
      );
    }
    const info = await Deno.lstat(current);
    if (info.isSymlink && current !== buildRoot) {
      // Fontconfig can create aliases between cache files. They are safe only
      // when the fully resolved target remains inside this generated tree.
      let target: string;
      try {
        target = await Deno.realPath(current);
      } catch {
        throw new Error(`UNSAFE_BUILD_PATH: unresolved alias ${current}`);
      }
      const location = relative(buildRoot, target);
      if (
        isAbsolute(location) || location === ".." ||
        location.startsWith(`..${sep}`)
      ) {
        throw new Error(`UNSAFE_BUILD_PATH: external alias ${current}`);
      }
      continue;
    }
    if (
      info.isSymlink || !(info.isDirectory || info.isFile) ||
      (info.isFile && (info.nlink === null || info.nlink > 1))
    ) {
      throw new Error(
        `UNSAFE_BUILD_PATH: Quarto output must contain only private files and real directories (${current})`,
      );
    }
    if (info.isDirectory) {
      for await (const entry of Deno.readDir(current)) {
        pending.push(resolve(current, entry.name));
      }
    }
  }
}
export async function executeQuarto(
  source: string,
  buildDir: string,
): Promise<Ast> {
  source = resolve(source);
  buildDir = resolve(buildDir);
  await Deno.mkdir(buildDir, { recursive: true });
  await assertPrivateBuild(buildDir);
  if (!(await Deno.lstat(buildDir)).isDirectory) {
    throw new Error(
      "UNSAFE_BUILD_PATH: Quarto output must be a real directory",
    );
  }
  const astPath = resolve(buildDir, "executed.json");
  try {
    await Deno.remove(astPath);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const inspection = await assertCompatibleProducerFilters(source);
  const figureFormat = figureFormatArguments(inspection);
  const capture = await prepareProducerCapture(source);
  try {
    const filter = fileURLToPath(new URL("./capture.lua", import.meta.url));
    const result = await new Deno.Command("quarto", {
      cwd: dirname(source),
      args: [
        "render",
        basename(source),
        "--to",
        "html",
        "--lua-filter",
        filter,
        "-M",
        "theme:none",
        ...figureFormat,
        "--output",
        "quarto-intermediate.html",
        "--output-dir",
        buildDir,
      ],
      env: {
        ...capture.env,
        QBENTO_AST: astPath,
        QBENTO_INTERNAL_RENDER: "1",
        XDG_CACHE_HOME: resolve(buildDir, "cache"),
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    await Deno.writeFile(resolve(buildDir, "quarto.stdout.log"), result.stdout);
    await Deno.writeFile(resolve(buildDir, "quarto.stderr.log"), result.stderr);
    if (!result.success) {
      throw new Error(
        `QUARTO_FAILED: ${new TextDecoder().decode(result.stderr)}`,
      );
    }
    const ast = JSON.parse(await Deno.readTextFile(astPath));
    if (!Array.isArray(ast.blocks)) {
      throw new Error("INVALID_AST: Quarto did not emit blocks");
    }
    return attachProducerCapture(
      ast,
      capture.manifest,
      await capture.emitted(),
    );
  } finally {
    await capture.cleanup();
  }
}
