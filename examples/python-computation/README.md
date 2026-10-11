# Python ejecutado por Quarto/knitr

Este ejemplo utiliza Python real mediante el motor `knitr` de Quarto y el
paquete R `reticulate`. Requiere Quarto, R con `knitr`/`reticulate` y un Python
compatible con `matplotlib` ya instalado. El lector CSV es parte de Python.
`qbento` no instala ni administra esas dependencias. Este ejemplo no prueba el
motor Jupyter de Quarto: Jupyter requiere sus propios paquetes instalados.

Desde la raíz del repositorio, selecciona tu Python existente y renderiza:

```sh
RETICULATE_PYTHON=/ruta/absoluta/a/python3 RETICULATE_USE_MANAGED_VENV=no \
  deno task qbento render examples/python-computation/deck.qmd
deno task qbento edit examples/python-computation/deck.qmd
```

En Studio puedes mover y cambiar el estilo de la figura, editar el párrafo
literal, guardar el proyecto y revisar/aplicar la sincronización. Cambia
`data.csv` a los valores `1`, `20`, `30` y vuelve a renderizar: la línea cambia
y el total pasa de `6.0` a `51.0`, conservando el diseño guardado. La cifra y el
código mostrado tienen origen computado y no se sincronizan hacia Python como si
fueran texto redactado.

El chunk fija una fecha de metadata SVG y una sal reproducible para los IDs SVG
mediante `SOURCE_DATE_EPOCH` y `svg.hashsalt`. Matplotlib introduce de forma
predeterminada fecha/IDs que cambian entre ejecuciones; un plan de
reconciliación se rechaza si las salidas cambian antes de aplicarlo. Estos
ajustes son opciones de salida en el código del ejemplo.

La ejecución por `qbento render` registra el productor de cada chunk antes de
que los hooks u opciones alteren el código mostrado. Un adaptador temporal del
proceso R transporta ese recibo junto al resultado; el QMD original y las
opciones de caché no reciben marcas. Esto permite varias celdas, eco parcial y
figuras con stdout y `echo: false` sin inferir el origen por proximidad o por el
texto del eco. La caché de knitr conserva su clave y cada render captura un
recibo nuevo, incluso cuando la salida se recupera de caché.

Los filtros de usuario sobre QMD computado se rechazan antes de ejecutar porque
pueden cambiar los límites de productor. La configuración heredada también se
comprueba. La ruta ordinaria de Quarto utiliza una activación de recibos separada;
consulta `docs/evidence/PRODUCER-ACTIVATION.md` para su evidencia y límites.

La regresión de este ciclo se activa explícitamente cuando el entorno es
compatible:

```sh
QBENTO_PYTHON_EXECUTION_TEST=1 QBENTO_TEST_PYTHON=/ruta/absoluta/a/python3 \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/python_execution_test.ts
```

La prueba selecciona ese intérprete existente, desactiva la creación automática
de entornos por reticulate y utiliza una caché temporal de Matplotlib. Si falta
una dependencia con la prueba activada, falla con un diagnóstico; no la instala.
