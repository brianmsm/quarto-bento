import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashSource, scanSource } from "../source/mod.ts";
import type { Ast, Node } from "./types.ts";
export interface ProducerManifest {
  version: 1;
  nonce: string;
  sourceHash: string;
  input: string;
  outputReceiptPath?: string;
  chunks: {
    index: number;
    id: string;
    slideId?: string;
    label: string;
    code: string;
  }[];
}
function assertProducerStartup() {
  const args = (Deno.env.get("QUARTO_KNITR_RSCRIPT_ARGS") ?? "").split(",").map(
    (arg) => arg.trim(),
  );
  if (args.includes("--vanilla") || args.includes("--no-init-file")) {
    throw new Error(
      "UNSUPPORTED_PRODUCER_STARTUP: QUARTO_KNITR_RSCRIPT_ARGS disables the original-producer adapter with --vanilla/--no-init-file; use an R startup that loads the adapter or a separately verified execution transport (flags remain unchanged)",
    );
  }
}
export async function prepareProducerCapture(source: string) {
  const text = await Deno.readTextFile(source), document = scanSource(text);
  if (document.blocks.some((block) => block.kind === "chunk")) {
    assertProducerStartup();
  }
  if (
    /(?:\bqbento-producer-proof\s*[=:]|\.qbento-execution\b)/m.test(text)
  ) {
    throw new Error(
      "RESERVED_PRODUCER_MARKER: source cannot declare internal execution receipts",
    );
  }
  let unnamed = 0;
  const manifest: ProducerManifest = {
    version: 1,
    nonce: crypto.randomUUID(),
    sourceHash: document.hash,
    input: resolve(
      dirname(source),
      basename(source).replace(/\.[^.]*$/, ".rmarkdown"),
    ),
    chunks: document.blocks.filter((b) => b.kind === "chunk").map(
      (block, index) => {
        const label = block.content.match(
          /^\s*#\|\s*label:\s*["']?([A-Za-z][\w:.-]*)["']?\s*$/m,
        )?.[1] ??
          block.raw.split(/\r?\n/)[0].match(
            /\{\w+[ ,]+([A-Za-z][\w:.-]*)(?:[, }]|$)/,
          )?.[1] ?? `unnamed-chunk-${++unnamed}`;
        const indent = block.raw.match(/^( {0,3})(?:`{3,}|~{3,})/)?.[1] ?? "";
        const code = block.content.replace(/\r\n|\r/g, "\n").split("\n").map(
          (line) =>
            indent && line.startsWith(indent)
              ? line.slice(indent.length)
              : line,
        ).filter((line) => !/^\s*#\|/.test(line)).join("\n").replace(/\n$/, "");
        return {
          index,
          id: block.id,
          ...(block.slideId ? { slideId: block.slideId } : {}),
          label,
          code,
        };
      },
    ),
  };
  const receiptDir = await Deno.makeTempDir({ prefix: "qbento-producer-" });
  const path = resolve(receiptDir, "manifest.json");
  manifest.outputReceiptPath = resolve(receiptDir, "emitted.jsonl");
  await Deno.writeTextFile(manifest.outputReceiptPath, "");
  await Deno.writeTextFile(path, JSON.stringify(manifest));
  const original = Deno.env.get("R_PROFILE_USER");
  return {
    manifest,
    emitted: async () =>
      (await Deno.readTextFile(manifest.outputReceiptPath!)).split("\n").filter(
        Boolean,
      ).map((line) => JSON.parse(line) as string),
    cleanup: () => Deno.remove(receiptDir, { recursive: true }),
    env: {
      R_PROFILE_USER: fileURLToPath(
        new URL("./producer-profile.R", import.meta.url),
      ),
      QBENTO_ORIGINAL_R_PROFILE_SET: original === undefined ? "0" : "1",
      QBENTO_ORIGINAL_R_PROFILE_USER: original ?? "",
      QBENTO_PRODUCER_MANIFEST: path,
    },
  };
}
// Receipts are trusted only after the execution boundary attaches a manifest.
// A serialized AST or a filter-authored attribute cannot self-declare that trust.
const captures = new WeakMap<Ast, ProducerManifest>();
export function producerReceipt(ast: Ast, sourceHash: string, token: string) {
  const manifest = captures.get(ast);
  if (
    !manifest || manifest.version !== 1 || manifest.sourceHash !== sourceHash ||
    !token.startsWith(manifest.nonce + ":")
  ) {
    throw new Error(
      "INVALID_PRODUCER_RECEIPT: execution receipt does not match the original source and invocation",
    );
  }
  const chunk = manifest.chunks.find((c) =>
    token === `${manifest.nonce}:${c.index}`
  );
  if (!chunk) {
    throw new Error(
      "INVALID_PRODUCER_RECEIPT: execution receipt has no original chunk",
    );
  }
  return chunk;
}
export function attachProducerCapture(
  ast: Ast,
  manifest: ProducerManifest,
  expectedTokens?: string[],
): Ast {
  const seen = new Set<string>();
  const sequence: string[] = [];
  const attached = { ...ast };
  captures.set(attached, structuredClone(manifest));
  function visit(value: unknown, scoped = false) {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, scoped));
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    if (node.t === "Div") {
      const [attr, children] = node.c as [
        [string, string[], [string, string][]],
        Node[],
      ];
      if (
        !scoped &&
        attr[1].some((cls) => cls === "cell" || cls.startsWith("cell-output"))
      ) {
        throw new Error(
          "MISSING_PRODUCER_RECEIPT: executed cell lost its verified original boundary",
        );
      }
      const tokens = attr[2].filter(([key]) => key === "qbento-producer-proof");
      if (attr[1].includes("qbento-execution") || tokens.length) {
        if (
          attr[0] || attr[1].length !== 1 ||
          attr[1][0] !== "qbento-execution" || tokens.length !== 1 ||
          attr[2].length !== 1 || seen.has(tokens[0][1])
        ) {
          throw new Error(
            "INVALID_PRODUCER_RECEIPT: malformed or repeated original execution boundary",
          );
        }
        producerReceipt(
          attached,
          manifest.sourceHash,
          tokens[0][1],
        );
        seen.add(tokens[0][1]);
        sequence.push(tokens[0][1]);
        scoped = true;
      }
      children.forEach((child) => visit(child, scoped));
    } else if ("c" in node) visit(node.c, scoped);
  }
  ast.blocks.forEach((node) => visit(node));
  if (
    expectedTokens &&
    (new Set(expectedTokens).size !== expectedTokens.length ||
      expectedTokens.length !== seen.size ||
      expectedTokens.some((token, index) => token !== sequence[index]))
  ) {
    throw new Error(
      "MISSING_PRODUCER_RECEIPT: executed output receipts were removed, repeated or replaced before capture",
    );
  }
  return attached;
}

/** User transformations can detach or swap producer boundaries. Refuse them
 * before execution until a transform-specific original-boundary proof exists.
 * Inspect resolves QMD/project/profile/metadata inheritance; source-only YAML
 * searches cannot establish this gate.
 */
export async function assertCompatibleProducerFilters(
  source: string,
  targetFormat = "html",
) {
  if (
    !scanSource(await Deno.readTextFile(source)).blocks.some((b) =>
      b.kind === "chunk"
    )
  ) return;
  assertProducerStartup();
  const inspected = await new Deno.Command("quarto", {
    cwd: dirname(source),
    args: ["inspect", source],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!inspected.success) {
    throw new Error(
      `QUARTO_INSPECT_FAILED: ${new TextDecoder().decode(inspected.stderr)}`,
    );
  }
  const inspection = JSON.parse(new TextDecoder().decode(inspected.stdout));
  const filters: unknown[] = [];
  const append = (value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) filters.push(...value);
    else filters.push(value);
  };
  const selected = inspection.formats?.[targetFormat];
  // Quarto inspect has no --to override. If it omits the forced format, use
  // the inspected configurations conservatively rather than assume an absent filter.
  const effective = selected
    ? [selected]
    : Object.values(inspection.formats ?? {});
  for (
    const format of effective as Record<
      string,
      Record<string, unknown>
    >[]
  ) {
    append(format.pandoc?.filters);
    append(format.metadata?.filters);
    append(format.metadata?.["lua-filter"]);
    append(format.metadata?.["lua-filters"]);
  }
  // Bind the reviewed internal filter bytes, including in installed runtimes
  // where project filters must not become their own trust authority.
  const canonical = new Set([
    "484dc9143665b4b61fab5e1ce24241f8133d1c5e2c59bfbb4576606e036f7f2f",
    "bf2ef385783f7b750d7dc97e1f158d30d4fcd4556a44bf5f82486749d25bed97",
  ]);
  for (const filter of filters) {
    const path = typeof filter === "string"
      ? filter
      : filter && typeof filter === "object"
      ? (filter as { path?: unknown }).path
      : undefined;
    let internal = false;
    if (
      typeof path === "string" &&
      /(?:^|[/\\])_extensions[/\\]qbento[/\\](?:guard|capture)\.lua$/.test(path)
    ) {
      try {
        internal = canonical.has(hashSource(
          await Deno.readTextFile(resolve(dirname(source), path)),
        ));
      } catch { /* Missing or changed filters are never trusted. */ }
    }
    if (!internal) {
      throw new Error(
        "UNSUPPORTED_COMPUTED_FILTER: effective user filters can change execution producer boundaries; remove them from computed QMD/project/profile/metadata configuration or use a separately verified transformation adapter",
      );
    }
  }
}

/** Existing bounded rich/widget adapters may look through exactly one verified
 * execution boundary, while retaining their original source producer proof.
 */
export function producerOutputChildren(
  ast: Ast,
  nodes: Node[],
  sourceHash: string,
  expectedProducer: string,
): Node[] {
  if (nodes.length !== 1 || nodes[0].t !== "Div") return nodes;
  const [attr, children] = nodes[0].c as [
    [string, string[], [string, string][]],
    Node[],
  ];
  if (!attr[1].includes("qbento-execution")) return nodes;
  const token = attr[2].find(([key]) => key === "qbento-producer-proof")?.[1];
  if (
    !token || producerReceipt(ast, sourceHash, token).id !== expectedProducer
  ) {
    throw new Error(
      "INVALID_PRODUCER_RECEIPT: output boundary disagrees with the original adapter producer",
    );
  }
  return children;
}
