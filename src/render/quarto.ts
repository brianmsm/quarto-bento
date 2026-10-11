import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ast } from "./types.ts";
export async function executeQuarto(source: string, buildDir: string): Promise<Ast> {
  source = resolve(source);
  buildDir = resolve(buildDir);
  await Deno.mkdir(buildDir, { recursive: true });
  const astPath = resolve(buildDir, "executed.json");
  try { await Deno.remove(astPath); } catch (e) { if (!(e instanceof Deno.errors.NotFound)) throw e; }
  const filter = fileURLToPath(new URL("./capture.lua", import.meta.url));
  const result = await new Deno.Command("quarto", {
    cwd: dirname(source),
    args: ["render", basename(source), "--to", "html", "--lua-filter", filter, "-M", "theme:none", "--output", "quarto-intermediate.html", "--output-dir", buildDir],
    env: { QBENTO_AST: astPath, XDG_CACHE_HOME: resolve(buildDir, "cache") },
    stdout: "piped", stderr: "piped",
  }).output();
  await Deno.writeFile(resolve(buildDir, "quarto.stdout.log"), result.stdout);
  await Deno.writeFile(resolve(buildDir, "quarto.stderr.log"), result.stderr);
  if (!result.success) throw new Error(`QUARTO_FAILED: ${new TextDecoder().decode(result.stderr)}`);
  const ast = JSON.parse(await Deno.readTextFile(astPath));
  if (!Array.isArray(ast.blocks)) throw new Error("INVALID_AST: Quarto did not emit blocks");
  return ast;
}
