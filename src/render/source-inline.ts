/** Read authored fragments with Pandoc only; never execute Quarto or infer output. */
import type { SourceDocument } from "../source/mod.ts";
import { renderInline } from "./inline.ts";
import type { Node } from "./types.ts";
export interface SourceInlineProof {
  sourceHash: string;
  blockId: string;
  kind: "heading" | "paragraph";
  html: string;
  readerId?: string;
}
export async function readSourceInline(
  source: SourceDocument,
): Promise<ReadonlyMap<string, SourceInlineProof>> {
  const fragments = source.blocks.filter((block) =>
    block.origin === "authored" && block.editable &&
    ["heading", "paragraph"].includes(block.kind)
  );
  const proofs = new Map<string, SourceInlineProof>();
  if (!fragments.length) return proofs;
  // Every fragment has an independent boundary. Heading order is retained so
  // Pandoc's duplicate automatic identifiers match the original document.
  const input = fragments.map((block, index) =>
    `::: {#qbento-inline-proof-${index}}\n\n${block.raw}\n\n:::\n`
  ).join("\n");
  const process = new Deno.Command("quarto", {
    args: ["pandoc", "--from", "markdown", "--to", "json"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = process.output(), writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  const result = await output;
  if (!result.success) {
    throw new Error(
      "UNMAPPED_PROVENANCE: Pandoc could not read original authored fragments",
    );
  }
  const parsed = JSON.parse(new TextDecoder().decode(result.stdout));
  if (
    !Array.isArray(parsed.blocks) || parsed.blocks.length !== fragments.length
  ) {
    throw new Error(
      "UNMAPPED_PROVENANCE: original fragment reader boundaries differ",
    );
  }
  for (const [index, block] of fragments.entries()) {
    const wrapper = parsed.blocks[index] as Node;
    const [attr, children] = wrapper.c as [
      [string, string[], unknown[]],
      Node[],
    ];
    if (
      wrapper.t !== "Div" || attr[0] !== `qbento-inline-proof-${index}` ||
      children.length !== 1
    ) {
      throw new Error(
        "UNMAPPED_PROVENANCE: original fragment is not one faithful inline block",
      );
    }
    const node = children[0];
    if (block.kind === "heading" && node.t === "Header") {
      const [level, headerAttr, nodes] = node.c as [
        number,
        [string, string[], unknown[]],
        Node[],
      ];
      if (level !== block.level) {
        throw new Error("UNMAPPED_PROVENANCE: original heading level differs");
      }
      proofs.set(block.id, {
        sourceHash: source.hash,
        blockId: block.id,
        kind: "heading",
        html: renderInline(nodes),
        readerId: headerAttr[0],
      });
    } else if (block.kind === "paragraph" && node.t === "Para") {
      proofs.set(block.id, {
        sourceHash: source.hash,
        blockId: block.id,
        kind: "paragraph",
        html: renderInline(node.c as Node[]),
      });
    } else {
      throw new Error(
        "UNMAPPED_PROVENANCE: original fragment is not faithful supported text",
      );
    }
  }
  return proofs;
}
