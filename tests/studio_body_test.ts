import {
  MAX_STUDIO_BODY_BYTES,
  readStudioBody,
  startStudio,
} from "../src/studio/server.ts";

function assert(ok: unknown, message = "assertion failed"): asserts ok {
  if (!ok) throw new Error(message);
}

function streamedRequest(chunks: Uint8Array[], contentLength?: string) {
  let delivered = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered === chunks.length) controller.close();
      else controller.enqueue(chunks[delivered++]);
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const request = new Request("http://127.0.0.1/api/save", {
    method: "POST",
    body: stream,
    ...(contentLength === undefined
      ? {}
      : { headers: { "Content-Length": contentLength } }),
  });
  return { request, progress: () => ({ delivered, cancelled }) };
}

Deno.test("Studio accepts the exact byte limit and decodes split UTF-8", async () => {
  const boundary = streamedRequest([
    new Uint8Array(MAX_STUDIO_BODY_BYTES - 1).fill(32),
    new Uint8Array([65]),
  ]);
  const text = await readStudioBody(boundary.request);
  assert(text?.length === MAX_STUDIO_BODY_BYTES);
  assert(text.endsWith("A"));
  assert(!boundary.progress().cancelled);

  const encoded = new TextEncoder().encode('{"text":"Español 😀"}');
  const utf8 = streamedRequest(
    Array.from(encoded, (byte) => new Uint8Array([byte])),
  );
  assert(await readStudioBody(utf8.request) === '{"text":"Español 😀"}');
  assert(await readStudioBody(new Request("http://127.0.0.1")) === "");
});

Deno.test("Studio cancels excess chunks regardless of Content-Length", async () => {
  for (const declaredLength of [undefined, "1", "invalid"]) {
    const streamed = streamedRequest([
      new Uint8Array(MAX_STUDIO_BODY_BYTES - 1),
      new Uint8Array(2),
      new Uint8Array(1024),
    ], declaredLength);
    assert(await readStudioBody(streamed.request) === null);
    const { delivered, cancelled } = streamed.progress();
    assert(cancelled, "excess request stream was not cancelled");
    assert(delivered === 2, "reader continued after the excess chunk");
  }
});

Deno.test("Studio refuses declared excess before reading and counts UTF-8 bytes", async () => {
  const declared = streamedRequest(
    [new Uint8Array([65])],
    String(MAX_STUDIO_BODY_BYTES + 1),
  );
  assert(await readStudioBody(declared.request) === null);
  assert(declared.progress().cancelled);
  assert(declared.progress().delivered === 0);

  const multiByte = new TextEncoder().encode(
    "ñ".repeat(MAX_STUDIO_BODY_BYTES / 2),
  );
  const bytes = streamedRequest([multiByte, new Uint8Array([65])]);
  assert(await readStudioBody(bytes.request) === null);
  assert(bytes.progress().cancelled);
});

const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
Deno.test({
  name:
    "Studio returns existing 413 JSON for streamed excess on all body routes",
  ignore: !canServe,
  fn: async () => {
    const studio = await startStudio("/nonexistent-qbento-body-test.qmd");
    try {
      const page = await (await fetch(studio.url)).text();
      const token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      for (
        const [path, error] of [
          ["/api/save", "Document too large"],
          ["/api/sync/apply", "Plan too large"],
          ["/api/reconcile/apply", "Plan too large"],
        ]
      ) {
        const { request } = streamedRequest([
          new Uint8Array(MAX_STUDIO_BODY_BYTES - 1).fill(32),
          new Uint8Array(2).fill(32),
        ]);
        const response = await fetch(studio.url + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": token,
          },
          body: request.body,
        });
        assert(response.status === 413, `${path}: ${response.status}`);
        assert((await response.json()).error === error);
        assert(response.headers.get("Content-Type") === "application/json");
        assert(response.headers.get("Cache-Control") === "no-store");
      }
    } finally {
      await studio.shutdown();
    }
  },
});
