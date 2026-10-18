import {
  type DesignRegistry,
  MAX_DESIGN_REGISTRY_BYTES,
  validateDesignRegistry,
} from "../render/registry.ts";
import { assertJson } from "../state/json.ts";
import { canonical, equal, sha256, StateError } from "../state/mod.ts";
import { hashSource } from "../source/mod.ts";
import { readProject } from "./project.ts";
import { readProjectRegistry, saveProjectRegistry } from "./design-registry.ts";

export interface DesignPackage {
  format: "qbento/design";
  version: 1;
  name: string;
  registry: DesignRegistry;
}
export interface DesignImportPlan {
  version: 1;
  docId: string;
  expectedRevision: number;
  expectedHash: string | null;
  sourceHash: string;
  packageHash: string;
  package: DesignPackage;
  changes: {
    operation: "replace-registry";
    before: DesignRegistry;
    after: DesignRegistry;
    renderNeeded: true;
    removed: { layouts: string[]; themes: string[] };
  };
}

function jsonSize(value: unknown, maximum: number, code: string) {
  assertJson(value);
  if (new TextEncoder().encode(JSON.stringify(value)).length > maximum) {
    throw new StateError(code, "Design data exceeds its size limit.");
  }
}

/** Portable design definitions only; the registry validator owns its grammar. */
export function validateDesignPackage(value: unknown): DesignPackage {
  jsonSize(value, MAX_DESIGN_REGISTRY_BYTES, "DESIGN_PACKAGE_TOO_LARGE");
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "format,name,registry,version"
  ) {
    throw new StateError(
      "INVALID_DESIGN_PACKAGE",
      "Expected only format, version, name and registry.",
    );
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.format !== "qbento/design" || candidate.version !== 1 ||
    typeof candidate.name !== "string" || !candidate.name.trim() ||
    candidate.name.length > 120 ||
    [...candidate.name].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || code >= 127 && code <= 159;
    })
  ) {
    throw new StateError(
      "INVALID_DESIGN_PACKAGE",
      "Expected qbento/design version 1 and a readable name of at most 120 characters without control characters.",
    );
  }
  return {
    format: "qbento/design",
    version: 1,
    name: candidate.name,
    registry: validateDesignRegistry(candidate.registry),
  };
}

/** Bounded local pure JSON reader shared by package, plan and CLI mapping inputs. */
export async function readDesignJsonFile(
  path: string,
  maximum = MAX_DESIGN_REGISTRY_BYTES,
): Promise<unknown> {
  const before = await Deno.lstat(path);
  const regular = (info: Deno.FileInfo) =>
    info.isFile && !info.isSymlink && !(info.nlink !== null && info.nlink > 1);
  if (!regular(before)) {
    throw new StateError(
      "UNSAFE_DESIGN_PACKAGE",
      "Design input must be a regular file without symbolic or hard links.",
    );
  }
  if (before.size > maximum) {
    throw new StateError(
      "DESIGN_PACKAGE_TOO_LARGE",
      "Design input is too large.",
    );
  }
  const file = await Deno.open(path, { read: true });
  try {
    const opened = await file.stat();
    if (
      !regular(opened) || opened.ino !== before.ino || opened.dev !== before.dev
    ) {
      throw new StateError(
        "UNSAFE_DESIGN_PACKAGE",
        "Design input changed while opening.",
      );
    }
    const bytes = new Uint8Array(maximum + 1);
    let size = 0;
    for (;;) {
      const count = await file.read(bytes.subarray(size));
      if (count === null) break;
      size += count;
      if (size > maximum) {
        throw new StateError(
          "DESIGN_PACKAGE_TOO_LARGE",
          "Design input is too large.",
        );
      }
    }
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, size),
        ),
      );
    } catch {
      throw new StateError(
        "INVALID_DESIGN_PACKAGE",
        "Design input must contain valid UTF-8 JSON.",
      );
    }
  } finally {
    file.close();
  }
}

export async function readDesignPackageFile(
  path: string,
): Promise<DesignPackage> {
  return validateDesignPackage(
    await readDesignJsonFile(path, MAX_DESIGN_REGISTRY_BYTES),
  );
}

