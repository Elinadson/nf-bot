const PizZip        = require('pizzip')
const Docxtemplater = require('docxtemplater')
const { execSync }  = require('child_process')
const fs            = require('fs')
const path          = require('path')
const os            = require('os')

async function generateContractPdf(docxBuffer, variables) {
  const tmpDir  = os.tmpdir()
  const ts      = Date.now()
  const tmpDocx = path.join(tmpDir, `contract_${ts}.docx`)

  try {
    const zip = new PizZip(docxBuffer)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks:    true,
      delimiters:    { start: '{{', end: '}}' }   // templates usam {{VARIAVEL}}
    })

    doc.render(variables)

    const filled = doc.getZip().generate({ type: 'nodebuffer' })
    fs.writeFileSync(tmpDocx, filled)

    console.log('[docx] Variáveis aplicadas:', Object.keys(variables).join(', '))

    execSync(`libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`, {
      timeout: 30000
    })

    const tmpPdf = tmpDocx.replace('.docx', '.pdf')
    if (!fs.existsSync(tmpPdf)) throw new Error('LibreOffice não gerou o PDF')
    return fs.readFileSync(tmpPdf)

  } catch (err) {
    if (err.properties?.errors) {
      const tags = err.properties.errors.map(e => e.properties?.id).join(', ')
      throw new Error(`Erro no template DOCX — tags inválidas: ${tags}`)
    }
    throw err
  } finally {
    [tmpDocx, tmpDocx.replace('.docx', '.pdf')].forEach(f => { try { fs.unlinkSync(f) } catch {} })
  }
}

module.exports = { generateContractPdf }
