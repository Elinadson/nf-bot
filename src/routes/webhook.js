const express        = require('express')
const { handleMessage } = require('../bot/handler')

const router = express.Router()

// ── Webhook Evolution API ─────────────────────────────────────────────────────
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200) // responde imediato para não timeout

  try {
    const body = req.body

    // Ignora eventos que não são mensagens
    if (body.event !== 'messages.upsert' && body.event !== 'MESSAGES_UPSERT') return

    // Evolution API v2 — data é objeto direto (não array)
    const msg = body.data
    if (!msg) return

    // Ignora mensagens enviadas pelo próprio bot
    if (msg.key?.fromMe) return
    // Ignora mensagens de grupo
    if (msg.key?.remoteJid?.includes('@g.us')) return
    // Ignora eventos de status (DELIVERY_ACK, READ, etc)
    if (msg.status && !msg.message) return

    const from = (msg.key?.remoteJid || '').replace('@s.whatsapp.net', '')
    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.listResponseMessage?.title
      || msg.message?.buttonsResponseMessage?.selectedDisplayText
      || ''

    console.log(`[webhook] msg de ${from}: "${text}"`)

    if (from && text) {
      await handleMessage({ from, body: text })
    }
  } catch (err) {
    console.error('[webhook] erro:', err.message)
  }
})

module.exports = router
