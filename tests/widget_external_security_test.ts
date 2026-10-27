import { constants } from "node:fs";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { hashSource, scanSource } from "../src/source/mod.ts";
import {
  collectExternalPlotlyCandidates,
  readExternalWidget,
} from "../src/widgets/plotly.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => Promise<unknown>, expected: RegExp) {
  try {
    await action();
  } catch (error) {
    assert(expected.test(String(error)), String(error));
    return;
  }
  throw new Error("Expected refusal");
}

function privilegedTest(name: string, run: () => Promise<void>) {
  Deno.test(name, async () => {
    if (Deno.env.get("QBENTO_SECURITY_CHILD") === "1") return await run();
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-config",
        "--no-remote",
        "--no-npm",
        "--allow-all",
        "--filter",
        name,
        import.meta.filename!,
      ],
      env: { QBENTO_SECURITY_CHILD: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    assert(
      result.success,
      decoder.decode(result.stdout) + decoder.decode(result.stderr),
    );
  });
}
const payload = JSON.stringify({
  x: {
    data: [{ type: "scatter3d", x: [1, 2], y: [3, 4], z: [5, 6] }],
    layout: { width: 700, height: 450 },
    config: { showSendToCloud: false },
  },
  evals: [],
  jsHooks: [],
});
const container = '<div class="plotly html-widget" id="htmlwidget-safe"></div>';
const html =
  `${container}<script type="application/json" data-for="htmlwidget-safe">${payload}</script>`;
const source = scanSource(
  '## Imported {#imported}\n\n::: {#cloud widget-src="cloud.html"}\n:::\n',
);
const regular =
  /regular local HTML file without linked paths and at most 16 MB/;

