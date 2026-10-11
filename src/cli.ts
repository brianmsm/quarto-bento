#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net=127.0.0.1
import { captureProject, readProject, renderProject } from "./core/project.ts";
import { extractDocument } from "./render/html.ts";
import { startStudio } from "./studio/server.ts";
const help = `qbento <command> <presentation.qmd> [arguments]

render                 Execute Quarto and retain saved design
capture [edited.html]   Explicitly capture native local HTML edits
status | diff          Inspect durable pending changes
edit                   Start local Bento Studio
validate <deck.html>   Validate the document envelope and stable IDs
doctor                 Report available runtime versions

Commands emit JSON. Save, sync and render are separate operations.
`;
if (import.meta.main) {
  const [command, source, extra] = Deno.args;
  try {
    let result: unknown;
    switch (command) {
      case "render": {
        if (!source) throw new Error("QMD path required");
        const r = await renderProject(source);
        result = {
          output: r.output,
          revision: r.state.revision,
          docId: r.state.docId,
          pending: r.state.pending.length,
          diagnostics: r.diagnostics,
        };
        break;
      }
      case "capture": {
        if (!source) throw new Error("QMD path required");
        const r = await captureProject(source, extra);
        result = {
          revision: r.state.revision,
          pending: r.pending,
          overrides: r.overrides,
        };
        break;
      }
      case "status":
      case "diff": {
        if (!source) throw new Error("QMD path required");
        const s = await readProject(source);
        result = {
          docId: s.docId,
          revision: s.revision,
          pending: s.pending,
          overrides: s.overrides,
        };
        break;
      }
      case "validate": {
        if (!source) throw new Error("HTML path required");
        const d = extractDocument(await Deno.readTextFile(source));
        result = { valid: true, docId: d.docId, slides: d.slides.length };
        break;
      }
      case "doctor": {
        const versions: Record<string, string> = {
          deno: Deno.version.deno,
          os: Deno.build.os,
        };
        for (const executable of ["quarto", "Rscript"]) {
          try {
            const r = await new Deno.Command(executable, {
              args: ["--version"],
              stdout: "piped",
              stderr: "piped",
            }).output();
            versions[executable] = new TextDecoder().decode(
              r.stdout.length ? r.stdout : r.stderr,
            ).trim();
          } catch {
            versions[executable] = "unavailable";
          }
        }
        result = versions;
        break;
      }
      case "edit": {
        if (!source) throw new Error("QMD path required");
        await renderProject(source);
        const s = await startStudio(source);
        console.log(JSON.stringify({ url: s.url }));
        await s.finished;
        break;
      }
      case "help":
      case "--help":
      case undefined:
        console.log(help);
        break;
      default:
        throw new Error(`UNKNOWN_COMMAND: ${command}`);
    }
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const e = error as Error & { code?: string; details?: unknown };
    console.error(
      JSON.stringify(
        {
          error: e.code || "QBENTO_ERROR",
          message: e.message,
          details: e.details,
        },
        null,
        2,
      ),
    );
    Deno.exitCode = 1;
  }
}
