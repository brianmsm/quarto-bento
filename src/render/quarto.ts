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
  await assertCompatibleProducerFilters(source);
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
