# Usar la implementación de desarrollo

Esta guía describe los flujos implementados. La evidencia actual corresponde a
Linux; [el registro de implementación](IMPLEMENTATION_STATUS.md) separa las
pruebas realizadas de las capacidades pendientes. No es una versión v1
publicada.

## Preparar una presentación

Necesitas Deno 2, Quarto y las dependencias que utilice tu documento. La
ejecución local se ha verificado con Deno 2.9.6, Quarto 1.10.19 y R 4.6.1. Un
documento sin cálculos no requiere R. Quarto-Bento no instala ni administra esos
entornos.

Desde este repositorio:

```sh
deno task qbento doctor
deno task qbento render /ruta/a/mi-presentacion/deck.qmd
deno task qbento edit /ruta/a/mi-presentacion/deck.qmd
```

`edit` mantiene un servidor local en ejecución e imprime una URL en `127.0.0.1`.
Abre esa URL en tu navegador. Si el proyecto todavía no tiene estado, lo genera;
si ya existe, abre el estado guardado para permitir recuperar y resolver cambios
pendientes. Usa **Recalcular** para incorporar cambios nuevos del QMD o de los
datos. Al cerrar el proceso del servidor, la página deja de guardar; vuelve a
ejecutar `edit` para continuar.

También puedes crear una [carpeta portátil de desarrollo](PACKAGING.md) y
utilizar su lanzador `qbento` en lugar de `deno task qbento`.

Mantén **una presentación QMD por carpeta de proyecto**: el directorio
`.qbento/` se vincula a un único documento. Para experimentar sin alterar los
ejemplos del repositorio, copia `deck.qmd` y `data.csv` de
[`examples/semantic-roundtrip`](../examples/semantic-roundtrip) a una carpeta
nueva. Este ejemplo necesita R y usa una figura SVG calculada a partir del CSV.

Define IDs explícitos antes de comenzar el diseño. Por ejemplo:

```qmd
---
title: Mi presentación
---

## Resultados {#resultados}

::: {#hallazgo}
Este texto se puede editar en Bento y sincronizar al QMD.
:::

## Conclusión {#conclusion}

::: {#cierre}
Siguiente paso del estudio.
:::
```

Los IDs permiten verificar a qué fragmento corresponde cada edición. Cambiar
identidades una vez guardado el diseño puede exigir resolver la correspondencia;
no se supone que añadir un ID posteriormente migre automáticamente el estado.
Consulta [la sintaxis y sus límites](AUTHORING.md) para componentes, código,
ecuaciones, notas, tablas y gráficos.

## Diseñar, guardar y sincronizar

1. Mueve, redimensiona o estiliza los objetos en el editor Bento. Puedes añadir
   formas decorativas y editar contenido authored compatible.
2. Pulsa **Guardar proyecto**. Se conservan diseño y cambios semánticos
   pendientes en `.qbento/`; el QMD sigue intacto. Puedes cerrar y volver a
   abrir Studio.
3. Pulsa **Revisar cambios**. Revisa el contenido anterior y propuesto, los
   fragmentos exactos del QMD y cualquier diagnóstico. Los cambios puramente
   visuales del sidecar no necesitan convertirse en Markdown.
4. Pulsa **Aplicar estos cambios a QMD** cuando apruebes la propuesta. El
   proceso verifica que el documento y el estado sigan correspondiendo al plan.
   Una eliminación de diapositiva requiere además la confirmación visible
   específica.
5. Pulsa **Recalcular** para ejecutar Quarto y actualizar la presentación con el
   contenido sincronizado y el diseño guardado.

El guardado nativo de Bento descarga un HTML independiente. **Guardar proyecto**
es el control que conserva el trabajo en este proyecto. Las ediciones computadas
no se transforman en código R/Python: modifica su cálculo o utiliza la
resolución explícita disponible.

Si has cambiado el QMD y Bento de forma incompatible, abre **Comparar con QMD**.
Esa comparación ejecuta el documento. Revisa el origen y los valores de cada
diferencia y elige una de las alternativas ofrecidas. **Guardar decisiones**
resuelve el estado del proyecto; escribir el QMD sigue requiriendo revisión y
sincronización. Separar explícitamente un resultado computado del cálculo hace
que ese objeto deje de actualizarse como resultado vinculado.

