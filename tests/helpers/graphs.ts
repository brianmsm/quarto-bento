export const fork =
  '## Proceso {#flow}\n\n:::: {#graph .bento-diagram}\n\n::: {#input .bento-node}\nEntrada\n:::\n\n::: {#left .bento-node}\nModelo A\n:::\n\n::: {#right .bento-node}\nModelo B\n:::\n\n::: {#edge-a .bento-edge from="input" to="left"}\nAjuste\n:::\n\n::: {#edge-b .bento-edge from="input" to="right"}\n:::\n\n::::\n';
export const timeline =
  "## Historia {#history}\n\n:::: {#story .bento-timeline}\n\n::: {#start .bento-milestone}\nDiseño\n:::\n\n::: {#study .bento-milestone}\nEstudio\n:::\n\n::: {#report .bento-milestone}\nInforme\n:::\n\n::::\n";
