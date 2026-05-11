const express        = require('express')
const { handleMessage } = require('../bot/handler')
const { getAudioBase64 } = require('../services/whatsapp')
const db             = require('../services/supabase')
const wpp            = require('../services/whatsapp')

const router = express.Router()

// ── Webhook Evolution API (WhatsApp) ──────────────────────────────────────────
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200)

  try {
    const body = req.body

    if (body.event !== 'messages.upsert' && body.event !== 'MESSAGES_UPSERT') return

    const msg = body.data
    if (!msg) return

    if (msg.key?.fromMe) return
    if (msg.key?.remoteJid?.includes('@g.us')) return
    if (msg.status && !msg.message) return

    const from = (msg.key?.remoteJid || '').replace('@s.whatsapp.net', '')

    // ── Texto ────────────────────────────────────────────────────────────────
    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.listResponseMessage?.title
      || msg.message?.buttonsResponseMessage?.selectedDisplayText
      || ''

    // ── Áudio (audioMessage = gravação, pttMessage = voice note) ─────────────
    const isAudio = !!(msg.message?.audioMessage || msg.message?.pttMessage)
    let audio = null

    if (isAudio) {
      console.log(`[webhook] áudio recebido de ${from}`)
      const audioData = await getAudioBase64(msg.key, msg.message)
      if (audioData) {
        audio = audioData
      } else {
        audio = { error: true }
      }
    }

    // Ignora se não tem texto nem áudio
    if (!from || (!text && !isAudio)) return

    console.log(`[webhook] msg de ${from}: "${text || '[áudio]'}"`)

    if (from) {
      await handleMessage({ from, body: text, audio })
    }
  } catch (err) {
    console.error('[webhook] erro:', err.message)
  }
})

// ── Webhook Autentique (assinaturas) ──────────────────────────────────────────
router.post('/autentique', async (req, res) => {
  res.sendStatus(200)

  try {
    const body      = req.body
    const eventType = body.event?.type || ''
    const eventData = body.event?.data || {}

    // ID do documento: event.data.id (doc events) ou event.data.document (sig events)
    const docId = eventData.id || eventData.document || body.document?.id
    if (!docId) { console.log('[webhook autentique] sem docId — ignorado'); return }

    console.log(`[webhook autentique] tipo: ${eventType} | doc: ${docId}`)

    const contract = await db.getContractByAutentiqueId(docId)
    if (!contract) {
      console.log(`[webhook autentique] contrato nao encontrado: ${docId}`)
      return
    }

    const signatures  = eventData.signatures || []
    const signedCount = eventData.signed_count  ?? signatures.filter(s => s.signed).length
    const totalCount  = eventData.signatures_count ?? signatures.length
    const allSigned   = totalCount > 0 && signedCount >= totalCount
    const isFinished  = eventType === 'document.finished' || allSigned

    if (isFinished) {
      await db.updateContract(contract.id, {
        status:       'completed',
        completed_at: new Date().toISOString()
      })
      const client     = contract.clients
      const adminPhone = process.env.ADMIN_PHONE
      if (adminPhone && client) {
        await wpp.sendText(adminPhone,
          `✅ *Contrato assinado por ambas as partes!*\n\n` +
          `👤 *Cliente:* ${client.name}\n` +
          `📄 *Modelo:* ${contract.model}\n` +
          `🗓️ ${new Date().toLocaleDateString('pt-BR')}\n\n` +
          `O contrato esta totalmente assinado.`
        )
      }
      console.log(`[webhook autentique] finalizado — ${contract.clients?.name}`)

    } else if (eventType === 'document.updated' || eventType === 'signature.accepted') {
      const signer     = signatures.find(s => s.signed) || (eventType === 'signature.accepted' ? eventData : null)
      const signerName = signer?.user?.name || signer?.name || 'Alguem'
      if (process.env.ADMIN_PHONE) {
        await wpp.sendText(process.env.ADMIN_PHONE,
          `✍️ *${signerName}* assinou o contrato de *${contract.clients?.name}*.\n\nAguardando a outra parte.`
        )
      }
      await db.updateContract(contract.id, { status: 'partial' })
    }

  } catch (err) {
    console.error('[webhook autentique] erro:', err.message)
  }
})
module.exports = router
