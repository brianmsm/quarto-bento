# Apply a reusable layout to a plain deck

Copy this directory to a disposable project and render `deck.qmd`, then open
Studio. Existing local Quarto/R dependencies are required; nothing is installed.

1. Choose **Aplicar diseño** (Apply layout), or Bento's native **Apply layout**
   button.
2. On Figure, choose **Dos columnas** (Two columns). Assign `finding` to column
   1, the image and its caption to column 2. Other objects remain unselected,
   including the title. Preview positions and apply.
3. On Table, assign the table to column 1 and `table-note` to column 2. Repeat
   with the chart and `chart-note` on Chart.
4. Customize a position in Bento and save. Recompute: IDs, content provenance
   and visual customizations remain. Save preserves authored edits pending;
   **Revisar cambios** (Review changes) performs their separate reviewed QMD
   synchronization.
5. Change CSV values and recompute. The chart keeps its frame and reads fresh
   values. Making a category label too long for the saved column produces a
   native-content overflow warning; enlarge the object or apply a roomier
   layout.

**Diseños y temas** (Layouts and themes) can create a reusable named definition
with 1–6 columns, spacing and padding. Apply it with explicit members on another
slide. Updating that definition alone does not change already applied
free-object snapshots; reapply deliberately. Source `bento-layout-name`
components retain their existing regenerated-default behavior. No source wrapper
or empty semantic placeholder is created by Apply layout.
