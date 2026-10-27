import {
  applyComponentDesign,
  componentFrames,
  type DesignDeclaration,
  type DesignDefaults,
  DesignError,
  type Frame,
  type MeasuredComponents,
} from "./design.ts";
import type { Element, Projection } from "./types.ts";

type Fields = NonNullable<Projection["design"]>[string];
const geometry = new Set(["x", "y", "w", "h"]);
/** Compose a bounded source component without pretending child transforms are parent edits. */
export function projectComponent(
  groups: Element[][],
  declaration: DesignDeclaration,
  frame: Frame,
  existing: Fields,
  defaults: DesignDefaults = {},
  measured?: MeasuredComponents,
): { elements: Element[]; fields: Fields; decorativeIds: string[] } {
  if (declaration.component === "layout") {
    const slots =
      componentFrames(declaration, frame, groups.length, defaults).children;
    groups.forEach((group, i) => {
      group = group.filter((element) => !measured?.omitted.has(element.id));
      const width = Math.max(...group.map((e) => Number(e.x) + Number(e.w))) -
        Math.min(...group.map((e) => Number(e.x)));
      const height = Math.max(...group.map((e) => Number(e.y) + Number(e.h))) -
        Math.min(...group.map((e) => Number(e.y)));
      if (width > slots[i].w + .01 || height > slots[i].h + .01) {
        const owned = group.some((element) =>
          existing[element.id]?.ownedPaths.some((field) =>
            ["fontSize", "letterSpacing", "strokeWidth", "radius"].includes(
              field,
            )
          )
        );
        throw new DesignError(
          owned ? "COMPONENT_CHILD_DESIGN_SCALE" : "COMPONENT_CONTENT_OVERFLOW",
          "Measured content exceeds its final layout slot; refusing unreadable automatic shrink.",
        );
      }
    });
  }
  const projected = applyComponentDesign(groups, declaration, {
    ...defaults,
    frame,
  }, measured);
  const fields: Fields = {};
  const original = new Map(
    groups.flat().map((element) => [element.id, element]),
  );
  for (const element of projected.elements) {
    const previous = existing[element.id];
    for (const field of previous?.ownedPaths ?? []) {
      if (geometry.has(field)) {
        // Even a coincidental equal value is ambiguous after a parent frame change.
        throw new DesignError(
          "COMPONENT_CHILD_GEOMETRY",
          "Declare coupled geometry on the containing component, not its child objects.",
        );
      }
      if (
        ["fontSize", "letterSpacing", "strokeWidth", "radius"].includes(
          field,
        ) &&
        element[field] !== original.get(element.id)![field]
      ) {
        throw new DesignError(
          "COMPONENT_CHILD_DESIGN_SCALE",
          "A parent component would rescale an explicitly authored child style; apply that field to the outer component or retain it as a native override.",
        );
      }
      if (field in declaration.properties) {
        throw new DesignError(
          "AMBIGUOUS_DESIGN_OWNERSHIP",
          "A component and child declare the same native visual field.",
        );
      }
      // A default card theme must not override explicitly authored child typography.
      element[field] = original.get(element.id)![field];
    }
    if (measured?.fixed.has(element.id)) {
      const before = original.get(element.id)!;
      for (
        const field of [
          "w",
          "h",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "lineHeight",
          "letterSpacing",
          "align",
          "valign",
        ]
      ) {
        if (element[field] !== before[field]) {
          throw new DesignError(
            "COMPONENT_MEASURED_STYLE",
            "An enclosing component would change measured KPI metrics; declare typography on the KPI or its roles, and geometry on its enclosing layout.",
          );
        }
      }
    }
    if (
      element.type === "code" && !measured?.viewports?.has(element.id) &&
      Number(element.h) + 0.01 <
        String(element.content).split("\n").length * Number(element.fontSize) *
          Number(element.lineHeight ?? 1.25)
    ) {
      throw new DesignError(
        "COMPONENT_CONTENT_OVERFLOW",
        "Code typography exceeds its component box; use a taller frame or smaller explicit font.",
      );
    }
    fields[element.id] = {
      ownedPaths: [
        ...new Set([
          ...(previous?.ownedPaths ?? []),
          ...(projected.ownershipByElement[element.id] ?? []),
        ]),
      ],
      bindings: {
        ...(previous?.bindings ?? {}),
        ...Object.fromEntries(
          Object.entries(projected.bindingsByElement[element.id] ?? {}).map(
            ([field, attribute]) => [field, {
              sourceId: declaration.sourceId,
              attribute,
            }],
          ),
        ),
      },
    };
  }
  // One object cannot establish an update to an attribute inherited by several
  // siblings. Preserve source ownership, but require an explicit group adapter
  // rather than changing their source from a single child's edit.
  const counts = new Map<string, number>();
  for (const entry of Object.values(fields)) {
    for (const [field, binding] of Object.entries(entry.bindings)) {
      if (binding.sourceId !== declaration.sourceId) continue;
      const key = `${field}/${binding.attribute}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const entry of Object.values(fields)) {
    for (const [field, binding] of Object.entries(entry.bindings)) {
      if (
        binding.sourceId === declaration.sourceId &&
        counts.get(`${field}/${binding.attribute}`)! > 1
      ) delete entry.bindings[field];
    }
  }
  return {
    elements: projected.elements,
    fields,
    decorativeIds: projected.decorativeIds,
  };
}

/** Read only class tokens in the original opener, never text inside attribute values. */
export function sourceComponentClass(raw: string): string | undefined {
  const content = /\{([^{}]*)\}[ \t]*$/.exec(raw.split(/\r?\n/)[0])?.[1];
  const tokens = content?.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.find((token) =>
    [".bento-card", ".bento-layout", ".bento-code", ".bento-kpi"].includes(
      token,
    )
  );
}
/** Quarto itself owns layout= and interprets its value as JSON before projection. */
export function assertCompatibleComponentSource(
  source: import("../source/mod.ts").SourceDocument,
): void {
  for (const block of source.blocks) {
    if (block.kind !== "div") continue;
    const content = /\{([^{}]*)\}[ \t]*$/.exec(block.raw.split(/\r?\n/)[0])
      ?.[1];
    if (content === undefined) continue;
    const tokens: string[] = content.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) ??
      [];
    if (!tokens.includes(".bento-layout")) continue;
    if (
      tokens.some((token, i) =>
        /^layout=/.test(token) ||
        token === "layout" && tokens[i + 1]?.startsWith("=")
      )
    ) {
      throw new DesignError(
        "QUARTO_LAYOUT_ATTRIBUTE_COLLISION",
        'Use bento-layout-name="two-column" on .bento-layout; layout= belongs to Quarto and expects its own JSON layout syntax.',
      );
    }
  }
}
