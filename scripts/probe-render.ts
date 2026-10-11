import { executeQuarto } from "../src/render/quarto.ts";
import { projectAst } from "../src/render/project.ts";
import { spliceDocument } from "../src/render/html.ts";
import { dirname, resolve } from "node:path";
const source = resolve(Deno.args[0] || "fixtures/basic/presentation.qmd");
const build = resolve(dirname(source), ".qbento/build");
const ast = await executeQuarto(source, build);
const projected = await projectAst(
  ast,
  "824c3669-64ad-4638-98fe-7eaa13a50642",
  [build, dirname(source)],
);
const shell = await Deno.readTextFile(
  new URL("../vendor/bento/shell.html", import.meta.url),
);
await Deno.mkdir("output", { recursive: true });
await Deno.writeTextFile(
  "output/probe.bento.html",
  spliceDocument(shell, projected.document),
);
await Deno.writeTextFile(
  "output/projection.json",
  JSON.stringify(projected, null, 2),
);
console.log(
  JSON.stringify({
    slides: projected.document.slides.length,
    elements: projected.document.slides.map((s) => s.elements.map((e) => e.id)),
    diagnostics: projected.diagnostics,
  }),
);
