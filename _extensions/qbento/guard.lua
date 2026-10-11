-- Project-wide: also protects the final deck when --to selects a different format.
function Pandoc(doc)
  local output = tostring(PANDOC_STATE.output_file)
  if output:match('%.bento%.html$') then
    error('UNSAFE_QUARTO_OUTPUT: Quarto may not write a .bento.html directly; use qbento-html staging and guarded publication')
  end
end