En **Diapositivas** puedes ocultar o volver a mostrar una diapositiva sin borrar
su QMD. Marcarla para eliminar conserva una operación pendiente que puede
restaurarse antes de sincronizar. Eliminar código productor, referencias u otros
casos ambiguos puede ser rechazado con un diagnóstico.

## Anotaciones y diseños reutilizables

Las anotaciones informativas del QMD se controlan con
`qbento-annotations: none|minimal|detailed` en su YAML inicial. El valor por
defecto es `minimal`: señala las diapositivas con diseño adicional mediante la
clase `.qbento-design`. `detailed` añade una referencia descriptiva al sidecar,
sin copiar las coordenadas; `none` omite esas trazas opcionales. Cambiarlas
forma parte de un plan revisado, nunca de un guardado o render implícito. Si
añadirlas no es seguro para las identidades existentes, Studio explica la
omisión.

Si el QMD conserva una de esas trazas pero faltan los datos de diseño
correspondientes, Studio muestra `MISSING_DESIGN` al abrir y recalcular. Puedes
ver una presentación base, pero eso no recupera la apariencia original.
Restaura los archivos indicados desde Git o una copia de seguridad, o revisa
explícitamente una traza que ya no corresponda al proyecto. Guardar y renderizar
no eliminan automáticamente la anotación del QMD.

Abre **Diseños y temas** para añadir o cambiar layouts con nombre y temas
básicos reutilizables. Selecciona el tema activo explícitamente. **Guardar
diseños** actualiza `.qbento/design.json`; no cambia el QMD, el HTML ni ejecuta
cálculos. Después, **Recalcular** aplica los valores guardados conservando las
modificaciones visuales y el contenido pendiente del proyecto. Los atributos
visuales declarados explícitamente en QMD mantienen su autoridad.

Los layouts se seleccionan en QMD con `bento-layout-name`. Renombrar o eliminar
un layout en el formulario requiere revisar esas referencias. Si el registro
cambió en otro editor, el guardado se rechaza y conserva el borrador: revísalo
antes de pulsar **Descartar borrador y recargar registro**. También puedes editar
el JSON siguiendo el [contrato del registro](DESIGN_REGISTRY.md).

## Cambiar datos y reconstruir

Modifica los datos de entrada y pulsa **Recalcular**, o ejecuta:

```sh
deno task qbento render /ruta/a/mi-presentacion/deck.qmd
```

Los resultados admitidos se recomputan y mantienen sus modificaciones visuales
guardadas y el mismo `docId`. Las ediciones semánticas pendientes no se
descartan. Un conflicto o una conversión que no pueda conservarse fielmente
puede impedir la publicación y requerir resolución.

Para reconstruir desde Git, conserva el QMD, sus entradas y los archivos
versionados de `.qbento/`, especialmente `project.json` y `state.json`, además
de cualquier configuración o recurso propio del proyecto. Mantén el entorno de
ejecución compatible. El HTML generado, los directorios de compilación y las
generaciones derivadas de widgets se pueden volver a producir. La reproducción
no promete píxeles idénticos entre sistemas operativos.

## Entregar HTML, PDF o gráficos interactivos

Las tablas calculadas compatibles de `gt` y `gtsummary` se representan mediante
una imagen PNG a doble resolución. Conservan encabezados, valores, formatos y
notas; modifica su contenido en el código productor. Define el ancho y la
tipografía en R para que sean adecuados para la diapositiva. La captura requiere
Chromium instalado y rechaza tablas que no caben completas, sin reducirlas ni
eliminar filas automáticamente. Consulta el
[ejemplo reproducible](../examples/rich-tables/README.md) y sus
[límites y pruebas](evidence/RICH-TABLES.md).

El archivo `deck.bento.html` contiene la presentación estática editable y puede
distribuirse como una copia independiente. El control nativo de exportación PDF
de Bento utiliza su representación de impresión; las diapositivas ocultas se
omiten. Se ha probado esa capa de impresión en Chromium sobre Linux, con PDF
inspeccionado visualmente; los diálogos del sistema operativo son otra capa.

