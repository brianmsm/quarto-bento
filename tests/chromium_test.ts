import {
  chromiumEndpoint,
  withHeadlessChromium,
} from "../src/browser/chromium.ts";

const path = "/devtools/browser/01234567-89ab-cdef-0123-456789abcdef";
function eq(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`${actual} != ${expected}`);
}
async function refuses(action: () => unknown, code: string) {
  try {
    await action();
  } catch (error) {
    if (String(error).includes(code)) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
}
Deno.test("Chromium endpoint waits for valid prefixes and accepts canonical loopback endpoints", () => {
  for (const separator of ["\n", "\r\n"]) {
    const contents = `45678${separator}${path}`;
    for (let i = 0; i < contents.length; i++) {
      eq(chromiumEndpoint(contents.slice(0, i)), undefined);
    }
    const endpoint = `ws://127.0.0.1:45678${path}`;
    eq(chromiumEndpoint(contents), endpoint);
    eq(chromiumEndpoint(`${contents}\r`), undefined);
    eq(chromiumEndpoint(`${contents}${separator}`), endpoint);
  }
  for (const port of ["1", "65535", "00001"]) {
    eq(chromiumEndpoint(`${port}\n${path}\n`), `ws://127.0.0.1:${port}${path}`);
  }
});
Deno.test("Chromium endpoint refuses complete malformed payloads without broad retry", async () => {
  for (
    const contents of [
      "65536",
      "999999",
      "00000",
      "0\n",
      "\n",
      " \n",
      "1x",
      "1\rX",
      `65536\n${path}\n`,
      `1\n${path}\n\n`,
      `1\n${path}\nextra`,
      "1\nhttps://example.org",
      "1\n/devtools/page/",
      "1\n/devtools/\r",
      "1\n/devtools/browser/0123\n",
      `1\n${path}a`,
      `1\n${path.replace("89ab", "89AB")}`,
      `1\n${path.replace("89ab", "89ag")}`,
      `1\n${path.replace("01234567-", "0123456-7")}`,
      `1\n${path.replace("cdef-", "cdef0")}`,
      `1\n${path} \n`,
    ]
  ) {
    await refuses(
      () => chromiumEndpoint(contents),
      "INVALID_CHROMIUM_ENDPOINT",
    );
  }
});

// The controlled process executes this installed Deno, owns the same profile
// lifetime as Chromium, and writes the endpoint in separately observable stages.
async function controlledProcess(
  stages: { text: string; delay?: number }[],
  action: (program: string, receipt: string) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "qb-chromium-test-" });
  try {
    const receipt = `${dir}/receipt.json`, script = `${dir}/writer.ts`;
    await Deno.writeTextFile(
      script,
      `const profile = Deno.args.find(a => a.startsWith("--user-data-dir="))!.split("=")[1];
await Deno.writeTextFile(${
        JSON.stringify(receipt)
      }, JSON.stringify({profile, pid:Deno.pid}));
for (const stage of ${JSON.stringify(stages)}) {
  await Deno.writeTextFile(profile + "/DevToolsActivePort", stage.text);
  if (stage.delay) await new Promise(resolve => setTimeout(resolve, stage.delay));
}
await new Promise(resolve => setTimeout(resolve, 10000));\n`,
    );
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const program = `${dir}/chromium`;
    await Deno.writeTextFile(
      program,
      `#!/bin/sh\nexec ${
        quote(Deno.execPath())
      } run --no-config --allow-read --allow-write ${quote(script)} "$@"\n`,
    );
    await Deno.chmod(program, 0o700);
    await action(program, receipt);
    const { profile, pid } = JSON.parse(await Deno.readTextFile(receipt));
    await refuses(() => Deno.stat(profile), "NotFound");
    await refuses(() => Deno.kill(pid, "SIGCONT"), "NotFound");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}
Deno.test({
  name:
    "Chromium partial file reaches a complete endpoint before connecting and cleans its process/profile",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    let connected = 0;
    const sockets: WebSocket[] = [];
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      (request) => {
        eq(new URL(request.url).pathname, path);
        connected++;
        const { socket, response } = Deno.upgradeWebSocket(request);
        sockets.push(socket);
        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data));
          if (message.method === "Browser.close") {
            socket.close();
            return;
          }
          const result = message.method === "Browser.getVersion"
            ? { product: "controlled" }
            : message.method === "Target.createTarget"
            ? { targetId: "target" }
            : message.method === "Target.attachToTarget"
            ? { sessionId: "session" }
            : { answer: 42 };
          socket.send(JSON.stringify({ id: message.id, result }));
        };
        return response;
      },
    );
    try {
      const prefix = `${server.addr.port}\n`;
      await controlledProcess([
        { text: "", delay: 100 },
        { text: prefix, delay: 100 },
        { text: `${prefix}/devtools/browser/01234567-89ab`, delay: 100 },
        { text: `${prefix}${path}\n` },
      ], async (program) => {
        const result = await withHeadlessChromium({
          chromium: program,
          timeoutMs: 3000,
        }, async (client) => {
          eq(client.version, "controlled");
          return await client.send<{ answer: number }>("Test.answer");
        });
        eq(result.answer, 42);
        eq(connected, 1);
      });
    } finally {
      for (const socket of sockets) socket.close();
      await server.shutdown();
    }
  },
});
Deno.test({
  name:
    "Chromium permanent incomplete endpoints expire at the existing deadline and clean up",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    for (
      const text of ["", "45678\n", "45678\n/devtools/browser/01234567-89ab"]
    ) {
      await controlledProcess([{ text }], async (program) => {
        const start = performance.now();
        await refuses(
          () =>
            withHeadlessChromium({ chromium: program, timeoutMs: 1000 }, () => {
              throw new Error("action must not run");
            }),
          "CHROMIUM_TIMEOUT",
        );
        if (performance.now() - start > 2250) {
          throw new Error("deadline extended");
        }
      });
    }
  },
});
Deno.test({
  name:
    "Chromium malformed complete endpoint fails immediately instead of waiting for later repair",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await controlledProcess([
      { text: `65536\n${path}\n`, delay: 2000 },
      { text: `45678\n${path}\n` },
    ], async (program) => {
      const start = performance.now();
      await refuses(
        () =>
          withHeadlessChromium({ chromium: program, timeoutMs: 3000 }, () => {
            throw new Error("action must not run");
          }),
        "INVALID_CHROMIUM_ENDPOINT",
      );
      // Cleanup retains its existing one-second graceful process window.
      if (performance.now() - start > 2250) {
        throw new Error("invalid endpoint retried");
      }
    });
  },
});
Deno.test("installed Chromium connects with canonical endpoint and evaluates an actual page", async () => {
  const result = await withHeadlessChromium({}, async (client) => {
    if (!/^Chrome\//.test(client.version)) {
      throw new Error("not installed Chromium");
    }
    return await client.send<{ result: { value: number } }>(
      "Runtime.evaluate",
      { expression: "6 * 7", returnByValue: true },
    );
  });
  eq(result.result.value, 42);
});
