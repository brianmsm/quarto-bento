import { assertWidgetFiles } from "./widgets.ts";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { projectPaths } from "./project.ts";
import { validateSyncApproval } from "./sync.ts";
import {
  type AnnotationSummary,
  validateAnnotationSummary,
} from "./annotations.ts";
import { extractDocument } from "../render/html.ts";
import {
  canonical,
  clone,
  equal,
  type ProjectState,
  sha256,
  StateError,
  StateStore,
  validateState,
} from "../state/mod.ts";

export type RecoveryAction = "inspect" | "finish" | "rollback";
interface RenderJournal {
  version: 1;
  staging: string;
  backup: string;
  output: string;
  oldRevision: number;
  nextRevision: number;
  sha256: string;
  previousOutput: { path: string; sha256: string } | null;
  approval?: { path: string; sha256: string; archive: string };
}
interface SyncJournal {
  version: 1;
  transactionId: string;
  source: string;
  sourceBackup: string;
  stateBackup: string;
  staging: string;
  receiptPath: string;
  sourceHash: string;
  resultHash: string;
  stateRevision: number;
  planHash: string;
  selectedChangeIds: string[];
  approvalStaging?: string;
  approvalPath?: string;
  annotations?: AnnotationSummary;
}
export interface RecoveryFile {
  path: string;
  exists: boolean;
  sha256?: string;
  bytes?: number;
}
export interface RecoveryLock {
  path: string;
  status: "absent" | "dead" | "alive" | "ambiguous";
  owner?: unknown;
  ownerHash?: string;
}
export interface RecoveryReport {
  action: RecoveryAction;
  kind: "none" | "render" | "sync";
  status: string;
  journal?: RenderJournal | SyncJournal;
  stateRevision?: number;
  statePhase?: "before" | "after";
  files: Record<string, RecoveryFile>;
  locks: RecoveryLock[];
  available: RecoveryAction[];
  preserved: string[];
  diagnostics: string[];
}
const digest = /^[a-f0-9]{64}$/;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
function fail(code: string, message: string, details?: unknown): never {
  throw new StateError(code, message, details);
}
/** Refuse symlinks in every existing parent, not just the leaf named by a journal. */
async function safePath(
  path: string,
  kind: "file" | "directory",
  missing = true,
): Promise<boolean> {
  const absolute = resolve(path);
  const parts: string[] = [];
  let cursor = absolute;
  while (true) {
    parts.unshift(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  for (let i = 0; i < parts.length; i++) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.lstat(parts[i]);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound && missing) return false;
      throw e;
    }
    const wanted = i === parts.length - 1 ? kind : "directory";
    if (
      stat.isSymlink || (wanted === "file" ? !stat.isFile : !stat.isDirectory)
    ) {
      fail(
        "UNSAFE_RECOVERY_PATH",
        `Expected a regular ${wanted} without symlink parents: ${parts[i]}`,
      );
    }
  }
  return true;
}
async function evidence(path: string): Promise<RecoveryFile> {
  if (!await safePath(path, "file")) return { path, exists: false };
  const bytes = await Deno.readFile(path);
  return {
    path,
    exists: true,
    sha256: await sha256(bytes),
    bytes: bytes.length,
  };
}
async function lockEvidence(path: string): Promise<RecoveryLock> {
  if (!await safePath(path, "directory")) return { path, status: "absent" };
  const ownerPath = join(path, "owner.json");
  if (!await safePath(ownerPath, "file")) return { path, status: "ambiguous" };
  const text = await Deno.readTextFile(ownerPath),
    ownerHash = await sha256(text);
  let owner: { pid?: unknown; started?: unknown };
  try {
    owner = JSON.parse(text);
  } catch {
    return { path, status: "ambiguous", ownerHash };
  }
  if (
    !owner || !Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0 ||
    typeof owner.started !== "string" ||
    !Number.isFinite(Date.parse(owner.started))
  ) return { path, status: "ambiguous", owner, ownerHash };
  try {
    process.kill(Number(owner.pid), 0);
    return { path, status: "alive", owner, ownerHash };
  } catch (e) {
    return {
      path,
      status: (e as { code?: string }).code === "ESRCH" ? "dead" : "ambiguous",
      owner,
      ownerHash,
    };
  }
}
function validateJournal(
  value: unknown,
  paths: ReturnType<typeof projectPaths>,
): RenderJournal {
  const j = value as RenderJournal;
  if (
    !j || j.version !== 1 || !Number.isSafeInteger(j.oldRevision) ||
    j.oldRevision < 0 || j.nextRevision !== j.oldRevision + 1 ||
    typeof j.sha256 !== "string" || !digest.test(j.sha256)
  ) {
    fail(
      "INVALID_RECOVERY_JOURNAL",
      "Unsupported or malformed render transaction.",
    );
  }
  if (
    j.output !== paths.output || typeof j.staging !== "string" ||
    dirname(j.staging) !== paths.directory ||
    !new RegExp("^" + uuid + "$").test(
      j.staging.slice((paths.output + ".pending-").length),
    ) || !j.staging.startsWith(paths.output + ".pending-")
  ) {
    fail(
      "INVALID_RECOVERY_PATH",
      "Journal output/staging paths do not belong to this project.",
    );
  }
  if (
    typeof j.backup !== "string" ||
    dirname(j.backup) !== join(paths.stateDir, "history") ||
    !new RegExp("^output-" + uuid + "\\.html$").test(basename(j.backup))
  ) {
    fail(
      "INVALID_RECOVERY_PATH",
      "Journal backup path is not a project output history entry.",
    );
  }
  if (
    j.previousOutput !== null &&
    (!j.previousOutput || j.previousOutput.path !== paths.output ||
      !digest.test(j.previousOutput.sha256))
  ) fail("INVALID_RECOVERY_JOURNAL", "Invalid previous output receipt.");
  if (
    j.approval !== undefined &&
    (!j.approval ||
      j.approval.path !== join(paths.stateDir, "sync-approved.json") ||
      typeof j.approval.sha256 !== "string" ||
      !digest.test(j.approval.sha256) ||
      typeof j.approval.archive !== "string" ||
      dirname(j.approval.archive) !== join(paths.stateDir, "history") ||
      !new RegExp("^consumed-sync-" + uuid + "\\.json$").test(
        basename(j.approval.archive),
      ))
  ) {
    fail(
      "INVALID_RECOVERY_PATH",
      "Render approval paths and digest must match scoped project history.",
    );
  }
  return j;
}
interface Snapshot {
  paths: ReturnType<typeof projectPaths>;
  report: RecoveryReport;
  state?: ProjectState;
  previous?: ProjectState;
  journalHash?: string;
}
async function inspect(source: string): Promise<Snapshot> {
  const paths = projectPaths(source),
    report: RecoveryReport = {
      action: "inspect",
      kind: "none",
      status: "clean",
      files: {},
      locks: [],
      available: ["inspect"],
      preserved: [],
      diagnostics: [],
    };
  await safePath(paths.source, "file");
  if (!await safePath(paths.stateDir, "directory")) return { paths, report };
  const identity = join(paths.stateDir, "project.json");
  await safePath(identity, "file", false);
  const meta = JSON.parse(await Deno.readTextFile(identity));
  if (meta.version !== 1 || meta.source !== basename(paths.source)) {
    fail(
      "PROJECT_SOURCE_MISMATCH",
      "Recovery directory belongs to another source.",
    );
  }
  report.locks = await Promise.all(
    ["operation.lock", "write.lock"].map((name) =>
      lockEvidence(join(paths.stateDir, name))
    ),
  );
  const sync = await evidence(join(paths.stateDir, "sync-transaction.json"));
  if (sync.exists) {
    if (
      (await evidence(join(paths.stateDir, "render-transaction.json"))).exists
    ) {
      fail(
        "MULTIPLE_RECOVERY_TRANSACTIONS",
        "Render and sync journals coexist; inspect manually instead of guessing operation order.",
      );
    }
    return await inspectSync(paths, report, sync);
  }
  const journalFile = await evidence(
    join(paths.stateDir, "render-transaction.json"),
  );
  report.files.journal = journalFile;
  if (!journalFile.exists) {
    report.status = report.locks.some((l) => l.status !== "absent")
      ? "lock-without-transaction"
      : "clean";
    report.diagnostics.push(
      "No interrupted render transaction. Lock-only cleanup requires owner investigation.",
    );
    return { paths, report };
  }
  let parsed;
  try {
    parsed = JSON.parse(await Deno.readTextFile(journalFile.path));
  } catch {
    fail("INVALID_RECOVERY_JOURNAL", "Render transaction is not valid JSON.");
  }
  const journal = validateJournal(parsed, paths);
  report.kind = "render";
  report.journal = journal;
  report.status = "interrupted";
  for (
    const [name, path] of Object.entries({
      staging: journal.staging,
      backup: journal.backup,
      output: journal.output,
      state: join(paths.stateDir, "state.json"),
      previous: join(paths.stateDir, "state.previous.json"),
    })
  ) report.files[name] = await evidence(path);
  if (journal.approval) {
    report.files.approval = await evidence(journal.approval.path);
    report.files.approvalArchive = await evidence(journal.approval.archive);
    if (!report.files.approval.exists && !report.files.approvalArchive.exists) {
      fail(
        "RECOVERY_APPROVAL_MISSING",
        "Consumed render approval is missing from both active and archived paths.",
      );
    }
    for (const name of ["approval", "approvalArchive"]) {
      if (
        report.files[name].exists &&
        report.files[name].sha256 !== journal.approval.sha256
      ) {
        fail(
          "RECOVERY_APPROVAL_MISMATCH",
          "Render approval evidence differs from the exact transaction receipt; it will not be overwritten.",
        );
      }
    }
    if (report.files.approvalArchive.exists) {
      report.preserved.push(journal.approval.archive);
    }
  }
  if (
    report.files.staging.exists &&
    report.files.staging.sha256 !== journal.sha256
  ) {
    fail(
      "RECOVERY_STAGING_CHANGED",
      "Staged HTML differs from the transaction receipt; preserve it for manual review.",
    );
  }
  const store = new StateStore(paths.stateDir), state = await store.load();
  const revision = state?.revision ?? 0;
  report.stateRevision = revision;
  if (revision === journal.oldRevision) report.statePhase = "before";
  else if (revision === journal.nextRevision) report.statePhase = "after";
  else {fail(
      "RECOVERY_STATE_CHANGED",
      "State revision is neither the transaction baseline nor its next revision; later edits must not be rolled back.",
      { revision, journal },
    );}
  let previous: ProjectState | undefined;
  if (report.statePhase === "after") {
    if (
      !state?.output || state.output.path !== journal.output ||
      state.output.sha256 !== journal.sha256
    ) {
      fail(
        "RECOVERY_RECEIPT_MISMATCH",
        "Current state does not carry the interrupted render receipt.",
      );
    }
    if (journal.oldRevision > 0) {
      previous = await store.inspectRecovery();
      if (
        !previous || previous.revision !== journal.oldRevision ||
        previous.docId !== state.docId ||
        !equal(previous.output ?? null, journal.previousOutput)
      ) {
        fail(
          "RECOVERY_PREVIOUS_MISMATCH",
          "Previous envelope does not match the exact pre-render state.",
        );
      }
    }
    for (const name of ["staging", "output"]) {
      const file = report.files[name];
      if (file.exists && file.sha256 === journal.sha256) {
        const doc = extractDocument(await Deno.readTextFile(file.path));
        if (!equal(doc, state.emitted)) {
          fail(
            "RECOVERY_DOCUMENT_MISMATCH",
            "Output payload differs from the committed state snapshot.",
          );
        }
      }
    }
  } else if (!equal(state?.output ?? null, journal.previousOutput)) {
    fail(
      "RECOVERY_RECEIPT_MISMATCH",
      "Baseline state does not match the recorded previous output.",
    );
  }
  if (report.files.backup.exists) report.preserved.push(journal.backup);
  const output = report.files.output;
  const knownOutput = !output.exists || output.sha256 === journal.sha256 ||
    output.sha256 === journal.previousOutput?.sha256 ||
    output.sha256 === report.files.backup.sha256;
  let widgetsValid = true;
  if (report.statePhase === "after" && state?.widgets) {
    try {
      await assertWidgetFiles(paths.stateDir, state);
    } catch (error) {
      widgetsValid = false;
      report.diagnostics.push(
        `Widget resources block finishing this render: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const locksSafe = report.locks.every((l) =>
    l.status === "absent" || l.status === "dead"
  );
  if (!knownOutput) {
    report.diagnostics.push(
      "Concurrent output differs from all transaction evidence. Recovery refuses to overwrite it.",
    );
  }
  if (!locksSafe) {
    report.diagnostics.push(
      "A live or ambiguous lock owner blocks mutation. Inspect is read-only.",
    );
  }
  if (report.statePhase === "before") {
    report.diagnostics.push(
      "Next generated baseline was not committed. Finish cannot reconstruct it from merged HTML; rollback and render again.",
    );
  }
  if (locksSafe && knownOutput) {
    report.available.push("rollback");
    if (
      widgetsValid && report.statePhase === "after" &&
      (!output.exists || output.sha256 === journal.sha256) &&
      (report.files.staging.exists || output.sha256 === journal.sha256)
    ) report.available.push("finish");
  }
  return { paths, report, state, previous, journalHash: journalFile.sha256 };
}
async function durable(path: string, bytes: Uint8Array) {
  const file = await Deno.open(path, {
    createNew: true,
    write: true,
    mode: 0o600,
  });
  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
  } finally {
    file.close();
  }
}
async function acquireLock(
  path: string,
  history: string,
  preserved: string[],
): Promise<() => Promise<void>> {
  const before = await lockEvidence(path);
  if (before.status === "alive" || before.status === "ambiguous") {
    fail(
      "RECOVERY_LOCKED",
      "Recovery cannot release a live or ambiguous lock.",
      before,
    );
  }
  if (before.status === "dead") {
    const again = await lockEvidence(path);
    if (again.status !== "dead" || again.ownerHash !== before.ownerHash) {
      fail(
        "RECOVERY_LOCK_CHANGED",
        "Lock ownership changed during inspection.",
      );
    }
    const archived = join(history, basename(path) + "-" + crypto.randomUUID());
    await Deno.rename(path, archived);
    preserved.push(archived);
  }
  try {
    await Deno.mkdir(path);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      fail(
        "RECOVERY_LOCKED",
        "A concurrent operation acquired the project lock.",
      );
    }
    throw e;
  }
  const owner = JSON.stringify({
    pid: Deno.pid,
    started: new Date().toISOString(),
    recovery: true,
    token: crypto.randomUUID(),
  });
  await Deno.writeTextFile(join(path, "owner.json"), owner, {
    createNew: true,
  });
  return async () => {
    if (await Deno.readTextFile(join(path, "owner.json")) !== owner) {
      fail(
        "RECOVERY_LOCK_CHANGED",
        "Recovery lock owner changed; it will not be removed.",
      );
    }
    await Deno.remove(path, { recursive: true });
  };
}
async function publishNoClobber(from: string, to: string) {
  try {
    await Deno.link(from, to);
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      fail(
        "RECOVERY_OUTPUT_CHANGED",
        "An output appeared during recovery. It was not overwritten.",
      );
    }
    throw e;
  }
}
async function archiveOutput(
  path: string,
  expected: string,
  history: string,
  preserved: string[],
): Promise<void> {
  const archive = join(
    history,
    "recovery-output-" + crypto.randomUUID() +
      (path.endsWith(".json")
        ? ".json"
        : path.endsWith(".qmd")
        ? ".qmd"
        : ".html"),
  );
  await Deno.rename(path, archive);
  preserved.push(archive);
  const actual = await evidence(archive);
  if (actual.sha256 !== expected) {
    try {
      await publishNoClobber(archive, path);
    } catch (e) {
      if (!(e instanceof StateError && e.code === "RECOVERY_OUTPUT_CHANGED")) {
        throw e;
      }
    }
    fail(
      "RECOVERY_OUTPUT_CHANGED",
      "A concurrent output change was preserved; recovery stopped.",
      { archive },
    );
  }
}
/** Deliberate recovery only. Inspect is read-only and never removes a lock or journal. */
export async function recoverProject(
  source: string,
  action: RecoveryAction = "inspect",
): Promise<RecoveryReport> {
  if (!["inspect", "finish", "rollback"].includes(action)) {
    fail("INVALID_RECOVERY_ACTION", "Expected inspect, finish or rollback.");
  }
  const initial = await inspect(source);
  if (action === "inspect") return initial.report;
  if (initial.report.kind === "sync") {
    return await recoverSyncTransaction(initial, action);
  }
  if (initial.report.kind !== "render") {
    fail(
      "NO_RENDER_TRANSACTION",
      "No render transaction exists to finish or roll back.",
      initial.report,
    );
  }
  if (!initial.report.available.includes(action)) {
    fail(
      initial.report.statePhase === "before" && action === "finish"
        ? "RECOVERY_STATE_NOT_COMMITTED"
        : "RECOVERY_BLOCKED",
      "Requested recovery action is unsafe for the observed evidence.",
      initial.report,
    );
  }
  const history = join(initial.paths.stateDir, "history");
  await Deno.mkdir(history, { recursive: true });
  await safePath(history, "directory", false);
  const preserved = [...initial.report.preserved],
    release = await acquireLock(
      join(initial.paths.stateDir, "operation.lock"),
      history,
      preserved,
    );
  try {
    const releaseWrite = await acquireLock(
      join(initial.paths.stateDir, "write.lock"),
      history,
      preserved,
    );
    try {
      const snapshot = await inspect(source),
        { paths, report, state } = snapshot,
        j = report.journal as RenderJournal;
      if (
        snapshot.journalHash !== initial.journalHash ||
        report.files.state.sha256 !== initial.report.files.state.sha256 ||
        report.files.previous.sha256 !== initial.report.files.previous.sha256
      ) {
        fail(
          "RECOVERY_CHANGED",
          "Transaction or state changed while acquiring recovery locks.",
        );
      }
      // Our locks are now live. Recheck all file evidence and reject unmanaged output changes.
      for (const name of ["staging", "backup", "output"]) {
        if (
          report.files[name].sha256 !== initial.report.files[name].sha256 ||
          report.files[name].exists !== initial.report.files[name].exists
        ) {
          fail(
            "RECOVERY_CHANGED",
            "Transaction files changed while acquiring recovery locks.",
          );
        }
      }
      if (j.approval) {
        for (const name of ["approval", "approvalArchive"]) {
          if (
            report.files[name].sha256 !== initial.report.files[name].sha256 ||
            report.files[name].exists !== initial.report.files[name].exists
          ) {
            fail(
              "RECOVERY_CHANGED",
              "Render approval changed while recovery acquired locks.",
            );
          }
        }
      }
      if (action === "finish") {
        if (state?.widgets) await assertWidgetFiles(paths.stateDir, state);
        if (!report.files.output.exists) {
          await publishNoClobber(j.staging, j.output);
        }
        if ((await evidence(j.output)).sha256 !== j.sha256) {
          fail(
            "RECOVERY_OUTPUT_CHANGED",
            "Published output changed; transaction remains for review.",
          );
        }
      } else {
        const output = report.files.output;
        if (
          output.exists && output.sha256 === j.sha256 &&
          output.sha256 !== j.previousOutput?.sha256
        ) await archiveOutput(j.output, j.sha256, history, preserved);
        const current = await evidence(j.output);
        if (!current.exists && report.files.backup.exists) {
          await publishNoClobber(j.backup, j.output);
        } else if (!current.exists && j.previousOutput) {
          fail(
            "RECOVERY_BACKUP_MISSING",
            "Prior output was present but no recoverable backup remains.",
          );
        }
        if (report.statePhase === "after") {
          const statePath = join(paths.stateDir, "state.json"),
            archive = join(
              history,
              "state-next-" + crypto.randomUUID() + ".json",
            );
          if (
            (await evidence(statePath)).sha256 !== report.files.state.sha256
          ) fail("RECOVERY_STATE_CHANGED", "State changed during rollback.");
          await Deno.link(statePath, archive);
          preserved.push(archive);
          if (j.oldRevision === 0) {
            if (!state || state.revision !== 1) {
              fail(
                "RECOVERY_STATE_CHANGED",
                "Initial render rollback expected revision one.",
              );
            }
            await Deno.remove(statePath);
          } else {
            const oldBytes = await Deno.readFile(report.files.previous.path),
              temp = join(
                history,
                "restore-state-" + crypto.randomUUID() + ".json",
              );
            await durable(temp, oldBytes);
            await Deno.rename(temp, statePath);
          }
        }
      }
      if (j.approval) {
        if (action === "finish") {
          if (!report.files.approvalArchive.exists) {
            await publishNoClobber(j.approval.path, j.approval.archive);
          }
          if (
            (await evidence(j.approval.archive)).sha256 !== j.approval.sha256
          ) {
            fail(
              "RECOVERY_APPROVAL_MISMATCH",
              "Archived approval changed during render recovery.",
            );
          }
          preserved.push(j.approval.archive);
          if (report.files.approval.exists) {
            await archiveOutput(
              j.approval.path,
              j.approval.sha256,
              history,
              preserved,
            );
          }
        } else if (!report.files.approval.exists) {
          await publishNoClobber(j.approval.archive, j.approval.path);
          if ((await evidence(j.approval.path)).sha256 !== j.approval.sha256) {
            fail(
              "RECOVERY_APPROVAL_MISMATCH",
              "Restored approval changed during rollback.",
            );
          }
          preserved.push(j.approval.archive);
        }
      }
      // Keep staged bytes, original HTML and the exact journal for forensic recovery.
      if (report.files.staging.exists) preserved.push(j.staging);
      const archivedJournal = join(
        history,
        "render-transaction-" + crypto.randomUUID() + ".json",
      );
      await Deno.rename(report.files.journal.path, archivedJournal);
      preserved.push(archivedJournal);
      if (Deno.build.os !== "windows") {
        for (const dir of [paths.directory, paths.stateDir, history]) {
          const f = await Deno.open(dir, { read: true });
          try {
            await f.sync();
          } finally {
            f.close();
          }
        }
      }
      return {
        ...report,
        action,
        status: action === "finish" ? "finished" : "rolled-back",
        available: ["inspect"],
        preserved,
        diagnostics: action === "rollback" && report.files.backup.exists &&
            report.files.backup.sha256 !== j.previousOutput?.sha256
          ? [
            "Concurrent native edits restored from backup; capture them before rendering.",
          ]
          : [],
      };
    } finally {
      await releaseWrite();
    }
  } finally {
    await release();
  }
}

async function readEnvelope(path: string): Promise<ProjectState> {
  await safePath(path, "file", false);
  let parsed;
  try {
    parsed = JSON.parse(await Deno.readTextFile(path));
  } catch {
    fail(
      "CORRUPT_RECOVERY_STATE",
      "Recovery state envelope is not valid JSON.",
    );
  }
  if (parsed?.format !== "qbento-state-envelope/1") {
    fail("CORRUPT_RECOVERY_STATE", "Unsupported recovery envelope.");
  }
  validateState(parsed.state);
  if (await sha256(canonical(parsed.state)) !== parsed.sha256) {
    fail(
      "CORRUPT_RECOVERY_STATE",
      "Recovery state envelope checksum does not match.",
    );
  }
  return parsed.state;
}
function validateSync(
  value: unknown,
  paths: ReturnType<typeof projectPaths>,
): SyncJournal {
  const j = value as SyncJournal;
  if (
    !j || j.version !== 1 || typeof j.transactionId !== "string" ||
    !new RegExp("^" + uuid + "$").test(j.transactionId) ||
    !Number.isSafeInteger(j.stateRevision) || j.stateRevision < 1 ||
    ![j.sourceHash, j.resultHash, j.planHash].every((v) =>
      typeof v === "string" && digest.test(v)
    ) || !Array.isArray(j.selectedChangeIds) ||
    !j.selectedChangeIds.every((v) => typeof v === "string") ||
    new Set(j.selectedChangeIds).size !== j.selectedChangeIds.length
  ) {
    fail(
      "INVALID_RECOVERY_JOURNAL",
      "Unsupported or malformed source sync transaction.",
    );
  }
  if (j.annotations !== undefined) validateAnnotationSummary(j.annotations);
  const history = join(paths.stateDir, "history");
  if (
    j.source !== paths.source ||
    j.sourceBackup !== join(history, "source-" + j.transactionId + ".qmd") ||
    j.stateBackup !== join(history, "state-" + j.transactionId + ".json") ||
    j.receiptPath !== join(history, "sync-" + j.transactionId + ".json") ||
    j.staging !==
      join(
        paths.directory,
        "." + basename(paths.source) + ".sync-" + j.transactionId,
      )
  ) {
    fail(
      "INVALID_RECOVERY_PATH",
      "Sync journal paths are not the exact scoped transaction paths.",
    );
  }
  if (
    (j.approvalStaging !== undefined || j.approvalPath !== undefined) &&
    (j.approvalStaging !==
        join(history, "sync-approval-" + j.transactionId + ".json") ||
      j.approvalPath !== join(paths.stateDir, "sync-approved.json"))
  ) {
    fail(
      "INVALID_RECOVERY_PATH",
      "Sync approval paths do not match the exact transaction stage and project approval file.",
    );
  }
  return j;
}
function syncReceipt(j: SyncJournal) {
  return {
    version: 1,
    transactionId: j.transactionId,
    source: j.source,
    planHash: j.planHash,
    previousSourceHash: j.sourceHash,
    sourceHash: j.resultHash,
    previousRevision: j.stateRevision,
    revision: j.stateRevision + 1,
    appliedChangeIds: j.selectedChangeIds,
    sourceBackup: j.sourceBackup,
    stateBackup: j.stateBackup,
    receiptPath: j.receiptPath,
    renderNeeded: true,
    pendingRetained: true,
    ...(j.annotations ? { annotations: clone(j.annotations) } : {}),
  };
}
async function inspectSync(
  paths: ReturnType<typeof projectPaths>,
  report: RecoveryReport,
  file: RecoveryFile,
): Promise<Snapshot> {
  let parsed;
  try {
    parsed = JSON.parse(await Deno.readTextFile(file.path));
  } catch {
    fail("INVALID_RECOVERY_JOURNAL", "Sync transaction is not valid JSON.");
  }
  const j = validateSync(parsed, paths);
  report.kind = "sync";
  report.status = "interrupted";
  report.journal = j;
  report.files.journal = file;
  for (
    const [name, path] of Object.entries({
      staging: j.staging,
      source: j.source,
      backup: j.sourceBackup,
      stateBackup: j.stateBackup,
      receipt: j.receiptPath,
      state: join(paths.stateDir, "state.json"),
      previous: join(paths.stateDir, "state.previous.json"),
    })
  ) report.files[name] = await evidence(path);
  const baseline = await readEnvelope(j.stateBackup);
  if (baseline.revision !== j.stateRevision) {
    fail(
      "RECOVERY_PREVIOUS_MISMATCH",
      "Sync baseline envelope has a different revision.",
    );
  }
  if (j.approvalStaging && j.approvalPath) {
    report.files.approvalStaging = await evidence(j.approvalStaging);
    report.files.approval = await evidence(j.approvalPath);
    if (!report.files.approvalStaging.exists) {
      fail(
        "RECOVERY_APPROVAL_MISSING",
        "The durable approval stage is missing; preserve the transaction for explicit review.",
      );
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(await Deno.readTextFile(j.approvalStaging));
    } catch {
      fail(
        "RECOVERY_APPROVAL_INVALID",
        "Staged synchronization approval is not JSON.",
      );
    }
    validateSyncApproval(envelope);
    const approval = envelope.approval;
    if (
      approval.docId !== baseline.docId ||
      approval.sourceHash !== j.resultHash ||
      approval.stateRevision !== j.stateRevision + 1 ||
      approval.planHash !== j.planHash ||
      !equal(
        approval.expectedPending.map((p) => p.id),
        j.selectedChangeIds,
      ) || approval.expectedPending.some((p) =>
        !equal(
          p,
          baseline.pending.find((original) => original.id === p.id),
        )
      )
    ) {
      fail(
        "RECOVERY_APPROVAL_MISMATCH",
        "Staged approval does not match the reviewed source transaction and exact pending baseline.",
      );
    }
    if (
      report.files.approval.exists &&
      report.files.approval.sha256 !== report.files.approvalStaging.sha256
    ) {
      fail(
        "RECOVERY_APPROVAL_MISMATCH",
        "The active project approval differs from this transaction; it will not be overwritten or deleted.",
      );
    }
    report.preserved.push(j.approvalStaging);
  }
  const state = await new StateStore(paths.stateDir).load();
  if (!state) {
    fail(
      "RECOVERY_STATE_CHANGED",
      "A sync transaction cannot recover a missing project state.",
    );
  }
  report.stateRevision = state.revision;
  const comparable = clone(state);
  comparable.revision = baseline.revision;
  if (
    !equal(comparable, baseline) ||
    ![j.stateRevision, j.stateRevision + 1].includes(state.revision)
  ) {
    fail(
      "RECOVERY_STATE_CHANGED",
      "Project changes after synchronization prevent automatic finish or rollback.",
    );
  }
  report.statePhase = state.revision === j.stateRevision ? "before" : "after";
  if (
    report.files.staging.exists && report.files.staging.sha256 !== j.resultHash
  ) {
    fail(
      "RECOVERY_STAGING_CHANGED",
      "Sync staging content differs from the approved source result.",
    );
  }
  if (report.files.receipt.exists) {
    let receipt;
    try {
      receipt = JSON.parse(await Deno.readTextFile(j.receiptPath));
    } catch {
      fail("RECOVERY_RECEIPT_MISMATCH", "Existing sync receipt is corrupt.");
    }
    if (!equal(receipt, syncReceipt(j))) {
      fail(
        "RECOVERY_RECEIPT_MISMATCH",
        "Existing sync receipt describes a different operation.",
      );
    }
  }
  if (report.files.backup.exists) report.preserved.push(j.sourceBackup);
  report.preserved.push(j.stateBackup);
  const current = report.files.source, backup = report.files.backup;
  const knownSource = !current.exists || current.sha256 === j.sourceHash ||
    current.sha256 === j.resultHash ||
    (backup.exists && current.sha256 === backup.sha256);
  const locksSafe = report.locks.every((l) =>
    l.status === "absent" || l.status === "dead"
  );
  if (!knownSource) {
    report.diagnostics.push(
      "Source changed after synchronization. Recovery preserves it and refuses automatic replacement.",
    );
  }
  if (!locksSafe) {
    report.diagnostics.push("A live or ambiguous lock owner blocks mutation.");
  }
  if (knownSource && locksSafe) {
    if (
      (current.exists && current.sha256 !== j.resultHash) || backup.exists ||
      j.sourceHash === j.resultHash
    ) report.available.push("rollback");
    const canBackup = backup.exists
      ? backup.sha256 === j.sourceHash
      : current.sha256 === j.sourceHash;
    if (
      canBackup &&
      (current.sha256 === j.resultHash || report.files.staging.exists)
    ) report.available.push("finish");
  }
  return { paths, report, state, previous: baseline, journalHash: file.sha256 };
}
/** Caller holds both operation and state-write locks; preserve exact prior envelope. */
async function replaceState(
  snapshot: Snapshot,
  state: ProjectState,
  preserved: string[],
) {
  const statePath = join(snapshot.paths.stateDir, "state.json"),
    history = join(snapshot.paths.stateDir, "history");
  if (
    (await evidence(statePath)).sha256 !== snapshot.report.files.state.sha256
  ) fail("RECOVERY_STATE_CHANGED", "State changed during recovery.");
  const archive = join(
    history,
    "state-recovery-" + crypto.randomUUID() + ".json",
  );
  await Deno.link(statePath, archive);
  preserved.push(archive);
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      {
        format: "qbento-state-envelope/1",
        sha256: await sha256(canonical(state)),
        state,
      },
      null,
      2,
    ) + "\n",
  );
  const temp = join(history, "state-pending-" + crypto.randomUUID() + ".json");
  await durable(temp, bytes);
  await Deno.rename(temp, statePath);
}
async function recoverSyncTransaction(
  initial: Snapshot,
  action: RecoveryAction,
): Promise<RecoveryReport> {
  if (!initial.report.available.includes(action)) {
    fail(
      "RECOVERY_BLOCKED",
      "Requested sync recovery is unsafe for the observed source/state/lock evidence.",
      initial.report,
    );
  }
  const history = join(initial.paths.stateDir, "history");
  await safePath(history, "directory", false);
  const preserved = [...initial.report.preserved],
    release = await acquireLock(
      join(initial.paths.stateDir, "operation.lock"),
      history,
      preserved,
    );
  try {
    const releaseWrite = await acquireLock(
      join(initial.paths.stateDir, "write.lock"),
      history,
      preserved,
    );
    try {
      const snapshot = await inspect(initial.paths.source),
        { paths, report } = snapshot,
        j = report.journal as SyncJournal;
      if (
        report.kind !== "sync" || snapshot.journalHash !== initial.journalHash
      ) {
        fail(
          "RECOVERY_CHANGED",
          "Sync transaction changed while recovery acquired locks.",
        );
      }
      for (
        const name of [
          "staging",
          "source",
          "backup",
          "stateBackup",
          "receipt",
          "state",
        ]
      ) {
        if (
          report.files[name].sha256 !== initial.report.files[name].sha256 ||
          report.files[name].exists !== initial.report.files[name].exists
        ) {
          fail(
            "RECOVERY_CHANGED",
            "Source or sync evidence changed while recovery acquired locks.",
          );
        }
      }
      if (j.approvalStaging && j.approvalPath) {
        for (const name of ["approvalStaging", "approval"]) {
          if (
            report.files[name].sha256 !== initial.report.files[name].sha256 ||
            report.files[name].exists !== initial.report.files[name].exists
          ) {
            fail(
              "RECOVERY_CHANGED",
              "Approval metadata changed while recovery acquired locks.",
            );
          }
        }
      }
      if (action === "finish") {
        if (report.files.source.sha256 !== j.resultHash) {
          if (report.files.source.exists) {
            if (!report.files.backup.exists) {
              await Deno.rename(j.source, j.sourceBackup);
              preserved.push(j.sourceBackup);
              if ((await evidence(j.sourceBackup)).sha256 !== j.sourceHash) {
                try {
                  await publishNoClobber(j.sourceBackup, j.source);
                } catch (e) {
                  if (
                    !(e instanceof StateError &&
                      e.code === "RECOVERY_OUTPUT_CHANGED")
                  ) throw e;
                }
                fail(
                  "RECOVERY_SOURCE_CHANGED",
                  "Concurrent source edit was preserved; synchronization recovery stopped.",
                );
              }
            } else {await archiveOutput(
                j.source,
                j.sourceHash,
                history,
                preserved,
              );}
          }
          await publishNoClobber(j.staging, j.source);
        }
        if ((await evidence(j.source)).sha256 !== j.resultHash) {
          fail(
            "RECOVERY_SOURCE_CHANGED",
            "Source changed during sync finish; journal remains.",
          );
        }
        if (report.statePhase === "before") {
          const next = clone(snapshot.previous!);
          next.revision = j.stateRevision + 1;
          await replaceState(snapshot, next, preserved);
        }
        if (j.approvalStaging && j.approvalPath) {
          if (!report.files.approval.exists) {
            await publishNoClobber(j.approvalStaging, j.approvalPath);
          }
          if (
            (await evidence(j.approvalPath)).sha256 !==
              report.files.approvalStaging.sha256
          ) {
            fail(
              "RECOVERY_APPROVAL_MISMATCH",
              "Published approval changed during recovery; preserve the transaction.",
            );
          }
          preserved.push(j.approvalPath);
        }
        if (!report.files.receipt.exists) {
          await durable(
            j.receiptPath,
            new TextEncoder().encode(
              JSON.stringify(syncReceipt(j), null, 2) + "\n",
            ),
          );
        }
      } else {
        if (
          report.files.source.exists &&
          report.files.source.sha256 === j.resultHash &&
          j.resultHash !== j.sourceHash
        ) await archiveOutput(j.source, j.resultHash, history, preserved);
        if (!(await evidence(j.source)).exists) {
          if (!report.files.backup.exists) {
            fail(
              "RECOVERY_BACKUP_MISSING",
              "Original source backup is missing.",
            );
          }
          await publishNoClobber(j.sourceBackup, j.source);
        }
        if (report.statePhase === "after") {
          await replaceState(snapshot, snapshot.previous!, preserved);
        }
        if (j.approvalPath && report.files.approval.exists) {
          await archiveOutput(
            j.approvalPath,
            report.files.approvalStaging.sha256!,
            history,
            preserved,
          );
        }
        // A rollback keeps the old success receipt as historical evidence, not an active transaction.
      }
      const expectedSource = action === "finish"
        ? j.resultHash
        : report.files.backup.exists
        ? report.files.backup.sha256
        : j.sourceHash;
      if ((await evidence(j.source)).sha256 !== expectedSource) {
        fail(
          "RECOVERY_SOURCE_CHANGED",
          "Source changed before recovery completion; journal remains.",
        );
      }
      if (report.files.staging.exists) preserved.push(j.staging);
      if (report.files.receipt.exists || action === "finish") {
        preserved.push(j.receiptPath);
      }
      const archived = join(
        history,
        "sync-transaction-" + crypto.randomUUID() + ".json",
      );
      await Deno.rename(report.files.journal.path, archived);
      preserved.push(archived);
      if (Deno.build.os !== "windows") {
        for (const dir of [paths.directory, paths.stateDir, history]) {
          const f = await Deno.open(dir, { read: true });
          try {
            await f.sync();
          } finally {
            f.close();
          }
        }
      }
      return {
        ...report,
        action,
        status: action === "finish" ? "finished" : "rolled-back",
        available: ["inspect"],
        preserved,
        diagnostics: action === "rollback" && report.files.backup.exists &&
            report.files.backup.sha256 !== j.sourceHash
          ? [
            "Concurrent source edit restored from backup; review it before synchronization.",
          ]
          : [],
      };
    } finally {
      await releaseWrite();
    }
  } finally {
    await release();
  }
}
