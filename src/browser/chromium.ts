/** Optional installed Chromium, private headless profile, bounded local CDP lifetime. */
export interface ChromiumClient {
  send<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T>;
  events: {
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
  }[];
  version: string;
}
/** A missing result means a valid prefix of Chromium's two-line endpoint file. */
export function chromiumEndpoint(contents: string): string | undefined {
  const invalid = () => {
    throw new Error("INVALID_CHROMIUM_ENDPOINT");
  };
  const newline = contents.indexOf("\n");
  if (newline < 0) {
    const port = contents.endsWith("\r") ? contents.slice(0, -1) : contents;
    if (!/^\d{0,5}$/.test(port) || Number(port) > 65535) invalid();
    // A zero-only five-digit port cannot become a valid port by appending.
    if (port.length === 5 && Number(port) === 0) invalid();
    if (contents.endsWith("\r") && (!port || Number(port) === 0)) invalid();
    return undefined;
  }
  const port = contents.slice(0, newline).replace(/\r$/, "");
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    invalid();
  }
  const rawPath = contents.slice(newline + 1);
  const path = rawPath.replace(/(?:\r?\n|\r)$/, "");
  const shape = "/devtools/browser/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  if (path.length > shape.length) invalid();
  for (let i = 0; i < path.length; i++) {
    if (shape[i] === "x" ? !/[a-f0-9]/.test(path[i]) : path[i] !== shape[i]) {
      invalid();
    }
  }
  if (path.length < shape.length) {
    // A newline commits the path; a short committed path is malformed.
    if (rawPath.endsWith("\n") || rawPath.endsWith("\r")) invalid();
    return undefined;
  }
  if (rawPath.endsWith("\r")) return undefined;
  return `ws://127.0.0.1:${port}${path}`;
}
export async function withHeadlessChromium<T>(
  options: { chromium?: string; timeoutMs?: number },
  action: (client: ChromiumClient) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "qbento-chromium-" });
  let child: Deno.ChildProcess | undefined, socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const stop = () => {
    stopped = true;
    socket?.close();
    try {
      child?.kill("SIGKILL");
    } catch { /* already exited */ }
    for (const call of pending.values()) {
      call.reject(new Error("CHROMIUM_CLOSED: capture ended"));
    }
    pending.clear();
  };
  const removeProfile = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await Deno.remove(dir, { recursive: true });
        break;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) break;
        if (attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  };
  try {
    try {
      child = new Deno.Command(options.chromium ?? "chromium", {
        args: [
          "--headless",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--disable-sync",
          "--no-pings",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${dir}`,
          "about:blank",
        ],
        stdout: "null",
        stderr: "null",
      }).spawn();
    } catch (error) {
      throw new Error(
        `CHROMIUM_REQUIRED: install/configure a compatible local Chromium for this optional static fallback; ${
          String(error)
        }`,
      );
    }
    const run = async () => {
      let endpoint = "";
      for (let i = 0; i < 100 && !stopped; i++) {
        try {
          const ready = chromiumEndpoint(
            await Deno.readTextFile(`${dir}/DevToolsActivePort`),
          );
          if (ready) {
            endpoint = ready;
            break;
          }
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!endpoint || stopped) {
        throw new Error(
          "CHROMIUM_START_FAILED: local debugging endpoint unavailable",
        );
      }
      socket = new WebSocket(endpoint);
      await new Promise<void>((resolve, reject) => {
        socket!.onopen = () => resolve();
        socket!.onerror = () => reject(new Error("CHROMIUM_CONNECTION_FAILED"));
      });
      let id = 0;
      const events: ChromiumClient["events"] = [];
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id) {
          const call = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) {
            call?.reject(
              new Error(`CHROMIUM_PROTOCOL: ${message.error.message}`),
            );
          } else call?.resolve(message.result);
        } else if (events.length < 10_000) {
          events.push({
            method: message.method,
            params: message.params ?? {},
            ...(message.sessionId ? { sessionId: message.sessionId } : {}),
          });
        }
      };
      const send = <R>(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
      ): Promise<R> =>
        new Promise((resolve, reject) => {
          if (stopped) {
            reject(new Error("CHROMIUM_CLOSED"));
            return;
          }
          const callId = ++id;
          pending.set(callId, {
            resolve: resolve as (v: unknown) => void,
            reject,
          });
          socket!.send(
            JSON.stringify({
              id: callId,
              method,
              params,
              ...(sessionId ? { sessionId } : {}),
            }),
          );
        });
      const version = await send<{ product: string }>("Browser.getVersion");
      const target = await send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      });
      const session = await send<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId: target.targetId, flatten: true },
      );
      return await action({
        send: <R>(
          method: string,
          params?: Record<string, unknown>,
          sessionId?: string,
        ) => send<R>(method, params, sessionId ?? session.sessionId),
        events,
        version: version.product,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        stop();
        reject(
          new Error(
            "CHROMIUM_TIMEOUT: headless capture exceeded its bounded deadline",
          ),
        );
      }, options.timeoutMs ?? 30_000);
    });
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (socket?.readyState === WebSocket.OPEN) {
      // Graceful Browser.close lets renderer/utility children finish profile IO.
      socket.send(JSON.stringify({ id: 2147483647, method: "Browser.close" }));
    }
    if (child) {
      let grace: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        child.status,
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, 1000);
        }),
      ]);
      if (grace !== undefined) clearTimeout(grace);
    }
    stop();
    if (child) await child.status;
    await removeProfile();
  }
}
