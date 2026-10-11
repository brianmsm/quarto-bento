/**
 * Version-bound public-API bridge for Bento 3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b.
 * No Store hooks exist on window.bento. Polling observes snapshots, NOT every
 * intermediate operation. Save always reads the live document synchronously.
 */
export function isDisabledCollaboration(value) {
  return !!value && Object.keys(value).sort().join(",") === "key,on,room" &&
    value.room === "" && value.key === "" && value.on === false;
}

export const BENTO_REVISION = "3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b";

/**
 * @template {{docId:string, format:string, version:number, slides:Array<{id:string}>}} D
 * @param {{doc:D, selection:string[], loadDoc:(json:string)=>any, undo:()=>void, redo:()=>void}} api
 * @param {{docId:string,persist:(snapshot:{doc:D,docId:string,revision:number})=>Promise<unknown>,onEvent?:(event:any)=>void,pollMs?:number}} options
 */
export function createBentoBridge(api, options) {
  if (
    !api ||
    !["loadDoc", "undo", "redo"].every((k) => typeof api[k] === "function") ||
    !Array.isArray(api.selection)
  ) {
    throw new Error(
      "BENTO_BRIDGE_INCOMPATIBLE: full editor public API required",
    );
  }
  const emit = options.onEvent ?? (() => {});
  let disposed = false;
  let revision = 0;
  let savedRevision = 0;
  let queue = Promise.resolve();
  const read = () => {
    const doc = JSON.parse(JSON.stringify(api.doc));
    if (doc.docId !== options.docId) {
      throw new Error("BENTO_IDENTITY_CHANGED: open deck differs from project");
    }
    if (
      doc.format !== "bento/slides" || doc.version !== 1 ||
      !Array.isArray(doc.slides)
    ) throw new Error("BENTO_BRIDGE_INCOMPATIBLE: document format");
    if (doc.collab && !isDisabledCollaboration(doc.collab)) {
      throw new Error(
        "BENTO_COLLAB_DISABLED: collaborative documents cannot enter Studio",
      );
    }
    return doc;
  };
  let current = read();
  let fingerprint = JSON.stringify(current);
  let selection = JSON.stringify(api.selection);
  const active = () => {
    if (disposed) throw new Error("BENTO_BRIDGE_DISPOSED");
  };
  const poll = (reason = "poll") => {
    active();
    const doc = read();
    const next = JSON.stringify(doc);
    if (next !== fingerprint) {
      const previousOrder = current.slides.map((s) => s.id);
      current = doc;
      fingerprint = next;
      revision++;
      emit({
        type: "document",
        reason,
        revision,
        doc: structuredClone(doc),
        dirty: true,
      });
      const order = doc.slides.map((s) => s.id);
      if (JSON.stringify(order) !== JSON.stringify(previousOrder)) {
        emit({ type: "slides", reason, revision, order, previousOrder });
      }
    }
    const selected = JSON.stringify(api.selection);
    if (selected !== selection) {
      selection = selected;
      emit({ type: "selection", selection: JSON.parse(selected) });
    }
    return { doc: structuredClone(current), docId: options.docId, revision };
  };
  const timer = options.pollMs === 0 ? undefined : setInterval(() => {
    try {
      poll();
    } catch (error) {
      emit({ type: "error", error });
    }
  }, Math.max(options.pollMs ?? 200, 50));
  return {
    poll,
    snapshot: () => poll("snapshot"),
    get dirty() {
      poll();
      return revision !== savedRevision;
    },
    get revision() {
      return revision;
    },
    save() {
      const snapshot = poll("save");
      // Sequential persistence prevents a slower earlier request overwriting a
      // later save. A failed write does not poison the next retry or clear dirty.
      const task = queue.then(async () => {
        emit({ type: "saving", revision: snapshot.revision });
        try {
          const receipt = await options.persist(snapshot);
          savedRevision = snapshot.revision;
          if (!disposed) poll("save-complete");
          emit({
            type: "saved",
            revision: snapshot.revision,
            dirty: revision !== savedRevision,
            receipt,
          });
          return receipt;
        } catch (error) {
          emit({ type: "save-error", revision: snapshot.revision, error });
          throw error;
        }
      });
      queue = task.then(() => {}, () => {});
      return task;
    },
    /** Project restoration, not importing a different document. Undoable. */
    load(doc) {
      active();
      if (doc.docId !== options.docId) {
        throw new Error("BENTO_IDENTITY_CHANGED: refusing foreign document");
      }
      if (doc.collab && !isDisabledCollaboration(doc.collab)) {
        throw new Error("BENTO_COLLAB_DISABLED");
      }
      const before = JSON.stringify(api.doc);
      const report = api.loadDoc(JSON.stringify(doc));
      if (!report) {
        throw new Error("BENTO_LOAD_REJECTED: document remains unchanged");
      }
      if (Array.isArray(report.dropped) && report.dropped.length) {
        api.undo();
        if (JSON.stringify(api.doc) !== before) {
          throw new Error("BENTO_LOAD_ROLLBACK_FAILED");
        }
        emit({ type: "load-rejected", report });
        throw new Error(
          "BENTO_LOAD_LOSSY: unsupported fields; original document restored",
        );
      }
      poll("load");
      emit({ type: "loaded", report });
      return report;
    },
    undo() {
      active();
      api.undo();
      return poll("undo");
    },
    redo() {
      active();
      api.redo();
      return poll("redo");
    },
    dispose() {
      if (timer !== undefined) clearInterval(timer);
      disposed = true;
    },
  };
}
