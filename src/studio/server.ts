import { readProject, renderProject, saveProject } from "../core/project.ts";
import { applySync, previewSync } from "../core/sync.ts";
import { applyReconcile, previewReconcile } from "../core/reconcile.ts";
import {
  applySlideAction,
  type SlideActionRequest,
} from "../core/slide-actions.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP, OFFLINE_CSP } from "../bridge/isolation.ts";
import type { BentoDoc } from "../state/mod.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";

export const MAX_STUDIO_BODY_BYTES = 25_000_000;

// A missing or understated Content-Length must not bypass the byte limit.
// Return null before retaining an excess chunk, and stop reading its stream.
export async function readStudioBody(req: Request): Promise<string | null> {
  const declaredLength = req.headers.get("content-length");
  if (
    declaredLength !== null && /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_STUDIO_BODY_BYTES
  ) {
    await req.body?.cancel().catch(() => {});
    return null;
  }
  if (!req.body) return "";
  const reader = req.body.getReader();
  let body = new Uint8Array(0);
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const nextBytes = bytes + value.byteLength;
      if (nextBytes > MAX_STUDIO_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      if (nextBytes > body.byteLength) {
        const expanded = new Uint8Array(
          Math.min(
            MAX_STUDIO_BODY_BYTES,
            Math.max(nextBytes, body.byteLength * 2, 65_536),
          ),
        );
        expanded.set(body.subarray(0, bytes));
        body = expanded;
      }
      body.set(value, bytes);
      bytes = nextBytes;
    }
    return new TextDecoder().decode(body.subarray(0, bytes));
  } finally {
    reader.releaseLock();
  }
}

