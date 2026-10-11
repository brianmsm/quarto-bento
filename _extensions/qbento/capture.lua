-- Quarto writes a disposable stage; the post hook safely publishes the final deck.
function Pandoc(doc)
  local input = quarto.doc.input_file
  local stage = pandoc.path.filename(input):gsub('%.qmd$', '.qbento-stage.html')
  if pandoc.path.filename(PANDOC_STATE.output_file) ~= stage then
    error('UNSAFE_QUARTO_OUTPUT: qbento-html must write ' .. stage .. '; remove output-file/--output overrides')
  end
  local dir = pandoc.path.directory(input)
  local receiptFile = assert(io.open(pandoc.path.join({dir, '.qbento', 'quarto-run.json'}), 'r'),
    'QUARTO_PROJECT_REQUIRED: use project type qbento and its pre/post hooks')
  local receipt = quarto.json.decode(receiptFile:read('*a'))
  receiptFile:close()
  if receipt.source ~= input then error('QUARTO_SOURCE_MISMATCH: receipt belongs to a different source') end
  local capture = {
    token = receipt.token,
    ast = quarto.json.decode(pandoc.write(pandoc.Pandoc(doc.blocks, { title = doc.meta.title }), 'json'))
  }
  local out = assert(io.open(pandoc.path.join({dir, '.qbento', 'quarto-stage', 'executed.json'}), 'w'))
  out:write(quarto.json.encode(capture))
  out:close()
end
