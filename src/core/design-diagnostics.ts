/** Observed original-QMD design traces, never a claim of historical restoration. */
import type { Diagnostic } from "../render/types.ts";
import type { DesignDefaults } from "../render/design.ts";
import type { ProjectState } from "../state/mod.ts";
import { type SourceDocument, SourceError } from "../source/mod.ts";
import { readDesignAnnotations } from "../source/annotations.ts";
import { annotationRequests } from "./annotations.ts";

/** Pure reevaluation keeps an empty newly rendered baseline from hiding lost design. */
export function missingDesignDiagnostics(
  document: SourceDocument,
  state: ProjectState | null | undefined,
  registry: { defaults: DesignDefaults; hash: string | null },
): Diagnostic[] {
  let traces;
  try {
    traces = readDesignAnnotations(document);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    return [{
      code: "UNVERIFIABLE_DESIGN_ANNOTATION",
      reference: ".qbento/",
      message:
        `An original QMD design trace cannot be verified: ${error.message} Preserve the QMD and restore .qbento/ from Git or backup, or explicitly reconcile the trace. Rendering a base deck does not recover its historical visual design.`,
    }];
  }
  const creations =
    state?.pending.filter((p) =>
      ["create-slide", "create-element"].includes(p.kind)
    ).map((p) => p.id) ?? [];
  const requests = annotationRequests(document, state, creations, {
    hash: registry.hash,
    ...(registry.defaults.theme
      ? { activeTheme: "validated-active-theme" }
      : {}),
    layouts: Object.keys(registry.defaults.layouts ?? {}),
  });
  const diagnostics: Diagnostic[] = [];
  for (const trace of traces) {
    const request = requests.find((r) => r.slideId === trace.slideId);
    const missing = trace.references
      ? trace.references.flatMap((reference) => {
        const categories = reference === ".qbento/design.json"
          ? ["theme", "layout"]
          : ["overrides", "decorations", "stacking", "created-design"];
        const declared = trace.features!.filter((feature) =>
          categories.includes(feature)
        );
        const absent = declared.filter((feature) => {
          if (request?.features.includes(feature)) return false;
          // Approved creations become ordinary sparse visual effects after promotion.
          // This checks current availability, never proof of historical identity/approval.
          return feature !== "created-design" || !request?.features.some((f) =>
            ["overrides", "decorations", "stacking"].includes(f)
          );
        });
        return !request?.references.includes(reference) || !declared.length ||
            absent.length
          ? [{ reference, features: absent }]
          : [];
      })
      : request
      ? []
      : [{ reference: ".qbento/", features: [] }];
    for (const { reference, features } of missing) {
      diagnostics.push({
        code: "MISSING_DESIGN",
        slideId: trace.slideId,
        reference,
        message:
          `Slide ${trace.slideId} retains a QMD design trace for ${reference}, but corresponding recoverable external design is missing${
            features.length ? ` (${features.join(", ")})` : ""
          }. Restore ${reference} from Git or backup, then render again; or explicitly review and resolve the obsolete trace through approved sync. The QMD is unchanged. A base deck or newly saved design is not proof that the historical visual design was recovered.`,
      });
    }
  }
  return diagnostics;
}
