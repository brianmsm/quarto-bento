import { canonical, clone } from "./json.ts";
import { validateState } from "./merge.ts";
import { type BentoDoc, type ProjectState, StateError } from "./types.ts";
import { validateDoc } from "./json.ts";

export async function sha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
  ).map((n) => n.toString(16).padStart(2, "0")).join("");
}
async function readFile(path: string): Promise<string | undefined> {
  try {
    const info = await Deno.lstat(path);
    if (!info.isFile || info.isSymlink) {
      throw new StateError(
        "UNSAFE_STATE_PATH",
        `Expected a regular file at ${path}.`,
      );
    }
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}
async function durableWrite(path: string, content: string) {
  const file = await Deno.open(path, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(content);
    let offset = 0;
    while (offset < bytes.length) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
  } finally {
    file.close();
  }
}
export class StateStore {
  readonly path: string;
  constructor(readonly directory: string) {
    this.path = directory.replace(/\/$/, "") + "/state.json";
  }
  async load(): Promise<ProjectState | undefined> {
    const content = await readFile(this.path);
    if (content === undefined) return undefined;
    return await this.decode(content);
  }
  private async decode(content: string): Promise<ProjectState> {
    let envelope;
    try {
      envelope = JSON.parse(content);
    } catch {
      throw new StateError(
        "CORRUPT_STATE",
        "Project state is invalid JSON. Preserve it and inspect state.previous.json for recovery.",
      );
    }
    if (
      envelope?.format !== "qbento-state-envelope/1" ||
      typeof envelope.sha256 !== "string"
    ) {
      throw new StateError(
        "UNSUPPORTED_STATE_VERSION",
        "Unsupported persistence envelope.",
      );
    }
    validateState(envelope.state);
    if (await sha256(canonical(envelope.state)) !== envelope.sha256) {
      throw new StateError(
        "CORRUPT_STATE",
        "Project state checksum differs. Preserve it and explicitly recover from state.previous.json.",
      );
    }
    return envelope.state;
  }
  /** Recoverable replacement, mutually exclusive writer, and compare-and-swap revision check. */
  async save(
    input: ProjectState,
    expectedRevision = input.revision,
  ): Promise<ProjectState> {
    validateState(input);
    await Deno.mkdir(this.directory, { recursive: true });
    const info = await Deno.lstat(this.directory);
    if (info.isSymlink || !info.isDirectory) {
      throw new StateError(
        "UNSAFE_STATE_PATH",
        "Project state directory must be a real directory.",
      );
    }
    const lock = this.directory + "/write.lock";
    try {
      await Deno.mkdir(lock);
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        throw new StateError(
          "STATE_LOCKED",
          "Another writer or interrupted transaction owns write.lock. Inspect the owner and recover explicitly; locks are never stolen.",
        );
      }
      throw error;
    }
    const temp = this.path + ".tmp-" + crypto.randomUUID(),
      backupTemp = this.path + ".previous-" + crypto.randomUUID();
    try {
      await Deno.writeTextFile(
        lock + "/owner.json",
        JSON.stringify({ pid: Deno.pid, started: new Date().toISOString() }),
        { createNew: true },
      );
      const oldText = await readFile(this.path),
        old = oldText === undefined ? undefined : await this.decode(oldText);
      if (
        (old?.revision ?? 0) !== expectedRevision ||
        input.revision !== expectedRevision
      ) {
        throw new StateError(
          "STALE_REVISION",
          `State changed since revision ${expectedRevision}; reload before saving.`,
          { actual: old?.revision ?? 0 },
        );
      }
      if (old && old.docId !== input.docId) {
        throw new StateError(
          "DOC_ID_CHANGED",
          "Cannot replace a project with a different document identity.",
        );
      }
      const state = clone(input);
      state.revision = expectedRevision + 1;
      const content = JSON.stringify(
        {
          format: "qbento-state-envelope/1",
          sha256: await sha256(canonical(state)),
          state,
        },
        null,
        2,
      ) + "\n";
      await durableWrite(temp, content);
      if (oldText !== undefined) {
        await durableWrite(backupTemp, oldText);
        await Deno.rename(backupTemp, this.directory + "/state.previous.json");
      }
      await Deno.rename(temp, this.path);
      // fsync the directory on Unix; Windows directory handles do not support this operation.
      if (Deno.build.os !== "windows") {
        const dir = await Deno.open(this.directory, { read: true });
        try {
          await dir.sync();
        } finally {
          dir.close();
        }
      }
      return state;
    } finally {
      await Promise.all([temp, backupTemp].map(async (path) => {
        try {
          await Deno.remove(path);
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }));
      await Deno.remove(lock, { recursive: true });
    }
  }
  /** Read, validate and return the backup; restoring it is a separate deliberate operation. */
  async inspectRecovery(): Promise<ProjectState | undefined> {
    const text = await readFile(this.directory + "/state.previous.json");
    return text === undefined ? undefined : await this.decode(text);
  }
}
/** Call before touching the output, including before Quarto may overwrite it. Missing HTML is rebuildable. */
export async function assertOutputUnchanged(
  state: ProjectState | undefined,
  path: string,
): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (!state?.output || state.output.path !== path) {
    throw new StateError(
      "UNTRACKED_OUTPUT",
      `Existing output ${path} has no captured baseline. Capture it explicitly or choose a different output.`,
    );
  }
  if (await sha256(bytes) !== state.output.sha256) {
    throw new StateError(
      "UNCAPTURED_HTML_EDITS",
      `Output ${path} changed since last emission/capture. Capture its native Bento edits before regenerating.`,
    );
  }
}
/** Record only HTML whose write/capture the caller has completed successfully. */
export async function markEmitted(
  input: ProjectState,
  document: BentoDoc,
  path: string,
  html: string | Uint8Array,
): Promise<ProjectState> {
  validateState(input);
  validateDoc(document);
  if (document.docId !== input.docId) {
    throw new StateError(
      "DOC_ID_CHANGED",
      "Output identity differs from project.",
    );
  }
  const state = clone(input);
  state.emitted = clone(document);
  state.output = { path, sha256: await sha256(html) };
  return state;
}