/** Saved document-wide theme changes are portable; per-object edits are not. */
export async function exportDesignPackage(
  source: string,
  name: string,
): Promise<DesignPackage> {
  const snapshot = await readProjectRegistry(source);
  const state = await readProject(source);
  if (snapshot.docId !== state.docId || snapshot.revision !== state.revision) {
    throw new StateError(
      "STALE_REVISION",
      "Project changed while exporting its design.",
    );
  }
  const registry = structuredClone(snapshot.registry);
  const active = registry.activeTheme ?? "exported";
  const emittedTheme = state.emitted.theme;
  if (
    !emittedTheme || typeof emittedTheme !== "object" ||
    Array.isArray(emittedTheme)
  ) {
    throw new StateError(
      "INVALID_DESIGN_PACKAGE",
      "Saved document has no reusable base theme.",
    );
  }
  // A newly saved/imported registry may not have been rendered yet. Its base
  // values are current; emitted contains the previous render's defaults. Only
  // actual saved native document-theme overrides may take precedence over them.
  const registered = registry.themes?.[active];
  const baseFields = ["background", "color", "accent", "fontFamily"] as const;
  const theme = { ...registered } as NonNullable<
    DesignRegistry["themes"]
  >[string];
  for (const field of baseFields) {
    let value: unknown = registered?.[field] ?? emittedTheme[field];
    for (const override of state.overrides) {
      if (override.target.slideId || override.target.elementId) continue;
      const saved = override.fields.find((entry) =>
        entry.path.length === 2 && entry.path[0] === "theme" &&
        entry.path[1] === field
      );
      if (saved?.value.present) value = saved.value.value;
    }
    theme[field] = value as string;
  }
  registry.themes = { ...registry.themes, [active]: theme };
  registry.activeTheme = active;
  const after = await readProjectRegistry(source);
  if (
    after.docId !== snapshot.docId || after.revision !== snapshot.revision ||
    after.hash !== snapshot.hash
  ) {
    throw new StateError(
      "STALE_REVISION",
      "Project changed while exporting its design.",
    );
  }
  return validateDesignPackage({
    format: "qbento/design",
    version: 1,
    name,
    registry,
  });
}

/** Inspect the complete replacement without writing state, source or output. */
export async function previewDesignImport(
  source: string,
  value: unknown,
): Promise<DesignImportPlan> {
  const design = validateDesignPackage(value);
  const snapshot = await readProjectRegistry(source);
  return {
    version: 1,
    docId: snapshot.docId,
    expectedRevision: snapshot.revision,
    expectedHash: snapshot.hash,
    sourceHash: hashSource(await Deno.readTextFile(source)),
    packageHash: await sha256(canonical(design)),
    package: design,
    changes: {
      operation: "replace-registry",
      before: snapshot.registry,
      after: structuredClone(design.registry),
      renderNeeded: true,
      removed: {
        layouts: Object.keys(snapshot.registry.layouts ?? {}).filter((name) =>
          !Object.hasOwn(design.registry.layouts ?? {}, name)
        ).sort(),
        themes: Object.keys(snapshot.registry.themes ?? {}).filter((name) =>
          !Object.hasOwn(design.registry.themes ?? {}, name)
        ).sort(),
      },
    },
  };
}

/** The checked plan and registry CAS must both match; pending edits stay intact. */
export async function applyDesignImport(source: string, value: unknown) {
  jsonSize(
    value,
    MAX_DESIGN_REGISTRY_BYTES * 3 + 4096,
    "DESIGN_PACKAGE_TOO_LARGE",
  );
  const plan = value as DesignImportPlan;
  const rebuilt = await previewDesignImport(source, plan?.package);
  if (!equal(plan, rebuilt)) {
    throw new StateError(
      "STALE_DESIGN_IMPORT",
      "Design import differs from the current checked preview. Review a fresh plan before applying.",
    );
  }
  const saved = await saveProjectRegistry(source, {
    expectedDocId: rebuilt.docId,
    expectedRevision: rebuilt.expectedRevision,
    expectedHash: rebuilt.expectedHash,
    expectedSourceHash: rebuilt.sourceHash,
    registry: rebuilt.changes.after,
  });
  return { ...saved, renderNeeded: true as const };
}

/** Optional CLI plan reader: bounded like a plan's three registry snapshots. */
export async function readDesignImportPlanFile(
  path: string,
): Promise<DesignImportPlan> {
  const value = await readDesignJsonFile(
    path,
    MAX_DESIGN_REGISTRY_BYTES * 3 + 4096,
  );
  jsonSize(
    value,
    MAX_DESIGN_REGISTRY_BYTES * 3 + 4096,
    "DESIGN_PACKAGE_TOO_LARGE",
  );
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    !("package" in value)
  ) {
    throw new StateError(
      "INVALID_DESIGN_PACKAGE",
      "Expected a design import plan.",
    );
  }
  validateDesignPackage(value.package);
  // Application rebuilds and checks every plan field against the saved project.
  return value as unknown as DesignImportPlan;
}
