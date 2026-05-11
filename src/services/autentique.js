
const AUTENTIQUE_URL = 'https://api.autentique.com.br/v2/graphql'

// ── Modelos de contrato mapeados para arquivos no Drive ───────────────────────
const CONTRACT_MODELS = [
  { id: 1, label: 'Gestão de Redes Sociais',  file: 'Gestão de Redes Sociais.docx', type: 'service' },
  { id: 2, label: 'Gestão de Tráfego',        file: 'Gestão de Tráfego.docx',       type: 'service' },
  { id: 3, label: 'Landing Page',             file: 'Landing Page.docx',            type: 'service' },
  { id: 4, label: 'Freela Designer',          file: 'Freela_Designer.docx',         type: 'freela'  },
  { id: 5, label: 'Freela Gestão de Tráfego', file: 'Freela_GestoTrafego.docx',     type: 'freela'  },
  { id: 6, label: 'Freela Editor de Vídeo',   file: 'Freela_EditorVideo.docx',      type: 'freela'  },
  { id: 7, label: 'Freela Outro',             file: 'Freela_Outro.docx',            type: 'freela'  },
]

const MUTATION = `
  mutation CreateDocumentMutation(
    $document: DocumentInput!,
    $signers: [SignerInput!]!,
    $file: Upload!
  ) {
    createDocument(document: $document, signers: $signers, file: $file) {
      id
      name
      created_at
      signatures {
        public_id
        name
        email
        signed { created_at }
        link { short_link }
      }
    }
  }
`

// ── Cria documento no Autentique e envia para assinatura ──────────────────────
async function sendContract({ clientName, clientEmail, modelFile, documentTitle, vars = {} }) {
  const { downloadContractFile }  = require('./drive')        // lazy load
  const { generateContractPdf }   = require('./docx')         // lazy load
  const token = process.env.AUTENTIQUE_TOKEN
  if (!token) throw new Error('AUTENTIQUE_TOKEN não configurado')

  const studioEmail = process.env.STUDIO_EMAIL
  const studioName  = process.env.STUDIO_NAME || 'Nadson Dias Comercial'

  // Baixa DOCX do Drive, preenche variáveis e converte para PDF
  const docxBuffer = await downloadContractFile(modelFile)
  const pdfBuffer  = await generateContractPdf(docxBuffer, vars)

  const variables = {
    document: { name: documentTitle },
    signers: [
      { email: clientEmail, name: clientName, action: 'SIGN' },
      { email: studioEmail, name: studioName, action: 'SIGN' }
    ],
    file: null
  }

  const formData = new FormData()
  formData.append('operations', JSON.stringify({ query: MUTATION, variables }))
  formData.append('map', JSON.stringify({ '0': ['variables.file'] }))
  formData.append('0', new Blob([pdfBuffer], { type: 'application/pdf' }), modelFile.replace('.docx', '.pdf'))

  const response = await fetch(AUTENTIQUE_URL, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body:    formData
  })

  const httpStatus = response.status
  const result = await response.json()

  console.log(`[autentique] HTTP ${httpStatus} — resposta:`, JSON.stringify(result).substring(0, 600))

  if (!response.ok) {
    throw new Error(`HTTP ${httpStatus}: ${JSON.stringify(result).substring(0, 300)}`)
  }

  if (result.errors?.length) {
    throw new Error(result.errors.map(e => e.message).join('; '))
  }

  if (!result.data?.createDocument) {
    throw new Error(`Resposta inesperada da API: ${JSON.stringify(result).substring(0, 300)}`)
  }

  return result.data.createDocument
}

// ── Consulta status de um documento ──────────────────────────────────────────
async function getDocumentStatus(autentiqueId) {
  const token = process.env.AUTENTIQUE_TOKEN
  if (!token) throw new Error('AUTENTIQUE_TOKEN não configurado')

  const query = `
    query {
      document(id: "${autentiqueId}") {
        id
        name
        signatures {
          public_id
          name
          email
          signed { created_at }
        }
      }
    }
  `

  const response = await fetch(AUTENTIQUE_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({ query })
  })

  const result = await response.json()
  if (result.errors?.length) throw new Error(result.errors[0].message)
  return result.data.document
}

module.exports = { CONTRACT_MODELS, sendContract, getDocumentStatus }