Para Plotly compatible, **Presentar con gráficos** guarda y abre un visor que
incluye la presentación estática y vistas interactivas separadas. Los gráficos
no se superponen interactivamente sobre las posiciones exactas de la
diapositiva. El HTML ordinario y el PDF conservan el SVG estático. La generación
requiere Chromium y el runtime local compatible de Plotly; la salida interactiva
reúne sus recursos para visualizarse sin conexión. Consulta el
[alcance, versiones y controles del adaptador](evidence/PLOTLY.md).

Si editaste el HTML local con el guardado nativo, captura esos cambios
explícitamente antes de regenerar:

```sh
deno task qbento capture /ruta/a/mi-presentacion/deck.qmd /ruta/a/copia-editada.html
```

La captura verifica identidad y generación; no es una importación de cualquier
copia recibida o editada en paralelo. Recalcula después de una captura aceptada
antes de volver a editar una nueva copia nativa.

## Terminal y agentes

Los comandos emiten JSON. Puedes revisar y aplicar un plan de sincronización:

```sh
deno task qbento status /ruta/a/mi-presentacion/deck.qmd
deno task qbento sync /ruta/a/mi-presentacion/deck.qmd > plan.json
# Revisa plan.json antes de aplicar la propuesta.
deno task qbento sync /ruta/a/mi-presentacion/deck.qmd --apply plan.json
deno task qbento render /ruta/a/mi-presentacion/deck.qmd
```

`get` y `patch` permiten leer un snapshot y aplicar lotes JSON limitados, con
identidad y revisión obligatorias. Sigue el [contrato de la API](AGENT-API.md):
un parche guarda estado y no sincroniza ni ejecuta el QMD implícitamente.
La operación `slide.create` admite una diapositiva con texto y formas decorativas
y puede combinarse con edición o movimiento en el mismo lote. Exige un cálculo
que corresponda al QMD actual; si devuelve `STALE_SOURCE`, recalcula y vuelve a
leer el snapshot antes de preparar el lote. La nueva diapositiva se convierte
en QMD sólo después de revisar y aplicar su plan de sincronización.

`init` instala la extensión local para usar `quarto render` ordinario. Se niega
a reemplazar configuración existente; el modo `--extension-only` copia la
extensión y deja al usuario configurar su formato. Los hooks instalados ejecutan
el documento una vez por render y mantienen la protección del HTML modificado.
Consulta [la integración comprobada](evidence/QUARTO.md) antes de adaptar un
proyecto Quarto existente.

## Diagnósticos frecuentes

| Situación                              | Siguiente paso                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNCAPTURED_HTML_EDITS`                | Conserva el HTML editado y captura explícitamente la copia correspondiente. No lo borres para saltar el control.                                                                              |
| Revisión obsoleta o proyecto ocupado   | Espera la operación activa y vuelve a leer el proyecto antes de preparar otra edición.                                                                                                        |
| Conflicto entre QMD y Bento            | Compara los valores en Studio y guarda una resolución explícita; revisa después cualquier escritura a QMD.                                                                                    |
| `UNSUPPORTED_SYNC` o `UNMAPPED_DESIGN` | Conserva el cambio pendiente. Examina el diagnóstico y el subconjunto de contenido admitido; no se puede asumir una conversión segura.                                                        |
| Transacción interrumpida               | Ejecuta `recover deck.qmd inspect`, revisa el estado y elige explícitamente `finish` o `rollback` si el diagnóstico lo permite. Para el wrapper de Quarto, consulta también `quarto-recover`. |
| Estado corrupto o identidad distinta   | Conserva los archivos y sus backups para investigar. Borrar `.qbento/` pierde el vínculo con el diseño y los cambios pendientes.                                                              |
| `DESIGN_REGISTRY_RECOVERY_REQUIRED`    | Conserva el marcador y las versiones del registro. Sigue la [recuperación manual del registro](evidence/STUDIO-REGISTRY.md); el comando genérico `recover` no gestiona ese journal. |
| `MISSING_DESIGN`                      | Restaura el diseño externo indicado desde Git o un backup. Generar una presentación base no demuestra que su apariencia anterior haya sido recuperada. |

Los límites de contenido y las pruebas que todavía faltan se mantienen en el
[registro de implementación](IMPLEMENTATION_STATUS.md).
