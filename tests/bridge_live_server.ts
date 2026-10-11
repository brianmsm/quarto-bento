import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
// Manual live-browser probe; no runtime dependency beyond Deno and a built pinned shell.
const [shellPath, statePath] = Deno.args;
if (!shellPath || !statePath) {
  throw new Error(
    "Usage: deno run -A tests/bridge_live_server.ts SHELL.html /tmp/bridge-state.json",
  );
}
const shell = await Deno.readTextFile(shellPath);
const doc = {
  format: "bento/slides",
  version: 1,
  docId: "bridge-live-proof",
  title: "Bridge live proof",
  size: { width: 1600, height: 900 },
  theme: {
    background: "#ffffff",
    color: "#172a42",
    accent: "#fe947b",
    fontFamily: "Arial",
  },
  slides: [{
    id: "s1",
    background: "#ffffff",
    transition: "fade",
    notes: "",
    elements: [{
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      w: 650,
      h: 100,
      html: "Bridge native text",
      fontSize: 42,
      fontFamily: "Arial",
      color: "#172a42",
      align: "left",
      opacity: 1,
      rotation: 0,
    }],
  }, {
    id: "s2",
    background: "#ffffff",
    transition: "fade",
    notes: "",
    elements: [],
  }],
};
Deno.serve({ hostname: "127.0.0.1", port: 8765 }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path === "/bridge.js") {
    return new Response(
      await Deno.readTextFile(
        new URL("../src/bridge/browser.js", import.meta.url),
      ),
      { headers: { "content-type": "text/javascript" } },
    );
  }
  if (path === "/save" && req.method === "POST") {
    await Deno.writeTextFile(statePath, await req.text());
    return Response.json({ saved: true });
  }
  let current = doc;
  try {
    current = JSON.parse(await Deno.readTextFile(statePath)).doc;
  } catch { /* First open has no saved snapshot. */ }
  let html = shell.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}"><script>${ISOLATION_BOOTSTRAP}</script>`,
  ).replace(
    '<script type="application/bento+json" id="bento-doc"></script>',
    `<script type="application/bento+json" id="bento-doc">${
      JSON.stringify(prepareIsolatedDocument(current)).replaceAll(
        "<",
        "\\u003c",
      )
    }</script>`,
  );
  html = html.replace(
    "</body>",
    `<script type="module">import {createBentoBridge} from '/bridge.js'; const boot=setInterval(()=>{if(!window.bento?.loadDoc)return;clearInterval(boot); window.events=[];window.bridge=createBentoBridge(window.bento,{docId:'bridge-live-proof',onEvent:e=>events.push(e),persist:async snapshot=>{const r=await fetch('/save',{method:'POST',body:JSON.stringify(snapshot)});if(!r.ok)throw new Error('Save failed');return r.json();}});},50);</script></body>`,
  );
  return new Response(html, { headers: { "content-type": "text/html" } });
});
