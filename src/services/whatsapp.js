const axios = require('axios')

const BASE   = process.env.EVOLUTION_API_URL
const INST   = process.env.EVOLUTION_INSTANCE
const APIKEY = process.env.EVOLUTION_API_KEY

const api = axios.create({
  baseURL: `${BASE}/message`,
  headers: { apikey: APIKEY, 'Content-Type': 'application/json' }
})

// ── Enviar texto ──────────────────────────────────────────────────────────────
async function sendText(to, text) {
  try {
    await api.post(`/sendText/${INST}`, {
      number: to,
      text
    })
  } catch (err) {
    console.error('[whatsapp] sendText erro:', JSON.stringify(err.response?.data, null, 2) || err.message)
  }
}

// ── Enviar documento/PDF ──────────────────────────────────────────────────────
async function sendDocument(to, fileUrl, fileName, caption = '') {
  try {
    await api.post(`/sendMedia/${INST}`, {
      number: to,
      mediatype: 'document',
      media: fileUrl,
      fileName,
      caption
    })
  } catch (err) {
    console.error('[whatsapp] sendDocument erro:', err.response?.data || err.message)
  }
}

// ── Enviar documento via base64 (sem precisar de URL pública) ─────────────────
async function sendDocumentBase64(to, base64Content, mimeType, fileName, caption = '') {
  try {
    await api.post(`/sendMedia/${INST}`, {
      number:    to,
      mediatype: 'document',
      media:     `data:${mimeType};base64,${base64Content}`,
      fileName,
      caption
    })
  } catch (err) {
    console.error('[whatsapp] sendDocumentBase64 erro:', err.response?.data || err.message)
  }
}

// ── Baixar áudio de mensagem como base64 ────────────────────────────────────
async function getAudioBase64(msgKey, msgContent) {
  try {
    const response = await axios.post(
      `${BASE}/chat/getBase64FromMediaMessage/${INST}`,
      { message: { key: msgKey, message: msgContent } },
      { headers: { apikey: APIKEY, 'Content-Type': 'application/json' } }
    )
    const { base64, mimetype } = response.data
    return {
      base64,
      mimeType: (mimetype || 'audio/ogg').split(';')[0].trim()
    }
  } catch (err) {
    console.error('[whatsapp] getAudioBase64 erro:', err.response?.data || err.message)
    return null
  }
}

// ── Configurar webhook na Evolution API ──────────────────────────────────────
async function setupWebhook() {
  const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/whatsapp`
  try {
    await axios.post(
      `${BASE}/webhook/set/${INST}`,
      {
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT']
        }
      },
      { headers: { apikey: APIKEY } }
    )
    console.log('[whatsapp] Webhook configurado:', webhookUrl)
  } catch (err) {
    console.error('[whatsapp] setupWebhook erro:', err.response?.data || err.message)
  }
}

module.exports = { sendText, sendDocument, sendDocumentBase64, getAudioBase64, setupWebhook }
