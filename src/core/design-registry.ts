import { resolve } from "node:path";
import {
  assertDesignRegistryUnchanged,
  type DesignRegistry,
  MAX_DESIGN_REGISTRY_BYTES,
  readDesignRegistry,
  validateDesignRegistry,
} from "../render/registry.ts";
import { sha256, StateError } from "../state/mod.ts";
import { withProject } from "./project.ts";
import { syncDirectory, writeDurable } from "./io.ts";

export interface RegistryEditRequest {
  expectedDocId: string;
  expectedRevision: number;
  expectedHash: string | null;
  registry: DesignRegistry;
}
export async function readProjectRegistry(source: string) {
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) {
      throw new StateError("NO_BASELINE", "Render the project first.");
    }
    return {
      ...await readDesignRegistry(paths.directory),
      docId: state.docId,
      revision: state.revision,
    };
  });
}
function requestShape(request: RegistryEditRequest) {
  if (
    !request || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).sort().join(",") !==
      "expectedDocId,expectedHash,expectedRevision,registry" ||
    typeof request.expectedDocId !== "string" || !request.expectedDocId ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    !(request.expectedHash === null ||
      typeof request.expectedHash === "string" &&
        /^[a-f0-9]{64}$/.test(request.expectedHash))
  ) {
    throw new StateError(
      "INVALID_REGISTRY_EDIT",
      "Registry edits require the saved document identity, revision and exact registry hash.",
    );
  }
}
async function exists(path: string) {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
/** No state, output or QMD write. Existing bytes and candidate stay recoverable. */
export async function saveProjectRegistry(
  source: string,
  request: RegistryEditRequest,
) {
  requestShape(request);
  const registry = validateDesignRegistry(request.registry);
  const text = JSON.stringify(registry, null, 2) + "\n";
  if (new TextEncoder().encode(text).length > MAX_DESIGN_REGISTRY_BYTES) {
    throw new StateError(
      "DESIGN_REGISTRY_TOO_LARGE",
      "Registry exceeds 256 KiB.",
    );
  }
  return await withProject(source, async (paths, store) => {
    const state = await store.load();
    if (!state) {
      throw new StateError("NO_BASELINE", "Render the project first.");
    }
    if (state.docId !== request.expectedDocId) {
      throw new StateError(
        "DOC_ID_CHANGED",
        "Reload this project before saving its registry.",
      );
    }
    if (state.revision !== request.expectedRevision) {
      throw new StateError(
        "STALE_REVISION",
        "Another save changed the project. Reload before saving its registry.",
      );
    }
    await readDesignRegistry(paths.directory); // Refuse invalid/unknown current schema, never replace it silently.
    await assertDesignRegistryUnchanged(paths.directory, request.expectedHash);
    const history = resolve(paths.stateDir, "history");
    await Deno.mkdir(history, { recursive: true });
    const info = await Deno.lstat(history);
    if (info.isSymlink || !info.isDirectory) {
      throw new StateError(
        "UNSAFE_DESIGN_REGISTRY",
        "Registry history must be a real directory.",
      );
    }
    const token = crypto.randomUUID();
    const transaction = resolve(history, "design-" + token);
    await Deno.mkdir(transaction);
    await syncDirectory(history);
    const before = resolve(transaction, "before.json"),
      after = resolve(transaction, "after.json");
    const stage = resolve(paths.stateDir, ".design-stage-" + token + ".json");
    const target = resolve(paths.stateDir, "design.json");
    const marker = resolve(paths.stateDir, "design-save.json");
    const hash = await sha256(text);
    await writeDurable(after, text);
    await writeDurable(stage, text);
    await writeDurable(
      resolve(transaction, "receipt.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          docId: state.docId,
          revision: state.revision,
          beforeHash: request.expectedHash,
          afterHash: hash,
          stage,
        },
        null,
        2,
      ) + "\n",
    );
    await syncDirectory(transaction);
    // Probe the filesystem capability while the original target is still intact.
    const probe = resolve(paths.stateDir, ".design-link-probe-" + token);
    await Deno.link(stage, probe);
    await Deno.remove(probe);
    await syncDirectory(paths.stateDir);
    let moved = false, published = false, marked = false;

    try {
      await assertDesignRegistryUnchanged(
        paths.directory,
        request.expectedHash,
      );
      await writeDurable(
        marker,
        JSON.stringify(
          {
            schemaVersion: 1,
            token,
            transaction,
            stage,
            beforeHash: request.expectedHash,
            afterHash: hash,
          },
          null,
          2,
        ) + "\n",
      );
      marked = true;
      await syncDirectory(paths.stateDir);
      await assertDesignRegistryUnchanged(
        paths.directory,
        request.expectedHash,
        token,
      );
      if (request.expectedHash !== null) {
        await Deno.rename(target, before);
        moved = true;
        await syncDirectory(transaction);
        await syncDirectory(paths.stateDir);
        const previous = await Deno.lstat(before);
        if (
          !previous.isFile || previous.isSymlink ||
          previous.nlink !== null && previous.nlink > 1 ||
          previous.size > MAX_DESIGN_REGISTRY_BYTES
        ) {
          throw new StateError(
            "DESIGN_REGISTRY_CHANGED",
            "Registry path changed while preparing its save.",
          );
        }
        if (
          await sha256(await Deno.readFile(before)) !== request.expectedHash
        ) {
          throw new StateError(
            "DESIGN_REGISTRY_CHANGED",
            "Registry bytes changed while preparing its save.",
          );
        }
      }
      // Atomic create-if-absent publication, unlike rename-overwrite. A writer
      // outside the project lock cannot have its replacement silently removed.
      await Deno.link(stage, target);
      published = true;
      await Deno.remove(stage);
      await syncDirectory(paths.stateDir);
      await assertDesignRegistryUnchanged(paths.directory, hash, token);
      await writeDurable(
        resolve(transaction, "committed.json"),
        JSON.stringify({ hash }) + "\n",
      );
      await syncDirectory(transaction);
      await Deno.remove(marker);
      marked = false;
      await syncDirectory(paths.stateDir);
    } catch (error) {
      if (published) {
        throw new StateError(
          "REGISTRY_SAVED_RECOVERY_REQUIRED",
          `Registry publication occurred but final verification/durability failed. Preserve the registry and recovery files at ${transaction}. ${
            (error as Error).message
          }`,
        );
      }
      let restored = !moved;
      if (moved && !await exists(target)) {
        try {
          const original = await Deno.lstat(before);
          if (!original.isFile || original.isSymlink) {
            throw new Error("Retained path is not a regular file");
          }
          // Keep before.json immutable: a concurrent editor may replace the
          // restored target immediately after publication.
          const rollbackStage = resolve(
            paths.stateDir,
            ".design-stage-" + token + "-rollback.json",
          );
          const originalBytes = await Deno.readFile(before);
          if (await sha256(originalBytes) !== request.expectedHash) {
            throw new Error("Retained original bytes changed");
          }
          const rollbackFile = await Deno.open(rollbackStage, {
            createNew: true,
            write: true,
            mode: 0o600,
          });
          try {
            let offset = 0;
            while (offset < originalBytes.length) {
              offset += await rollbackFile.write(
                originalBytes.subarray(offset),
              );
            }
            await rollbackFile.sync();
          } finally {
            rollbackFile.close();
          }
          await syncDirectory(paths.stateDir);
          await Deno.link(rollbackStage, target); // Atomic create, never overwrite.
          await Deno.remove(rollbackStage);
          await syncDirectory(paths.stateDir);
          await assertDesignRegistryUnchanged(
            paths.directory,
            request.expectedHash,
            token,
          );
          restored = true;
        } catch (restoreError) {
          throw new StateError(
            "DESIGN_REGISTRY_RECOVERY_REQUIRED",
            `Registry save refused; existing bytes and candidate remain at ${transaction}. A concurrent replacement is never overwritten. ${
              (restoreError as Error).message
            }`,
          );
        }
      }
      if (!restored) {
        throw new StateError(
          "DESIGN_REGISTRY_RECOVERY_REQUIRED",
          `Registry save refused and a concurrent replacement was preserved. Inspect ${marker} and ${transaction} before continuing.`,
        );
      }
      if (marked) {
        await Deno.remove(marker);
        await syncDirectory(paths.stateDir);
      }
      if (
        error instanceof Deno.errors.AlreadyExists ||
        error instanceof Deno.errors.NotFound
      ) {
        throw new StateError(
          "DESIGN_REGISTRY_CHANGED",
          "Registry changed during publication; retry from a fresh snapshot. Recovery files were retained.",
        );
      }
      throw error;
    }
    return { registry, hash, docId: state.docId, revision: state.revision };
  });
}
