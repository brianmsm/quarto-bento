#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net=127.0.0.1
import { captureProject, readProject, renderProject } from "./core/project.ts";
import {
  applyDesignImport,
  exportDesignPackage,
  previewDesignImport,
  readDesignImportPlanFile,
  readDesignJsonFile,
  readDesignPackageFile,
  validateDesignPackage,
} from "./core/design-package.ts";
import {
  adaptRevealDesign,
  readRevealReferenceFile,
} from "./core/design-adaptation.ts";
import { readProjectRegistry } from "./core/design-registry.ts";
import { initializeDesignPackage } from "./core/design-initialize.ts";
import {
  applySync,
  previewSelectedSync,
  previewSync,
  readSyncSelectionFile,
} from "./core/sync.ts";
import { recoverProject } from "./core/recovery.ts";
import { extractDocument } from "./render/html.ts";
import { startStudio } from "./studio/server.ts";
import { installQuartoProject } from "./integration/install.ts";
import { recoverQuartoRender } from "./integration/quarto.ts";
import { assertBentoContract } from "./render/validate.ts";
import { applyReconcile, previewReconcile } from "./core/reconcile.ts";
import {
  getAgentDeck,
  patchAgentDeck,
  readAgentPatchFile,
} from "./core/agent.ts";
const help = `qbento <command> <presentation.qmd> [arguments]

render                 Execute Quarto and retain saved design
capture [edited.html]   Explicitly capture native local HTML edits
status | diff          Inspect durable pending changes
get                    Read the saved deck, revision, provenance and pending edits
patch <payload.json>   Apply bounded structured edits to saved state; never writes QMD
sync [--select selection.json | --apply plan.json] Preview all/selected source changes or apply an inspected plan
reconcile [--apply resolution.json] Execute conflict preview, or apply {plan,choices} to saved state
recover [inspect|finish|rollback] Inspect or explicitly recover an interrupted operation
init [--extension-only] Install the offline Quarto integration without replacing existing configuration
quarto-recover         Recover an interrupted ordinary Quarto invocation
edit                   Start local Bento Studio
validate <deck.html>   Validate the document envelope and stable IDs
doctor                 Report available runtime versions
design show <qmd>       Inspect the current reusable design registry
design init <qmd> <file> Initialize a new presentation with a local design
design export <qmd> [name] Export a content-free design package as JSON
design inspect <file>   Validate and inspect a reusable design package
design preview <qmd> <file> Preview replacing the local design registry
design apply <qmd> <plan> Apply an unchanged inspected design plan
design adapt <html> <mapping> [--package] Sample inline Reveal styles locally

Commands emit JSON. Save, sync and render are separate operations.
`;
if (import.meta.main) {
  const [command, source, extra] = Deno.args;
  try {
    let result: unknown;
    switch (command) {
      case "design": {
        const [action, target, argument, option] = Deno.args.slice(1);
        if (action === "show" && target && Deno.args.length === 3) {
          result = await readProjectRegistry(target);
        } else if (
          action === "init" && target && argument && Deno.args.length === 4
        ) {
          result = await initializeDesignPackage(
            target,
            await readDesignPackageFile(argument),
          );
        } else if (
          action === "export" && target && Deno.args.length <= 4
        ) {
          result = await exportDesignPackage(target, argument ?? "My design");
        } else if (
          action === "inspect" && target && Deno.args.length === 3
        ) {
          result = validateDesignPackage(await readDesignPackageFile(target));
        } else if (
          action === "preview" && target && argument && Deno.args.length === 4
        ) {
          result = await previewDesignImport(
            target,
            await readDesignPackageFile(argument),
          );
        } else if (
          action === "apply" && target && argument && Deno.args.length === 4
        ) {
          result = await applyDesignImport(
            target,
            await readDesignImportPlanFile(argument),
          );
        } else if (
          action === "adapt" && target && argument &&
          (Deno.args.length === 4 ||
            Deno.args.length === 5 && option === "--package")
        ) {
          const adapted = await adaptRevealDesign(
            await readRevealReferenceFile(target),
            await readDesignJsonFile(argument),
          );
          result = option === "--package" ? adapted.package : adapted;
        } else {
          throw new Error(
            "DESIGN_USAGE: Use design show|init|export|inspect|preview|apply|adapt; see qbento help.",
          );
        }
        break;
      }
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
      case "get": {
        if (!source || extra !== undefined || Deno.args.length !== 2) {
          throw new Error("AGENT_USAGE: Use get source.qmd");
        }
        result = await getAgentDeck(source);
        break;
      }
      case "patch": {
        if (!source || !extra || Deno.args.length !== 3) {
          throw new Error("AGENT_USAGE: Use patch source.qmd payload.json");
        }
        result = await patchAgentDeck(source, await readAgentPatchFile(extra));
        break;
      }
      case "sync": {
        if (!source) throw new Error("QMD path required");
        if (extra === "--apply" && Deno.args[3] && Deno.args.length === 4) {
          result = await applySync(
            source,
            JSON.parse(await Deno.readTextFile(Deno.args[3])),
          );
        } else if (
          extra === "--select" && Deno.args[3] && Deno.args.length === 4
        ) {
          result = await previewSelectedSync(
            source,
            await readSyncSelectionFile(Deno.args[3]),
          );
        } else if (extra === undefined && Deno.args.length === 2) {
          result = await previewSync(source);
        } else {throw new Error(
            "Use sync source.qmd [--select selection.json | --apply plan.json]",
          );}
        break;
      }
      case "recover": {
        if (!source) throw new Error("QMD path required");
        if (
          extra !== undefined &&
          !["inspect", "finish", "rollback"].includes(extra)
        ) {
          throw new Error(
            "Recovery action must be inspect, finish or rollback",
          );
        }
        result = await recoverProject(
          source,
          extra as "inspect" | "finish" | "rollback" | undefined,
        );
        break;
      }
      case "reconcile": {
        if (!source) throw new Error("QMD path required");
        if (extra === undefined) result = await previewReconcile(source);
        else if (extra === "--apply" && Deno.args[3]) {
          const { plan, choices } = JSON.parse(
            await Deno.readTextFile(Deno.args[3]),
          );
          result = await applyReconcile(source, plan, choices);
        } else {throw new Error(
            "Use reconcile source.qmd [--apply resolution.json]",
          );}
        break;
      }
      case "validate": {
        if (!source) throw new Error("HTML path required");
        const d = extractDocument(await Deno.readTextFile(source));
        assertBentoContract(d);
        result = { valid: true, docId: d.docId, slides: d.slides.length };
        break;
      }
      case "doctor": {
        const versions: Record<string, string> = {
          deno: Deno.version.deno,
          os: Deno.build.os,
        };
        // Chromium is optional: only computed rich-table/Plotly capture needs it.
        for (const executable of ["quarto", "Rscript", "chromium"]) {
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
        // Existing pending edits must remain accessible even when strict rendering refuses.
        try {
          await readProject(source);
        } catch (error) {
          if (
            !(error instanceof Error) ||
            ((error as { code?: string }).code !== "NO_BASELINE" &&
              !error.message.startsWith("NO_BASELINE:"))
          ) throw error;
          await renderProject(source);
        }
        const s = await startStudio(source);
        console.log(JSON.stringify({ url: s.url }));
        await s.finished;
        break;
      }
      case "init": {
        if (!source) throw new Error("QMD path required");
        if (extra !== undefined && extra !== "--extension-only") {
          throw new Error("Use init source.qmd [--extension-only]");
        }
        result = await installQuartoProject(source, {
          configure: extra !== "--extension-only",
        });
        break;
      }
      case "quarto-recover": {
        if (!source) throw new Error("QMD path required");
        result = await recoverQuartoRender(source);
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
    if (result !== undefined) {
      // Match the bounded design readers, including saved import plans.
      console.log(JSON.stringify(result, null, command === "design" ? 0 : 2));
    }
  } catch (error) {
    const e = error as Error & { code?: string; details?: unknown };
    console.error(
      JSON.stringify(
        {
          error: e.code ||
            (["get", "patch", "design"].includes(command) &&
              e.message.match(/^([A-Z][A-Z_0-9]+):/)?.[1]) ||
            "QBENTO_ERROR",
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
