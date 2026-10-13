# Markdown lists and native editing

From the repository root:

```sh
deno task qbento edit examples/native-lists/deck.qmd
```

Lists appear as native text objects with bullets or numbering. Edit an item's
text in Bento and save the project: QMD retains its bytes and the change stays
pending. Review the synchronization plan, apply it, and recalculate. The first
slide starts without explicit IDs; the reviewed plan adds required identities
while retaining native IDs and design.

The final total comes from R. Editing it in Bento produces a computed-content
conflict and does not change its expression. Change data or source code in QMD
to recalculate it.

Nested lists, multiple paragraphs, and the existing rich-text vocabulary are
supported. Numbered lists use decimal numbers starting at 1 with periods. Other
start values, alphabetical/Roman markers, checkboxes, images, and code blocks
need separate adapters and are explicitly refused. The pinned Bento shell
removes `start`, `type`, and `value` attributes; plain text is not used to
simulate their support.

You can also create a text object containing a native list and save it on an
existing or new slide. Review its QMD insertion before apply and recalculate.
Consecutive objects retain separate identities even if both are bulleted lists.

An existing list can become a paragraph and an independent paragraph can become
a list through the same save/review workflow. To delete a list, save the
deletion, review the operation, and explicitly confirm it. Before apply, recover
text and design through **Comparar con QMD** (Compare with QMD). Computed
content, components, and shared containers require source editing and retain
their usual guards.
