import { readProject, renderProject, saveProject } from "../core/project.ts";
import { spliceDocument } from "../render/html.ts";
import { ISOLATION_BOOTSTRAP, OFFLINE_CSP } from "../bridge/isolation.ts";
import type { BentoDoc } from "../state/mod.ts";
import type { BentoDoc as RenderDoc } from "../render/types.ts";

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
          const page =
            `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quarto-Bento Studio</title><style>body{margin:0;font:15px system-ui;color:#e8efed;background:#152c32}header{display:flex;align-items:center;gap:12px;padding:12px 18px}h1{font-size:17px;margin:0 16px 0 0}button{font:inherit;padding:8px 12px;border:0;border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:default}#status{margin-left:auto}iframe{display:block;width:100%;height:calc(100vh - 66px);border:0;background:white}dialog{width:min(800px,90vw);max-height:75vh;overflow:auto}pre{white-space:pre-wrap;word-break:break-word}</style><header><h1>Quarto-Bento</h1><button id="save" disabled>Guardar proyecto</button><button id="review" disabled>Revisar cambios</button><button id="render" disabled>Recalcular</button><span id="status" role="status">Abriendo…</span></header><iframe id="editor" src="/deck" title="Editor Bento"></iframe><dialog id="review-dialog"><h2>Cambios pendientes</h2><p>Guardar conserva tus cambios. La sincronización con QMD es una operación separada.</p><pre id="changes"></pre><button id="close">Cerrar</button></dialog><script>window.qbentoToken=${
              JSON.stringify(token)
            }</script><script type="module" src="/client.js"></script></html>`;
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
              ISOLATION_BOOTSTRAP,
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
          const text = await req.text();
          if (text.length > 25_000_000) {
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
        if (req.method === "POST" && url.pathname === "/api/render") {
          const r = await renderProject(source);
          return respond(
            JSON.stringify({
              revision: r.state.revision,
              pending: r.state.pending.length,
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
