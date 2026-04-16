const express        = require('express')
const { handleMessage } = require('../bot/handler')

const router = express.Router()

// ── Webhook Evolution API ─────────────────────────────────────────────────────
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200) // responde imediato para não timeout

  try {
    const body = req.body

    // Ignora eventos que não são mensagens
    if (body.event !== 'messages.upsert') return
    if (!body.data?.messages) return

    for (const msg of body.data.messages) {
      // Ignora mensagens enviadas pelo próprio bot
      if (msg.key?.fromMe) continue
      // Ignora mensagens de grupo
      if (msg.key?.remoteJid?.includes('@g.us')) continue

      const from = (msg.key?.remoteJid || '').replace('@s.whatsapp.net', '')
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.listResponseMessage?.title
        || ''

      if (from && text) {
        await handleMessage({ from, body: text })
      }
    }
  } catch (err) {
    console.error('[webhook] erro:', err.message)
  }
})

module.exports = router
