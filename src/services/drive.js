const { google }   = require('googleapis')
const { onNFIssued } = require('../bot/handler')
const db             = require('./supabase')

// ── Auth Google ───────────────────────────────────────────────────────────────
function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key:   process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  })
}

const drive = google.drive({ version: 'v3', auth: getAuth() })

// ── Arquivos já processados (em memória — sobrevive ao restart via DB) ────────
const processedFiles = new Set()

// ── Busca arquivos novos na pasta do Drive ────────────────────────────────────
async function checkNewFiles() {
  const folderId = process.env.DRIVE_FOLDER_ID
  if (!folderId) return

  try {
    const res = await drive.files.list({
      q:       `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
      fields:  'files(id, name, createdTime, webViewLink, webContentLink)',
      orderBy: 'createdTime desc',
      pageSize: 20
    })

    const files = res.data.files || []

    for (const file of files) {
      if (processedFiles.has(file.id)) continue

      // Tenta identificar o cliente pelo nome do arquivo
      // Padrão esperado: "NomeCLiente_Referencia.pdf" ou qualquer pdf novo
      const request = await matchRequestToFile(file.name)

      if (request) {
        console.log(`[drive] PDF detectado: ${file.name} → cliente: ${request.clients.name}`)
        processedFiles.add(file.id)

        // Gera link de download direto
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`

        // Atualiza no banco
        await db.updateRequest(request.id, {
          status:         'issued',
          drive_file_id:  file.id,
          drive_file_name: file.name,
          drive_file_url: file.webViewLink,
          issued_at:      new Date().toISOString()
        })

        // Recarrega com dados do cliente
        const updatedRequest = await db.getRequestById(request.id)

        // Notifica cliente
        await onNFIssued(updatedRequest, downloadUrl, file.name)

        // Atualiza status final
        await db.updateRequest(request.id, {
          status:       'delivered',
          delivered_at: new Date().toISOString()
        })

      } else {
        // Arquivo não associado ainda — marca como visto mas não processa
        // Pode ser uma NF já entregue ou arquivo de outra referência
        processedFiles.add(file.id)
        console.log(`[drive] Arquivo não associado a solicitação pendente: ${file.name}`)
      }
    }
  } catch (err) {
    console.error('[drive] checkNewFiles erro:', err.message)
  }
}

// ── Tenta casar arquivo com solicitação pendente ──────────────────────────────
// Lógica: busca solicitações com status 'sent' ou 'processing'
// Tenta casar pelo nome do arquivo com nome do cliente ou referência
async function matchRequestToFile(fileName) {
  const pendingRequests = [
    ...await db.getRequestsByStatus('sent'),
    ...await db.getRequestsByStatus('processing')
  ]

  if (pendingRequests.length === 0) return null

  const nameLower = fileName.toLowerCase().replace(/[_\-\s]/g, '')

  // 1. Tenta casar por nome do cliente
  for (const req of pendingRequests) {
    const clientName = (req.clients.name || '').toLowerCase().replace(/[_\-\s]/g, '')
    if (nameLower.includes(clientName) || clientName.includes(nameLower.substring(0, 8))) {
      return req
    }
  }

  // 2. Tenta casar por CNPJ no nome do arquivo
  for (const req of pendingRequests) {
    const doc = (req.document || '').replace(/[.\-\/]/g, '')
    if (doc && nameLower.includes(doc)) return req
  }

  // 3. Se só existe 1 solicitação pendente, associa automaticamente
  if (pendingRequests.length === 1) {
    return pendingRequests[0]
  }

  return null
}

// ── Inicia polling a cada 2 minutos ──────────────────────────────────────────
function startWatcher(intervalMs = 2 * 60 * 1000) {
  console.log(`[drive] Watcher iniciado — verificando a cada ${intervalMs / 60000} minutos`)

  // Roda imediatamente na primeira vez
  checkNewFiles()

  // Depois roda no intervalo
  setInterval(checkNewFiles, intervalMs)
}

module.exports = { startWatcher, checkNewFiles }
