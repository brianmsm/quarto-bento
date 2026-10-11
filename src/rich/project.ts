/** Fresh executed tables only: no persisted bundle or self-authenticated asset loading. */
import { hashSource, type SourceDocument } from "../source/mod.ts";
import { canonical, sha256 } from "../state/mod.ts";
import type { Ast, Element, Json, Origin } from "../render/types.ts";
import {
  collectRichTableCandidates,
  type RichTableCandidate,
  richTableHtml,
  type RichTableSnapshot,
  snapshotRichTable,
} from "./table.ts";
function fail(message: string): never {
  throw new Error(`RICH_TABLE_PROJECTION_MISMATCH: ${message}`);
}
export async function prepareRichTables(ast: Ast, source: SourceDocument) {
  const candidates = collectRichTableCandidates(ast, source);
  if (candidates.length > 8) {
    throw new Error(
      "UNSUPPORTED_RICH_TABLE: this bounded capture supports up to eight rich tables per deck",
    );
  }
  const snapshots = new Map<string, RichTableSnapshot>();
  for (const candidate of candidates) {
    snapshots.set(
      candidate.source.sourceId,
      await snapshotRichTable(candidate),
    );
  }
  return snapshots;
}
/** Rebind in-memory capture to the same original source and current executed AST. */
export async function verifyRichTableSnapshot(
  expected: RichTableCandidate,
  snapshot: RichTableSnapshot,
) {
  const receipt = snapshot.receipt;
  if (
    canonical(snapshot.candidate) !== canonical(expected) ||
    receipt.version !== 1 || receipt.kind !== "gt-static-png" ||
    canonical(receipt.source) !== canonical(expected.source) ||
    receipt.htmlHash !== hashSource(await richTableHtml(expected)) ||
    receipt.pngHash !== await sha256(snapshot.png) ||
    receipt.width !== 1120 || !Number.isSafeInteger(receipt.height) ||
    receipt.height < 1 || receipt.height > 534 || receipt.pixelRatio !== 2 ||
    receipt.minFontSize < 8 || receipt.minBodyFontSize < 10
  ) {
    fail(
      "capture does not match its checked executed fragment and PNG receipt",
    );
  }
  const png = snapshot.png;
  if (
    png.length < 24 ||
    canonical(Array.from(png.slice(0, 8))) !==
      canonical([137, 80, 78, 71, 13, 10, 26, 10])
  ) {
    fail("capture is not a PNG");
  }
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    header.getUint32(16) !== receipt.width * 2 ||
    header.getUint32(20) !== receipt.height * 2
  ) {
    fail("PNG dimensions differ from the measured complete table");
  }
}
export function richTableElement(
  snapshot: RichTableSnapshot,
): { element: Element; origin: Origin } {
  let binary = "";
  for (let i = 0; i < snapshot.png.length; i += 8192) {
    binary += String.fromCharCode(...snapshot.png.subarray(i, i + 8192));
  }
  const source = snapshot.candidate.source;
  return {
    element: {
      id: `${source.sourceId}/table-fallback`,
      type: "image",
      x: 80,
      y: 166,
      w: snapshot.receipt.width,
      h: snapshot.receipt.height,
      rotation: 0,
      opacity: 1,
      src: `data:image/png;base64,${btoa(binary)}`,
      fit: "contain",
    },
    origin: {
      origin: "computed",
      sourceId: source.producerId,
      producer: source.producerId,
      // The raw HTML/AST hashes include random gt CSS IDs. Verify them freshly,
      // but publish only stable content evidence so reconcile can re-execute.
      richTable: {
        version: snapshot.receipt.version,
        kind: snapshot.receipt.kind,
        source: {
          sourceHash: source.sourceHash,
          sourceId: source.sourceId,
          producerId: source.producerId,
          slideId: source.slideId,
          chunkHash: source.chunkHash,
        },
        pngHash: snapshot.receipt.pngHash,
        textHash: snapshot.receipt.textHash,
        browser: snapshot.receipt.browser,
        width: snapshot.receipt.width,
        height: snapshot.receipt.height,
        pixelRatio: snapshot.receipt.pixelRatio,
        rows: snapshot.receipt.rows,
        cells: snapshot.receipt.cells,
        minFontSize: snapshot.receipt.minFontSize,
        minBodyFontSize: snapshot.receipt.minBodyFontSize,
      } as Json,
    },
  };
}
