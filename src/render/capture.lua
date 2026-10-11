-- Runs after Quarto's HTML transforms, so figures have concrete output assets.
function Pandoc(doc)
  local path = os.getenv('QBENTO_AST')
  if not path then error('QBENTO_AST is required') end
  local out = assert(io.open(path, 'w'))
  out:write(pandoc.write(pandoc.Pandoc(doc.blocks, { title = doc.meta.title }), 'json'))
  out:close()
end
