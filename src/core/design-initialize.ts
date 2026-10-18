import { basename, resolve } from "node:path";
import {
  assertDesignRegistryUnchanged,
  MAX_DESIGN_REGISTRY_BYTES,
  registryDefaults,
} from "../render/registry.ts";
import { assertReusableDesignSource } from "../render/theme-styles.ts";
import { hashSource, scanSource } from "../source/mod.ts";
import { sha256, StateError } from "../state/mod.ts";
import { validateDesignPackage } from "./design-package.ts";
import { syncDirectory, writeDurable } from "./io.ts";
import { projectPaths } from "./project.ts";

async function sourceSnapshot(path: string) {
  const before = await Deno.lstat(path);
  if (before.isSymlink || !before.isFile) {
    throw new StateError(
      "UNSAFE_INITIALIZATION_SOURCE",
      "Initialization requires an existing regular QMD without a symbolic link.",
    );
  }
  const text = await Deno.readTextFile(path);
  const after = await Deno.lstat(path);
  if (
    after.isSymlink || !after.isFile || after.dev !== before.dev ||
    after.ino !== before.ino
  ) {
    throw new StateError(
      "STALE_SOURCE",
      "QMD changed while reading its initialization snapshot.",
    );
  }
  return { text, hash: hashSource(text), ino: after.ino, dev: after.dev };
}

async function assertNoOutput(directory: string) {
  for await (const entry of Deno.readDir(directory)) {
    if (/\.bento\.html(?:$|\.pending-)/.test(entry.name)) {
      throw new StateError(
        "DESIGN_INITIALIZATION_OUTPUT_EXISTS",
        "A generated or recoverable Bento output already exists in this directory. Preserve it and restore its matching project instead of initializing.",
      );
    }
  }
}

/** Explicit one-shot design installation before the first render; replaces nothing. */
export async function initializeDesignPackage(source: string, value: unknown) {
  const design = validateDesignPackage(value);
  const registry = design.registry;
  const text = JSON.stringify(registry, null, 2) + "\n";
  if (new TextEncoder().encode(text).length > MAX_DESIGN_REGISTRY_BYTES) {
    throw new StateError(
      "DESIGN_REGISTRY_TOO_LARGE",
      "Initialized registry exceeds 256 KiB.",
    );
  }
  const paths = projectPaths(source);
  const original = await sourceSnapshot(paths.source);
  assertReusableDesignSource(
    scanSource(original.text),
    registryDefaults(registry),
  );
  await assertNoOutput(paths.directory);
  try {
    // Exclusive ownership: never adopt a directory, state or interrupted work.
    await Deno.mkdir(paths.stateDir, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new StateError(
        "DESIGN_INITIALIZATION_EXISTS",
        ".qbento already exists. Use the checked design import workflow for an existing presentation; preserve any interrupted initialization for inspection.",
      );
    }
    throw error;
  }
  const owned = await Deno.lstat(paths.stateDir);
  const assertOwned = async () => {
    const info = await Deno.lstat(paths.stateDir);
    if (
      info.isSymlink || !info.isDirectory || info.dev !== owned.dev ||
      info.ino !== owned.ino
    ) {
      throw new StateError(
        "UNSAFE_INITIALIZATION_DIRECTORY",
        "The newly created .qbento directory changed; preserve the remaining files for inspection.",
      );
    }
  };
  const assertSource = async () => {
    const current = await sourceSnapshot(paths.source);
    if (
      current.hash !== original.hash || current.ino !== original.ino ||
      current.dev !== original.dev
    ) {
      throw new StateError(
        "STALE_SOURCE",
        "QMD changed before design initialization completed. Preserve the initialization files and review the source before rendering.",
      );
    }
  };
  await assertOwned();
  const token = crypto.randomUUID();
  const hash = await sha256(text);
  const stage = resolve(
    paths.stateDir,
    ".design-initialize-" + token + ".json",
  );
  const marker = resolve(paths.stateDir, "design-save.json");
  // Existing registry admission already refuses this marker. Interrupted
  // initialization must never silently render with missing/default design.
  await writeDurable(
    marker,
    JSON.stringify(
      {
        schemaVersion: 1,
        operation: "initialize-design",
        token,
        stage,
        beforeHash: null,
        afterHash: hash,
        source: paths.source,
        sourceHash: original.hash,
      },
      null,
      2,
    ) + "\n",
  );
  await syncDirectory(paths.stateDir);
  await syncDirectory(paths.directory);
  await assertOwned();
  await writeDurable(
    resolve(paths.stateDir, "project.json"),
    JSON.stringify({ version: 1, source: basename(paths.source) }, null, 2) +
      "\n",
  );
  await syncDirectory(paths.stateDir);
  await assertSource();
  await assertNoOutput(paths.directory);
  await writeDurable(stage, text);
  await syncDirectory(paths.stateDir);
  await assertOwned();
  await assertSource();
  await assertNoOutput(paths.directory);
  const target = resolve(paths.stateDir, "design.json");
  // Atomic no-clobber publication. Even a concurrent target is preserved.
  await Deno.link(stage, target);
  await syncDirectory(paths.stateDir);
  await assertOwned();
  await assertSource();
  await Deno.remove(stage);
  await syncDirectory(paths.stateDir);
  await assertDesignRegistryUnchanged(paths.directory, hash, token);
  await assertSource();
  await assertNoOutput(paths.directory);
  await Deno.remove(marker);
  await syncDirectory(paths.stateDir);
  await syncDirectory(paths.directory);
  return {
    initialized: true as const,
    registry,
    hash,
    sourceHash: original.hash,
    renderNeeded: true as const,
  };
}