export async function startStudio(source: string, port = 0) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const shell = await Deno.readTextFile(
    new URL("../../vendor/bento/shell.html", import.meta.url),
  );
  const bridge = await Deno.readTextFile(
    new URL("../bridge/browser.js", import.meta.url),
  );
  const client = await Deno.readTextFile(
    new URL("./client.js", import.meta.url),
  );
  const template = await Deno.readTextFile(
    new URL("./index.html", import.meta.url),
  );
  const managedBoot = ISOLATION_BOOTSTRAP +
    "\naddEventListener('beforeunload', e => { if (globalThis.__qbentoManagedReload === true) e.stopImmediatePropagation(); }, true);";
  let origin = "";
  const respond = (
    body: string,
    status = 200,
    type = "application/json",
    csp?: string,
  ) =>
    new Response(body, {
      status,
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        ...(csp ? { "Content-Security-Policy": csp } : {}),
      },
    });
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      if (
        url.origin !== origin ||
        req.headers.get("host") !== new URL(origin).host
      ) return respond('{"error":"Invalid host"}', 403);
      if (
        req.headers.get("origin") && req.headers.get("origin") !== origin
      ) return respond('{"error":"Cross-origin request refused"}', 403);
      try {
        if (req.method === "GET" && url.pathname === "/") {
          const page = template.replace(
            "__QBENTO_TOKEN__",
            JSON.stringify(token),
          );
          return respond(
            page,
            200,
            "text/html; charset=utf-8",
            OFFLINE_CSP.replace("frame-src 'none'", "frame-src 'self'"),
          );
        }
        if (req.method === "GET" && url.pathname === "/deck") {
          const state = await readProject(source);
          return respond(
            spliceDocument(
              shell,
              state.emitted as unknown as RenderDoc,
              managedBoot +
                "\nObject.defineProperty(globalThis, '__qbentoSnapshot', { value: Object.freeze(" +
                JSON.stringify({
                  docId: state.docId,
                  revision: state.revision,
                  pending: state.pending.length,
                }).replaceAll("<", "\\u003c") +
                ") });",
              OFFLINE_CSP,
            ),
            200,
            "text/html; charset=utf-8",
            OFFLINE_CSP,
          );
        }
        if (
          req.method === "GET" && url.pathname === "/bridge.js"
        ) return respond(bridge, 200, "text/javascript");
        if (
          req.method === "GET" && url.pathname === "/client.js"
        ) return respond(client, 200, "text/javascript");
        if (req.headers.get("x-qbento-token") !== token) {
          return respond(
            '{"error":"Invalid session token"}',
            403,
          );
        }
        if (
          req.method === "GET" && url.pathname === "/api/state"
        ) return respond(JSON.stringify(await readProject(source)));
        if (req.method === "POST" && url.pathname === "/api/save") {
          if (
            req.headers.get("content-type") !== "application/json"
          ) return respond('{"error":"JSON required"}', 415);
          const text = await readStudioBody(req);
          if (text === null) {
            return respond(
              '{"error":"Document too large"}',
              413,
            );
          }
          const payload = JSON.parse(text) as {
            doc: BentoDoc;
            revision: number;
          };
          const state = await saveProject(
            source,
            payload.doc,
            payload.revision,
          );
          return respond(
            JSON.stringify({
              revision: state.revision,
              pending: state.pending.length,
            }),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/sync/preview") {
          if (req.headers.get("content-type") !== "application/json") {
            return respond('{"error":"JSON required"}', 415);
          }
          const text = await readStudioBody(req);
          if (text === null) return respond('{"error":"Plan too large"}', 413);
          const { confirmedDeleteIds } = JSON.parse(text);
          return respond(JSON.stringify(
            await previewSync(source, undefined, {
              confirmedDeleteIds,
            }),
          ));
        }
        if (req.method === "POST" && url.pathname === "/api/slides/action") {
          if (req.headers.get("content-type") !== "application/json") {
            return respond('{"error":"JSON required"}', 415);
          }
          const text = await readStudioBody(req);
          if (text === null) return respond('{"error":"Plan too large"}', 413);
          const state = await applySlideAction(
            source,
            JSON.parse(text) as SlideActionRequest,
          );
          return respond(JSON.stringify({
            revision: state.revision,
            pending: state.pending.length,
          }));
        }
        if (req.method === "POST" && url.pathname === "/api/sync/apply") {
          if (req.headers.get("content-type") !== "application/json") {
            return respond('{"error":"JSON required"}', 415);
          }
          const text = await readStudioBody(req);
          if (text === null) {
            return respond('{"error":"Plan too large"}', 413);
          }
          return respond(
            JSON.stringify(await applySync(source, JSON.parse(text))),
          );
        }
        if (req.method === "POST" && url.pathname === "/api/render") {
          const r = await renderProject(source);
          return respond(
            JSON.stringify({
              revision: r.state.revision,
              pending: r.state.pending.length,
            }),
          );
        }
        if (
          req.method === "POST" && url.pathname === "/api/reconcile/preview"
        ) {
          return respond(JSON.stringify(await previewReconcile(source)));
        }
        if (req.method === "POST" && url.pathname === "/api/reconcile/apply") {
          if (req.headers.get("content-type") !== "application/json") {
            return respond('{"error":"JSON required"}', 415);
          }
          const text = await readStudioBody(req);
          if (text === null) {
            return respond('{"error":"Plan too large"}', 413);
          }
          const { plan, choices } = JSON.parse(text);
          const result = await applyReconcile(source, plan, choices);
          return respond(
            JSON.stringify({
              revision: result.state.revision,
              remaining: result.remaining,
              sourceUnchanged: true,
            }),
          );
        }
        return respond('{"error":"Not found"}', 404);
      } catch (error) {
        const e = error as Error & { code?: string; details?: unknown };
        return respond(
          JSON.stringify({
            error: e.code || "QBENTO_ERROR",
            message: e.message,
            details: e.details,
          }),
          409,
        );
      }
    },
  );
  origin = `http://127.0.0.1:${server.addr.port}`;
  return {
    url: origin,
    finished: server.finished,
    shutdown: () => server.shutdown(),
  };
}
