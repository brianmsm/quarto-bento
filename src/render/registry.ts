import { resolve } from "node:path";
import { sha256 } from "../state/store.ts";
import {
  type DesignDefaults,
  DesignError,
  type DesignTheme,
  type LayoutDefinition,
  validateDesignDefaults,
} from "./design.ts";

export interface DesignRegistry {
  schemaVersion: 1;
  layouts?: Record<string, LayoutDefinition>;
  themes?: Record<string, DesignTheme>;
  activeTheme?: string;
}
const names = /^[a-z][a-z0-9-]{0,63}$/;
const maximumBytes = 262144;
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesignError("INVALID_DESIGN_REGISTRY", "Expected a JSON object.");
  }
}
/** Versioned JSON data, never code, remote dependencies or Quarto configuration. */
export function validateDesignRegistry(value: unknown): DesignRegistry {
  object(value);
  if (
    value.schemaVersion !== 1 ||
    Object.keys(value).some((key) =>
      !["schemaVersion", "layouts", "themes", "activeTheme"].includes(key)
    )
  ) {
    throw new DesignError(
      "INVALID_DESIGN_REGISTRY",
      "Expected schemaVersion 1 and only layouts/themes/activeTheme.",
    );
  }
  const result: DesignRegistry = { schemaVersion: 1 };
  if (value.layouts !== undefined) {
    object(value.layouts);
    if ("two-column" in value.layouts) {
      throw new DesignError(
        "RESERVED_LAYOUT",
        "two-column is built in; choose a distinct custom name.",
      );
    }
    result.layouts = validateDesignDefaults({
      layouts: value.layouts as Record<string, LayoutDefinition>,
    }).layouts;
  }
  if (value.themes !== undefined) {
    object(value.themes);
    if (Object.keys(value.themes).length > 32) {
      throw new DesignError(
        "INVALID_DESIGN_REGISTRY",
        "At most 32 named themes.",
      );
    }
    result.themes = Object.create(null);
    for (const [name, theme] of Object.entries(value.themes)) {
      object(theme);
      if (!names.test(name)) {
        throw new DesignError(
          "INVALID_DESIGN_REGISTRY",
          `Unsafe theme name: ${name}`,
        );
      }
      result.themes![name] = validateDesignDefaults({
        theme: theme as unknown as DesignTheme,
      }).theme!;
    }
  }
  if (value.activeTheme !== undefined) {
    if (
      typeof value.activeTheme !== "string" || !names.test(value.activeTheme) ||
      !Object.hasOwn(result.themes ?? {}, value.activeTheme)
    ) {
      throw new DesignError(
        "UNKNOWN_THEME",
        "activeTheme must name a declared theme.",
      );
    }
    result.activeTheme = value.activeTheme;
  } else if (Object.keys(result.themes ?? {}).length) {
    throw new DesignError(
      "THEME_SELECTION_REQUIRED",
      "Select activeTheme explicitly; JSON key order never selects a theme.",
    );
  }
  return result;
}
export function registryDefaults(registry: DesignRegistry): DesignDefaults {
  const checked = validateDesignRegistry(registry);
  return {
    ...(checked.layouts ? { layouts: checked.layouts } : {}),
    ...(checked.activeTheme
      ? { theme: checked.themes![checked.activeTheme] }
      : {}),
  };
}
async function registryBytes(directory: string): Promise<Uint8Array | null> {
  const stateDir = resolve(directory, ".qbento");
  try {
    const info = await Deno.lstat(stateDir);
    if (info.isSymlink || !info.isDirectory) {
      throw new DesignError(
        "UNSAFE_DESIGN_REGISTRY",
        ".qbento must be a real directory.",
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
  const path = resolve(stateDir, "design.json");
  try {
    const info = await Deno.lstat(path);
    if (
      info.isSymlink || !info.isFile || info.nlink !== null && info.nlink > 1
    ) {
      throw new DesignError(
        "UNSAFE_DESIGN_REGISTRY",
        "design.json must be a regular unlinked file.",
      );
    }
    if (info.size > maximumBytes) {
      throw new DesignError(
        "DESIGN_REGISTRY_TOO_LARGE",
        "design.json exceeds 256 KiB.",
      );
    }
    // Fixed filename and verified directory/file prevent path or URL selection.
    const file = await Deno.open(path, { read: true });
    try {
      const bytes = new Uint8Array(maximumBytes + 1);
      let size = 0;
      for (;;) {
        const read = await file.read(bytes.subarray(size));
        if (read === null) break;
        size += read;
        if (size > maximumBytes) {
          throw new DesignError(
            "DESIGN_REGISTRY_TOO_LARGE",
            "design.json exceeds 256 KiB.",
          );
        }
      }
      return bytes.slice(0, size);
    } finally {
      file.close();
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
export async function loadDesignRegistry(
  directory: string,
): Promise<{ defaults: DesignDefaults; hash: string | null }> {
  const bytes = await registryBytes(directory);
  if (!bytes) return { defaults: {}, hash: null };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DesignError(
      "INVALID_DESIGN_REGISTRY",
      "design.json must contain valid UTF-8 JSON.",
    );
  }
  return {
    defaults: registryDefaults(validateDesignRegistry(value)),
    hash: await sha256(bytes),
  };
}
/** CAS includes both absence and exact bytes; native sparse overrides are independent. */
export async function assertDesignRegistryUnchanged(
  directory: string,
  expected: string | null,
): Promise<void> {
  const bytes = await registryBytes(directory);
  const actual = bytes === null ? null : await sha256(bytes);
  if (actual !== expected) {
    throw new DesignError(
      "DESIGN_REGISTRY_CHANGED",
      "design.json changed during the checked operation; retry from the current registry.",
    );
  }
}
