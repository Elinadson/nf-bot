const { google }     = require("googleapis")
const { GoogleAuth } = require("google-auth-library")
// onNFIssued carregado via lazy require para evitar dependencia circular
const db             = require("./supabase")

// ── Autenticação Google ───────────────────────────────────────────────────────
let auth
const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
if (keyJson) {
  try {
    const credentials = typeof keyJson === "string" ? JSON.parse(keyJson) : keyJson
    auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive.readonly"] })
  } catch (e) {
    console.error("[drive] Falha ao parsear GOOGLE_SERVICE_ACCOUNT_KEY:", e.message)
    auth = new GoogleAuth({ keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE, scopes: ["https://www.googleapis.com/auth/drive.readonly"] })
  }
} else {
  auth = new GoogleAuth({ keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE, scopes: ["https://www.googleapis.com/auth/drive.readonly"] })
}

const drive = google.drive({ version: "v3", auth })

const processedFiles = new Set()

// ── Busca todos os subdiretórios de uma pasta ─────────────────────────────────
async function getAllFolderIds(folderId) {
  const ids = [folderId]
  try {
    const res = await drive.files.list({
      q:        `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields:   'files(id)',
      pageSize: 50
    })
    for (const folder of (res.data.files || [])) {
      const subIds = await getAllFolderIds(folder.id)
      ids.push(...subIds)
    }
  } catch (e) {}
  return ids
}

// ── Verifica PDFs novos na pasta de NFs ──────────────────────────────────────
async function checkNewFiles() {
  const folderId = process.env.DRIVE_FOLDER_ID
  if (!folderId) return

  try {
    const folderIds = await getAllFolderIds(folderId)
    const parentQuery = folderIds.map(id => `'${id}' in parents`).join(' or ')

    const res = await drive.files.list({
      q:       `(${parentQuery}) and mimeType='application/pdf' and trashed=false`,
      fields:  'files(id, name, createdTime, webViewLink, webContentLink)',
      orderBy: 'createdTime desc',
      pageSize: 20
    })

    const files = res.data.files || []

    for (const file of files) {
      if (processedFiles.has(file.id)) continue

      const request = await matchRequestToFile(file.name)

      if (request) {
        console.log(`[drive] PDF detectado: ${file.name} → cliente: ${request.clients.name}`)
        processedFiles.add(file.id)

        const downloadUrl = `https://drive.google.com/uc?export=download&id=${file.id}`

        await db.updateRequest(request.id, {
          status:          'issued',
          drive_file_id:   file.id,
          drive_file_name: file.name,
          drive_file_url:  file.webViewLink,
          issued_at:       new Date().toISOString()
        })

        const updatedRequest = await db.getRequestById(request.id)
        const { onNFIssued } = require('../bot/handler')
        await onNFIssued(updatedRequest, downloadUrl, file.name)

        await db.updateRequest(request.id, {
          status:       'delivered',
          delivered_at: new Date().toISOString()
        })

      } else {
        processedFiles.add(file.id)
        console.log(`[drive] Arquivo não associado a solicitação pendente: ${file.name}`)
      }
    }
  } catch (err) {
    console.error('[drive] checkNewFiles erro:', err.message)
  }
}

async function matchRequestToFile(fileName) {
  const pendingRequests = [
    ...await db.getRequestsByStatus('sent'),
    ...await db.getRequestsByStatus('processing')
  ]

  if (pendingRequests.length === 0) return null

  const nameLower = fileName.toLowerCase().replace(/[_\-\s]/g, '')

  for (const req of pendingRequests) {
    const clientName = (req.clients.name || '').toLowerCase().replace(/[_\-\s]/g, '')
    if (nameLower.includes(clientName) || clientName.includes(nameLower.substring(0, 8))) {
      return req
    }
  }

  for (const req of pendingRequests) {
    const doc = (req.document || '').replace(/[.\-\/]/g, '')
    if (doc && nameLower.includes(doc)) return req
  }


  return null
}

// ── Baixa arquivo de contrato da pasta Drive Contratos ───────────────────────
function getWords(str) {
  return str
    .replace(/\.[^.]+$/, '')                              // remove extensão
    .split(/[\s_\-]+/)                                   // divide por espaço, _ ou -
    .map(w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .filter(w => w.length > 2)                            // ignora palavras curtas (de, a, o)
}

async function downloadContractFile(fileName) {
  const folderId = process.env.DRIVE_CONTRACTS_FOLDER_ID
  if (!folderId) throw new Error('DRIVE_CONTRACTS_FOLDER_ID não configurado no .env')

  const res = await drive.files.list({
    q:        `'${folderId}' in parents and trashed=false`,
    fields:   'files(id, name)',
    pageSize: 50
  })

  const files = res.data.files || []
  if (!files.length) throw new Error(`Pasta de contratos vazia ou inacessível`)

  const targetWords = getWords(fileName)

  // 1. Maior número de palavras em comum
  let best = null, bestScore = 0
  for (const f of files) {
    const fileWords = getWords(f.name)
    const score = targetWords.filter(w => fileWords.includes(w)).length
    if (score > bestScore) { bestScore = score; best = f }
  }

  // 2. Fallback: contenção normalizada completa
  if (!best || bestScore === 0) {
    const targetFull = targetWords.join('')
    best = files.find(f => {
      const n = getWords(f.name).join('')
      return n.includes(targetFull) || targetFull.includes(n)
    }) || null
  }

  if (!best) {
    const available = files.map(f => f.name).join(', ')
    throw new Error(`Modelo não encontrado no Drive para "${fileName}". Disponíveis: ${available}`)
  }

  console.log(`[drive] Modelo: "${fileName}" → "${best.name}" (score: ${bestScore})`)

  const response = await drive.files.get(
    { fileId: best.id, alt: 'media' },
    { responseType: 'arraybuffer' }
  )

  return Buffer.from(response.data)
}

function startWatcher(intervalMs = 2 * 60 * 1000) {
  console.log(`[drive] Watcher iniciado — verificando a cada ${intervalMs / 60000} minutos`)
  checkNewFiles()
  setInterval(checkNewFiles, intervalMs)
}

module.exports = { startWatcher, checkNewFiles, downloadContractFile, createClientFolder }

// ── Cria pasta do cliente em DRIVE_CLIENTS_FOLDER_ID ─────────────────────────
let driveWriter
function getDriveWriter() {
  if (driveWriter) return driveWriter
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const credentials = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson
  const writeAuth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive'] })
  driveWriter = google.drive({ version: 'v3', auth: writeAuth })
  return driveWriter
}

async function createClientFolder(clientName) {
  const parentId = process.env.DRIVE_CLIENTS_FOLDER_ID
  if (!parentId) return null
  try {
    const res = await getDriveWriter().files.create({
      requestBody: {
        name:     clientName,
        mimeType: 'application/vnd.google-apps.folder',
        parents:  [parentId],
      },
      fields: 'id,name,webViewLink',
    })
    console.log(`[drive] Pasta criada: ${res.data.name} (${res.data.id})`)
    return res.data
  } catch (err) {
    console.error('[drive] createClientFolder erro:', err.message)
    return null
  }
}
