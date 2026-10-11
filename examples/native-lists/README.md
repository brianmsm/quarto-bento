# Listas Markdown y edición nativa

Desde la raíz del repositorio:

```sh
deno task qbento edit examples/native-lists/deck.qmd
```

Las listas aparecen como objetos de texto nativos con viñetas o numeración.
Edita el texto de un elemento en Bento y guarda el proyecto: QMD conserva sus
bytes y la modificación queda pendiente. Revisa el plan de sincronización,
aplícalo y recalcula. La primera diapositiva parte sin IDs explícitos; el plan
revisado añade las identidades necesarias conservando los IDs nativos y diseño.

El último total proviene de R. Modificarlo en Bento produce un conflicto de
contenido computado; no cambia la expresión. Cambia los datos o código en QMD
para recalcularlo.

Se admiten listas anidadas, párrafos múltiples y el vocabulario rich-text
existente. Listas numeradas usan decimales desde 1 y puntos. Otros comienzos,
marcadores alfabéticos/romanos, checkboxes, imágenes y bloques de código requieren
adaptadores distintos y se rechazan explícitamente. El shell Bento fijado elimina
atributos `start`, `type` y `value`; no se simula su soporte mediante texto plano.


También puedes crear un objeto de texto con una lista nativa y guardarlo, tanto
en una diapositiva existente como en una nueva. Revisa su inserción en QMD antes
de aplicar y recalcular. Los objetos consecutivos conservan sus identidades
separadas aunque ambos sean listas de viñetas.

Una lista existente puede convertirse en un párrafo y un párrafo independiente
en una lista mediante el mismo flujo de guardado y revisión. Para eliminar una
lista, guarda la eliminación, revisa la operación y confírmala expresamente;
antes de aplicarla puedes recuperar texto y diseño desde Comparar con QMD.
Contenido computado, componentes y contenedores compartidos requieren editar
su fuente y conservan sus guardas habituales.
