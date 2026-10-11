import {
  attachProducerCapture,
  type ProducerManifest,
} from "../src/render/producer-capture.ts";
import {
  projectAst,
  validateProjectionOrigins,
} from "../src/render/project.ts";
import { scanSource } from "../src/source/mod.ts";
import type { Ast, Node } from "../src/render/types.ts";
function assert(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
const source = scanSource(
  "## One {#one}\n\n```{r}\n#| label: first\nprint(1)\n```\n",
);
const manifest: ProducerManifest = {
  version: 1,
  nonce: "invocation",
  sourceHash: source.hash,
  input: "/tmp/deck.rmarkdown",
  chunks: [{
    index: 0,
    id: "first",
    slideId: "one",
    label: "first",
    code: "print(1)",
  }],
};
const boundary = (token = "invocation:0"): Node => ({
  t: "Div",
  c: [["", ["qbento-execution"], [["qbento-producer-proof", token]]], [{
    t: "Div",
    c: [["forged-inner", ["cell"], []], [{
      t: "CodeBlock",
      c: [["", [], []], "[1] 1"],
    }]],
  }]],
});
const ast = (nodes: Node[]): Ast => ({
  meta: {},
  blocks: [
    { t: "Header", c: [2, ["one", [], []], [{ t: "Str", c: "One" }]] },
    ...nodes,
  ],
});
Deno.test("fresh attached execution receipt owns output even when a hook renames the inner cell", async () => {
  const attached = attachProducerCapture(ast([boundary()]), manifest);
  const result = await projectAst(attached, "doc", [], source);
  validateProjectionOrigins(source, result);
  assert(result.origins.one["first/code:1"].producer === "first");
});
Deno.test("receipt attributes and serialized manifest cannot self-declare original execution trust", async () => {
  const raw = ast([boundary()]);
  Object.assign(raw, { producerManifest: manifest });
  try {
    await projectAst(raw, "doc", [], source);
  } catch (e) {
    assert(String(e).includes("INVALID_PRODUCER_RECEIPT"));
    return;
  }
  throw new Error("Self-declared receipt accepted");
});
Deno.test("receipt validation rejects foreign tokens, replay, malformed boundary and stale source", async () => {
  for (
    const nodes of [[boundary("other:0")], [boundary("invocation:9")], [
      boundary(),
      boundary(),
    ], [{
      t: "Div",
      c: [["borrowed", ["qbento-execution"], [[
        "qbento-producer-proof",
        "invocation:0",
      ]]], []],
    }]] as Node[][]
  ) {
    try {
      attachProducerCapture(ast(nodes), manifest);
    } catch (e) {
      assert(String(e).includes("INVALID_PRODUCER_RECEIPT"));
      continue;
    }
    throw new Error("Invalid receipt accepted");
  }
  const stale = scanSource(source.text.replace("print(1)", "print(2)"));
  try {
    await projectAst(
      attachProducerCapture(ast([boundary()]), manifest),
      "doc",
      [],
      stale,
    );
  } catch (e) {
    assert(String(e).includes("INVALID_PRODUCER_RECEIPT"));
    return;
  }
  throw new Error("Stale receipt accepted");
});

Deno.test("output ledger detects a filter removing all receipt and cell attributes", () => {
  try {
    attachProducerCapture(ast([]), manifest, ["invocation:0"]);
  } catch (e) {
    assert(String(e).includes("MISSING_PRODUCER_RECEIPT"));
    return;
  }
  throw new Error("Missing executed output accepted");
});