Deno.test("external widget import keeps checked data and rejects malformed envelopes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-external-envelope-" });
  try {
    const artifact = join(dir, "cloud.html");
    await Deno.writeTextFile(artifact, html);
    const [candidate] = await collectExternalPlotlyCandidates(source, dir);
    assert(candidate.spec.data[0].z instanceof Array);
    assert(candidate.spec.data[0].z[1] === 6);
    assert(candidate.width === 700 && candidate.height === 450);
    assert(candidate.source.producerId === "");
    assert(candidate.source.external?.sha256 === hashSource(html));
    for (
      const attributes of [
        'data-for="(a+)+" data-for="htmlwidget-safe"',
        'data-for="htmlwidget-safe" DATA-FOR="htmlwidget-safe"',
        'data-for data-for="htmlwidget-safe"',
        'data-for="htmlwidget-safe" data-for=htmlwidget-other',
        'data-for="(a+)+"',
      ]
    ) {
      await Deno.writeTextFile(
        artifact,
        `${container}<script type="application/json" ${attributes}>${payload}</script>`,
      );
      await rejects(
        () => collectExternalPlotlyCandidates(source, dir),
        /data-for identifier/,
      );
    }
    for (
      const [envelope, message] of [
        [container, /exactly one identified/],
        [html + html, /exactly one identified/],
        [html.replace(container, ""), /matching Plotly widget container/],
        [html.replace(payload, "{broken"), /malformed widget JSON/],
      ] as const
    ) {
      await Deno.writeTextFile(artifact, envelope);
      await rejects(
        () => collectExternalPlotlyCandidates(source, dir),
        message,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("external widget paths reject links, nonfiles, oversize and escapes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-external-paths-" });
  try {
    const root = join(dir, "project"), outside = join(dir, "outside");
    await Deno.mkdir(root);
    await Deno.mkdir(outside);
    await Deno.writeTextFile(join(outside, "cloud.html"), html);
    await Deno.symlink(join(outside, "cloud.html"), join(root, "linked.html"));
    await Deno.symlink(outside, join(root, "linked-dir"));
    await Deno.link(join(outside, "cloud.html"), join(root, "hard.html"));
    await Deno.mkdir(join(root, "directory.html"));
    await Deno.writeTextFile(join(root, "not-directory"), "file");
    const large = await Deno.open(join(root, "large.html"), {
      create: true,
      write: true,
    });
    try {
      await large.truncate(16_000_001);
    } finally {
      large.close();
    }
    for (
      const path of [
        "linked.html",
        "linked-dir/cloud.html",
        "hard.html",
        "directory.html",
        "not-directory/cloud.html",
        "large.html",
      ]
    ) {
      await rejects(() => readExternalWidget(root, path), regular);
    }
    for (
      const path of ["../outside/cloud.html", "nested/../../outside/cloud.html"]
    ) {
      await rejects(
        () => readExternalWidget(root, path),
        /outside its source project/,
      );
    }
    for (
      const path of [
        join(outside, "cloud.html"),
        "https://host/cloud.html",
        "..\\outside\\cloud.html",
        "cloud.html\0",
        "cloud.json",
      ]
    ) {
      await rejects(
        () => readExternalWidget(root, path),
        /local relative HTML file/,
      );
    }
    await rejects(
      () => readExternalWidget(root, "missing.html"),
      /missing\.html/,
    );
    await Deno.mkdir(join(root, "nested"));
    await Deno.writeTextFile(join(root, "nested", "cloud.html"), html);
    assert(await readExternalWidget(root, "nested/./cloud.html") === html);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

privilegedTest(
  "external widget descriptor walk survives deterministic leaf and ancestor swaps",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-external-race-" });
    const open = fs.open;
    try {
      const root = join(dir, "project"), outside = join(dir, "outside");
      await Deno.mkdir(root);
      await Deno.mkdir(outside);
      await Deno.writeTextFile(join(outside, "cloud.html"), "outside data");
      for (
        const boundary of [
          "leaf-before",
          "leaf-after",
          "ancestor-before",
          "ancestor-after",
          "root-after",
        ]
      ) {
        await Deno.mkdir(join(root, "assets"));
        await Deno.writeTextFile(join(root, "assets", "cloud.html"), html);
        let swapped = false;
        fs.open = async (path, flags, mode) => {
          const name = String(path);
          const target = boundary === "root-after"
            ? name.startsWith("/proc/self/fd/") && name.endsWith("/project")
            : name.startsWith("/proc/self/fd/") && name.endsWith(
              boundary.startsWith("leaf") ? "/cloud.html" : "/assets",
            );
          const swap = async () => {
            swapped = true;
            const original = boundary === "root-after" ? root : join(
              root,
              boundary.startsWith("leaf") ? "assets/cloud.html" : "assets",
            );
            await Deno.rename(original, `${original}-pinned`);
            await Deno.symlink(
              boundary.startsWith("leaf")
                ? join(outside, "cloud.html")
                : outside,
              original,
            );
          };
          if (target && !swapped && boundary.endsWith("before")) await swap();
          const handle = await open(path, flags, mode);
          if (target && !swapped) {
            try {
              await swap();
            } catch (error) {
              await handle.close();
              throw error;
            }
          }
          return handle;
        };
        if (boundary.endsWith("before")) {
          await rejects(
            () => readExternalWidget(root, "assets/cloud.html"),
            regular,
          );
        } else {
          assert(
            await readExternalWidget(root, "assets/cloud.html") === html,
            boundary,
          );
        }
        assert(swapped, `missed ${boundary} boundary`);
        fs.open = open;
        if (boundary === "root-after") {
          await Deno.remove(root);
          await Deno.rename(`${root}-pinned`, root);
        }
        await Deno.remove(join(root, "assets"), { recursive: true });
        if (boundary.startsWith("ancestor")) {
          await Deno.remove(join(root, "assets-pinned"), { recursive: true });
        }
      }
    } finally {
      fs.open = open;
      await Deno.remove(dir, { recursive: true });
    }
  },
);

privilegedTest(
  "external widget bounds actual bytes when an opened file grows after stat",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-external-growth-" });
    const open = fs.open;
    try {
      await Deno.writeTextFile(join(dir, "cloud.html"), html);
      let grew = false;
      fs.open = async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        if (!(Number(flags) & constants.O_DIRECTORY)) {
          const stat = handle.stat.bind(handle);
          handle.stat = (async () => {
            const checked = await stat();
            const writer = await Deno.open(join(dir, "cloud.html"), {
              write: true,
            });
            try {
              await writer.truncate(16_000_001);
              grew = true;
            } finally {
              writer.close();
            }
            return checked;
          }) as typeof handle.stat;
        }
        return handle;
      };
      await rejects(() => readExternalWidget(dir, "cloud.html"), regular);
      assert(grew);
    } finally {
      fs.open = open;
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test("external widget fallback respects explicit artifact read denial", async () => {
  const denied = Deno.env.get("QBENTO_DENIED_ARTIFACT");
  if (denied) {
    await rejects(
      () => readExternalWidget(dirname(denied), basename(denied)),
      /read permission is not granted|read access/i,
    );
    return;
  }
  const dir = await Deno.makeTempDir({ prefix: "qbento-external-denied-" });
  try {
    const artifact = join(dir, "cloud.html");
    const marker = "qbento-denied-artifact-bytes";
    await Deno.writeTextFile(artifact, html + marker);
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "test",
        "--no-config",
        "--no-remote",
        "--no-npm",
        "--allow-read",
        `--deny-read=${artifact}`,
        "--allow-env=QBENTO_DENIED_ARTIFACT",
        "--allow-run",
        "--filter",
        "external widget fallback respects explicit artifact read denial",
        import.meta.filename!,
      ],
      env: { QBENTO_DENIED_ARTIFACT: artifact },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const output = decoder.decode(result.stdout) +
      decoder.decode(result.stderr);
    assert(result.success, output);
    assert(!output.includes(marker), "denied artifact contents escaped");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("external widget fingerprints preserve raw UTF-8 BOM bytes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-external-bom-" });
  try {
    const text = "\ufeff" + html;
    const bytes = new TextEncoder().encode(text);
    await Deno.writeFile(join(dir, "cloud.html"), bytes);
    assert(await readExternalWidget(dir, "cloud.html") === text);
    const [candidate] = await collectExternalPlotlyCandidates(source, dir);
    const rawHash = createHash("sha256").update(bytes).digest("hex");
    assert(candidate.source.outputHash === rawHash);
    assert(candidate.source.external?.sha256 === rawHash);
    assert(rawHash !== hashSource(html));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("external widget rejects malformed and truncated UTF-8 instead of aliasing bytes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-external-utf8-" });
  try {
    const encoder = new TextEncoder();
    const prefix = encoder.encode(html + "<!--");
    const suffix = encoder.encode("-->");
    for (
      const bytes of [
        new Uint8Array([...prefix, 0xff, ...suffix]),
        new Uint8Array([...prefix, 0xfe, ...suffix]),
        new Uint8Array([...encoder.encode(html), 0xe2, 0x82]),
      ]
    ) {
      await Deno.writeFile(join(dir, "cloud.html"), bytes);
      await rejects(
        () => collectExternalPlotlyCandidates(source, dir),
        /encoded data|encoding|UTF-8|decode/i,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
