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
export const MAX_DESIGN_REGISTRY_BYTES = 262144;
const maximumBytes = MAX_DESIGN_REGISTRY_BYTES;

/** Keep ordinary registries readable without making whitespace block reuse. */
export function serializeDesignRegistry(registry: DesignRegistry): string {
  const compact = JSON.stringify(registry) + "\n";
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  if (bytes(compact) > MAX_DESIGN_REGISTRY_BYTES) {
    throw new DesignError(
      "DESIGN_REGISTRY_TOO_LARGE",
      "Registry exceeds 256 KiB.",
    );
  }
  const readable = JSON.stringify(registry, null, 2) + "\n";
  return bytes(readable) <= MAX_DESIGN_REGISTRY_BYTES ? readable : compact;
}

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
async function designRegistryReady(
  directory: string,
  transactionToken?: string,
): Promise<void> {
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
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  const journal = resolve(stateDir, "design-save.json");
  try {
    const marker = await Deno.lstat(journal);
    if (
      !transactionToken || marker.isSymlink || !marker.isFile ||
      marker.size > 8192 || marker.nlink !== null && marker.nlink > 1
    ) {
      throw new DesignError(
        "DESIGN_REGISTRY_RECOVERY_REQUIRED",
        "An interrupted registry save is retained at .qbento/design-save.json. Inspect its history receipt and restore or finish the saved registry before loading or recalculating.",
      );
    }
    const receipt = JSON.parse(await Deno.readTextFile(journal));
    if (receipt.token !== transactionToken) {
      throw new DesignError(
        "DESIGN_REGISTRY_RECOVERY_REQUIRED",
        "Another registry save requires recovery before loading the registry.",
      );
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
/** Refuse an unresolved save before other raw registry readers infer absence. */
export async function assertDesignRegistryReady(
  directory: string,
): Promise<void> {
  await designRegistryReady(directory);
}
async function registryBytes(
  directory: string,
  transactionToken?: string,
): Promise<Uint8Array | null> {
  await designRegistryReady(directory, transactionToken);
  const stateDir = resolve(directory, ".qbento");
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
/** Preserve the complete validated registry and its exact-byte freshness token. */
export async function readDesignRegistry(
  directory: string,
): Promise<{ registry: DesignRegistry; hash: string | null }> {
  const bytes = await registryBytes(directory);
  if (!bytes) return { registry: { schemaVersion: 1 }, hash: null };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DesignError(
      "INVALID_DESIGN_REGISTRY",
      "design.json must contain valid UTF-8 JSON.",
    );
  }
  return { registry: validateDesignRegistry(value), hash: await sha256(bytes) };
}
export async function loadDesignRegistry(
  directory: string,
): Promise<{ defaults: DesignDefaults; hash: string | null }> {
  const snapshot = await readDesignRegistry(directory);
  return { defaults: registryDefaults(snapshot.registry), hash: snapshot.hash };
}
/** CAS includes both absence and exact bytes; native sparse overrides are independent. */
export async function assertDesignRegistryUnchanged(
  directory: string,
  expected: string | null,
  transactionToken?: string,
): Promise<void> {
  const bytes = await registryBytes(directory, transactionToken);
  const actual = bytes === null ? null : await sha256(bytes);
  if (actual !== expected) {
    throw new DesignError(
      "DESIGN_REGISTRY_CHANGED",
      "design.json changed during the checked operation; retry from the current registry.",
    );
  }
}
