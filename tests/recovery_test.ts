import { join } from "node:path";
import { recoverProject } from "../src/core/recovery.ts";
import {
  type BentoDoc,
  canonical,
  createState,
  markEmitted,
  sha256,
  StateError,
  StateStore,
} from "../src/state/mod.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    assert(e instanceof StateError && e.code === code, String(e));
    return;
  }
  throw new Error("Expected " + code);
}
const html = (doc: BentoDoc) =>
  '<script id="bento-doc" type="application/json">' + JSON.stringify(doc) +
  "</script>";
async function fixture(
  stage: "journal" | "backup" | "state" | "published" | "cleaned",
  initial = false,
) {
  const dir = await Deno.makeTempDir({ prefix: "qb-recovery-" }),
    source = join(dir, "deck.qmd"),
    stateDir = join(dir, ".qbento"),
    output = join(dir, "deck.bento.html");
  await Deno.writeTextFile(source, "## A {#a}\n");
  await Deno.mkdir(join(stateDir, "history"), { recursive: true });
  await Deno.writeTextFile(
    join(stateDir, "project.json"),
    JSON.stringify({ version: 1, source: "deck.qmd" }),
  );
  const document: BentoDoc = {
    docId: "stable",
    format: "bento/slides",
    version: 1,
    slides: [{ id: "a", elements: [] }],
  };
  const original = html(document);
  const nextDoc = structuredClone(document);
  nextDoc.title = "Updated";
  const next = html(nextDoc);
  const store = new StateStore(stateDir);
  let state = createState(document);
  if (!initial) {
    await Deno.writeTextFile(output, original);
    state = await store.save(
      await markEmitted(state, document, output, original),
    );
  }
  const staging = output + ".pending-" + crypto.randomUUID(),
    backup = join(
      stateDir,
      "history",
      "output-" + crypto.randomUUID() + ".html",
    ),
    journalPath = join(stateDir, "render-transaction.json");
  await Deno.writeTextFile(staging, next);
  const journal = {
    version: 1,
    staging,
    backup,
    output,
    oldRevision: state.revision,
    nextRevision: state.revision + 1,
    sha256: await sha256(next),
    previousOutput: state.output ?? null,
  };
  await Deno.writeTextFile(journalPath, JSON.stringify(journal));
  if (stage !== "journal" && !initial) await Deno.rename(output, backup);
  if (["state", "published", "cleaned"].includes(stage)) {
    state = await store.save(await markEmitted(state, nextDoc, output, next));
  }
  if (["published", "cleaned"].includes(stage)) {
    await Deno.link(staging, output);
  }
  if (stage === "cleaned") await Deno.remove(staging);
  return {
    dir,
    source,
    stateDir,
    output,
    original,
    next,
    store,
    state,
    journal,
    journalPath,
    staging,
    backup,
  };
}
for (
  const stage of ["journal", "backup", "state", "published", "cleaned"] as const
) {
  Deno.test("render recovery rollback at " + stage, async () => {
    const f = await fixture(stage);
    try {
      const inspected = await recoverProject(f.source);
      assert(inspected.available.includes("rollback"));
      const result = await recoverProject(f.source, "rollback");
      assert(result.status === "rolled-back");
      assert(await Deno.readTextFile(f.output) === f.original);
      assert((await f.store.load())?.revision === 1);
      assert(!(await recoverProject(f.source)).files.journal.exists);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  });
}
for (const stage of ["state", "published", "cleaned"] as const) {
  Deno.test("render recovery finish at " + stage, async () => {
    const f = await fixture(stage);
    try {
      const result = await recoverProject(f.source, "finish");
      assert(result.status === "finished");
      assert(await Deno.readTextFile(f.output) === f.next);
      assert((await f.store.load())?.revision === 2);
      assert(await Deno.readTextFile(f.backup) === f.original);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  });
}
Deno.test("uncommitted state cannot be guessed from merged staged HTML", async () => {
  const f = await fixture("backup");
  try {
    await rejects(
      () => recoverProject(f.source, "finish"),
      "RECOVERY_STATE_NOT_COMMITTED",
    );
    assert((await f.store.load())?.revision === 1);
    assert((await recoverProject(f.source)).files.journal.exists);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("initial render rollback archives new state and output without inventing old state", async () => {
  const f = await fixture("published", true);
  try {
    const result = await recoverProject(f.source, "rollback");
    assert(!await f.store.load());
    assert(result.preserved.some((p) => p.includes("state-next-")));
    assert(!await Deno.stat(f.output).then(() => true, () => false));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("concurrent output and later state edits block recovery without changing bytes", async () => {
  const f = await fixture("state");
  try {
    await Deno.writeTextFile(f.output, "native concurrent edit");
    const before = await Deno.readTextFile(f.journalPath);
    await rejects(() => recoverProject(f.source, "finish"), "RECOVERY_BLOCKED");
    await rejects(
      () => recoverProject(f.source, "rollback"),
      "RECOVERY_BLOCKED",
    );
    assert(await Deno.readTextFile(f.output) === "native concurrent edit");
    assert(await Deno.readTextFile(f.journalPath) === before);
    await f.store.save(f.state);
    await rejects(() => recoverProject(f.source), "RECOVERY_STATE_CHANGED");
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("inspect does not release locks; deliberate recovery releases only confirmed dead owners", async () => {
  const f = await fixture("state");
  try {
    const lock = join(f.stateDir, "operation.lock");
    await Deno.mkdir(lock);
    await Deno.writeTextFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: 2147483647, started: new Date().toISOString() }),
    );
    assert((await recoverProject(f.source)).locks[0].status === "dead");
    assert((await Deno.stat(lock)).isDirectory);
    const result = await recoverProject(f.source, "finish");
    assert(result.preserved.some((p) => p.includes("operation.lock-")));
    assert(!await Deno.stat(lock).then(() => true, () => false));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("alive and ambiguous locks are never stolen", async () => {
  for (
    const owner of [{ pid: Deno.pid, started: new Date().toISOString() }, {
      pid: "unknown",
    }]
  ) {
    const f = await fixture("state");
    try {
      const lock = join(f.stateDir, "operation.lock");
      await Deno.mkdir(lock);
      await Deno.writeTextFile(join(lock, "owner.json"), JSON.stringify(owner));
      await rejects(
        () => recoverProject(f.source, "finish"),
        "RECOVERY_BLOCKED",
      );
      assert((await Deno.stat(lock)).isDirectory);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
Deno.test("journal traversal, corrupt staging and symlink parents are refused", async () => {
  for (const mode of ["path", "staging", "symlink"]) {
    const f = await fixture("state");
    try {
      if (mode === "path") {
        f.journal.backup = join(f.dir, "foreign.html");
        await Deno.writeTextFile(f.journalPath, JSON.stringify(f.journal));
        await rejects(() => recoverProject(f.source), "INVALID_RECOVERY_PATH");
      } else if (mode === "staging") {
        await Deno.writeTextFile(f.staging, "tampered");
        await rejects(
          () => recoverProject(f.source),
          "RECOVERY_STAGING_CHANGED",
        );
      } else {
        await Deno.rename(
          join(f.stateDir, "history"),
          join(f.dir, "elsewhere"),
        );
        await Deno.symlink(
          join(f.dir, "elsewhere"),
          join(f.stateDir, "history"),
        );
        await rejects(() => recoverProject(f.source), "UNSAFE_RECOVERY_PATH");
      }
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
Deno.test("concurrent native edit already preserved in backup is restored and remains guarded", async () => {
  const f = await fixture("backup");
  try {
    await Deno.writeTextFile(f.backup, "native edit");
    const result = await recoverProject(f.source, "rollback");
    assert(await Deno.readTextFile(f.output) === "native edit");
    assert(result.diagnostics.length === 1);
    assert((await f.store.load())?.output?.sha256 === await sha256(f.original));
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
async function syncFixture(
  stage: "journal" | "backup" | "source" | "state" | "receipt" | "cleaned",
) {
  const f = await fixture("journal");
  await Deno.remove(f.journalPath);
  await Deno.remove(f.staging);
  const transactionId = crypto.randomUUID(),
    original = await Deno.readTextFile(f.source),
    result = "## Updated {#a}\n";
  const journal = {
    version: 1,
    transactionId,
    source: f.source,
    sourceBackup: join(
      f.stateDir,
      "history",
      "source-" + transactionId + ".qmd",
    ),
    stateBackup: join(
      f.stateDir,
      "history",
      "state-" + transactionId + ".json",
    ),
    staging: join(f.dir, ".deck.qmd.sync-" + transactionId),
    receiptPath: join(f.stateDir, "history", "sync-" + transactionId + ".json"),
    sourceHash: await sha256(original),
    resultHash: await sha256(result),
    stateRevision: f.state.revision,
    planHash: await sha256("reviewed plan"),
    selectedChangeIds: ["pending-edit-1"],
  };
  await Deno.copyFile(join(f.stateDir, "state.json"), journal.stateBackup);
  await Deno.writeTextFile(journal.staging, result);
  const journalPath = join(f.stateDir, "sync-transaction.json");
  await Deno.writeTextFile(journalPath, JSON.stringify(journal));
  if (stage !== "journal") await Deno.rename(f.source, journal.sourceBackup);
  if (["source", "state", "receipt", "cleaned"].includes(stage)) {
    await Deno.link(journal.staging, f.source);
  }
  if (["state", "receipt", "cleaned"].includes(stage)) {
    await f.store.save(f.state);
  }
  const receipt = {
    version: 1,
    transactionId,
    source: f.source,
    planHash: journal.planHash,
    previousSourceHash: journal.sourceHash,
    sourceHash: journal.resultHash,
    previousRevision: journal.stateRevision,
    revision: journal.stateRevision + 1,
    appliedChangeIds: journal.selectedChangeIds,
    sourceBackup: journal.sourceBackup,
    stateBackup: journal.stateBackup,
    receiptPath: journal.receiptPath,
    renderNeeded: true,
    pendingRetained: true,
  };
  if (["receipt", "cleaned"].includes(stage)) {
    await Deno.writeTextFile(journal.receiptPath, JSON.stringify(receipt));
  }
  if (stage === "cleaned") await Deno.remove(journal.staging);
  return { ...f, journal, journalPath, original, result, receipt };
}
for (
  const stage of [
    "journal",
    "backup",
    "source",
    "state",
    "receipt",
    "cleaned",
  ] as const
) {
  Deno.test("sync recovery finish at " + stage, async () => {
    const f = await syncFixture(stage);
    try {
      const inspection = await recoverProject(f.source);
      assert(inspection.kind === "sync");
      assert(inspection.available.includes("finish"));
      const result = await recoverProject(f.source, "finish");
      assert(result.status === "finished");
      assert(await Deno.readTextFile(f.source) === f.result);
      assert((await f.store.load())?.revision === 2);
      assert(
        JSON.stringify(
          JSON.parse(await Deno.readTextFile(f.journal.receiptPath)),
        ) === JSON.stringify(f.receipt),
      );
      assert(await Deno.readTextFile(f.journal.sourceBackup) === f.original);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  });
}
for (
  const stage of [
    "journal",
    "backup",
    "source",
    "state",
    "receipt",
    "cleaned",
  ] as const
) {
  Deno.test("sync recovery rollback at " + stage, async () => {
    const f = await syncFixture(stage);
    try {
      const result = await recoverProject(f.source, "rollback");
      assert(result.status === "rolled-back");
      assert(await Deno.readTextFile(f.source) === f.original);
      assert((await f.store.load())?.revision === 1);
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  });
}
Deno.test("sync recovery refuses newer semantic state and unmanaged source edits", async () => {
  for (const changed of ["state", "source"]) {
    const f = await syncFixture("state");
    try {
      if (changed === "source") {
        await Deno.writeTextFile(
          f.source + ".external",
          "Unmanaged new source",
        );
        await Deno.rename(f.source + ".external", f.source);
        await rejects(
          () => recoverProject(f.source, "rollback"),
          "RECOVERY_BLOCKED",
        );
        assert(await Deno.readTextFile(f.source) === "Unmanaged new source");
      } else {
        const state = await f.store.load();
        state!.emitted.title = "later user edit";
        await f.store.save(state!);
        await rejects(() => recoverProject(f.source), "RECOVERY_STATE_CHANGED");
      }
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
Deno.test("sync recovery validates receipt, backup checksum and exact journal scope", async () => {
  for (const changed of ["receipt", "backup", "path"]) {
    const f = await syncFixture("receipt");
    try {
      if (changed === "receipt") {
        await Deno.writeTextFile(f.journal.receiptPath, "{}");
        await rejects(
          () => recoverProject(f.source),
          "RECOVERY_RECEIPT_MISMATCH",
        );
      } else if (changed === "backup") {
        const obj = JSON.parse(await Deno.readTextFile(f.journal.stateBackup));
        obj.state.emitted.title = "tamper";
        await Deno.writeTextFile(f.journal.stateBackup, JSON.stringify(obj));
        await rejects(() => recoverProject(f.source), "CORRUPT_RECOVERY_STATE");
      } else {
        f.journal.sourceBackup = join(f.dir, "outside.qmd");
        await Deno.writeTextFile(f.journalPath, JSON.stringify(f.journal));
        await rejects(() => recoverProject(f.source), "INVALID_RECOVERY_PATH");
      }
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
async function approvalFixture(
  stage: "journal" | "backup" | "source" | "state" | "receipt" | "cleaned",
  published = false,
) {
  const f = await syncFixture(stage);
  const pending = {
    id: "pending-edit-1",
    target: { slideId: "new" },
    path: [],
    kind: "create-slide",
    origin: "authored",
    status: "bento-ahead",
    before: { present: false },
    after: {
      present: true,
      value: {
        id: "new",
        elements: [{ id: "new-title", type: "text", html: "New" }],
      },
    },
  };
  for (const path of [f.journal.stateBackup, join(f.stateDir, "state.json")]) {
    const env = JSON.parse(await Deno.readTextFile(path));
    env.state.pending = [pending];
    env.sha256 = await sha256(canonical(env.state));
    await Deno.writeTextFile(path, JSON.stringify(env));
  }
  const approvalStaging = join(
      f.stateDir,
      "history",
      "sync-approval-" + f.journal.transactionId + ".json",
    ),
    approvalPath = join(f.stateDir, "sync-approved.json");
  const approval = {
    version: 1,
    docId: f.state.docId,
    sourceHash: f.journal.resultHash,
    stateRevision: f.journal.stateRevision + 1,
    planHash: f.journal.planHash,
    expectedPending: [pending],
    creationChangeIds: [pending.id],
    normalizations: [],
  };
  const envelope = {
    format: "qbento-sync-approval/1",
    sha256: await sha256(canonical(approval)),
    approval,
  };
  await Deno.writeTextFile(approvalStaging, JSON.stringify(envelope));
  await Deno.writeTextFile(
    f.journalPath,
    JSON.stringify({ ...f.journal, approvalStaging, approvalPath }),
  );
  if (published) await Deno.link(approvalStaging, approvalPath);
  return { ...f, approvalStaging, approvalPath, envelope };
}
for (
  const stage of [
    "journal",
    "backup",
    "source",
    "state",
    "receipt",
    "cleaned",
  ] as const
) {
  Deno.test(
    "sync finish retains explicit creation approval at " + stage,
    async () => {
      const f = await approvalFixture(
        stage,
        ["receipt", "cleaned"].includes(stage),
      );
      try {
        await recoverProject(f.source, "finish");
        assert(
          await Deno.readTextFile(f.approvalPath) ===
            await Deno.readTextFile(f.approvalStaging),
        );
        assert((await f.store.load())!.pending.length === 1);
      } finally {
        await Deno.remove(f.dir, { recursive: true });
      }
    },
  );
}
for (const published of [false, true]) {
  Deno.test(
    "sync rollback archives only its exact active approval, published=" +
      published,
    async () => {
      const f = await approvalFixture("state", published);
      try {
        const report = await recoverProject(f.source, "rollback");
        assert(!await Deno.stat(f.approvalPath).then(() => true, () => false));
        assert(await Deno.stat(f.approvalStaging));
        assert(report.preserved.includes(f.approvalStaging));
        assert((await f.store.load())!.pending.length === 1);
      } finally {
        await Deno.remove(f.dir, { recursive: true });
      }
    },
  );
}
Deno.test("sync recovery refuses unrelated active approval and journal-binding changes", async () => {
  for (const mode of ["active", "sourceHash", "pending", "path"]) {
    const f = await approvalFixture("state");
    try {
      if (mode === "active") {
        await Deno.writeTextFile(f.approvalPath, "another approval");
        await rejects(
          () => recoverProject(f.source, "rollback"),
          "RECOVERY_APPROVAL_MISMATCH",
        );
        assert(await Deno.readTextFile(f.approvalPath) === "another approval");
      } else if (mode === "path") {
        const j = JSON.parse(await Deno.readTextFile(f.journalPath));
        j.approvalPath = join(f.dir, "outside.json");
        await Deno.writeTextFile(f.journalPath, JSON.stringify(j));
        await rejects(() => recoverProject(f.source), "INVALID_RECOVERY_PATH");
      } else {
        const env = structuredClone(f.envelope);
        if (mode === "sourceHash") env.approval.sourceHash = "0".repeat(64);
        else {env.approval.expectedPending[0].after.value.elements[0].html =
            "Unexpected";}
        env.sha256 = await sha256(canonical(env.approval));
        await Deno.writeTextFile(f.approvalStaging, JSON.stringify(env));
        await rejects(
          () => recoverProject(f.source),
          "RECOVERY_APPROVAL_MISMATCH",
        );
      }
    } finally {
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
async function renderApprovalFixture(archived: boolean) {
  const f = await fixture("published");
  const approval = {
    path: join(f.stateDir, "sync-approved.json"),
    sha256: await sha256("exact promotion approval"),
    archive: join(
      f.stateDir,
      "history",
      "consumed-sync-" + crypto.randomUUID() + ".json",
    ),
  };
  await Deno.writeTextFile(
    archived ? approval.archive : approval.path,
    "exact promotion approval",
  );
  await Deno.writeTextFile(
    f.journalPath,
    JSON.stringify({ ...f.journal, approval }),
  );
  return { ...f, approval };
}
for (const archived of [false, true]) {
  for (const action of ["finish", "rollback"] as const) {
    Deno.test(
      "render recovery " + action +
        " retains promotion authorization, archived=" + archived,
      async () => {
        const f = await renderApprovalFixture(archived);
        try {
          await recoverProject(f.source, action);
          if (action === "finish") {
            assert(
              await Deno.readTextFile(f.approval.archive) ===
                "exact promotion approval",
            );
            assert(
              !await Deno.stat(f.approval.path).then(() => true, () => false),
            );
            assert((await f.store.load())!.revision === 2);
          } else {
            assert(
              await Deno.readTextFile(f.approval.path) ===
                "exact promotion approval",
            );
            assert((await f.store.load())!.revision === 1);
          }
        } finally {
          await Deno.remove(f.dir, { recursive: true });
        }
      },
    );
  }
}
Deno.test("render recovery refuses conflicting active promotion authorization without deleting it", async () => {
  const f = await renderApprovalFixture(true);
  try {
    await Deno.writeTextFile(f.approval.path, "new unrelated authorization");
    await rejects(
      () => recoverProject(f.source, "rollback"),
      "RECOVERY_APPROVAL_MISMATCH",
    );
    assert(
      await Deno.readTextFile(f.approval.path) ===
        "new unrelated authorization",
    );
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
