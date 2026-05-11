const cron = require('node-cron')
const db   = require('./supabase')
const wpp  = require('./whatsapp')
const { sendScheduledReminder, sendBatchReminder } = require('../bot/handler')
const { fetchRoadmapMessage } = require('./notion')

// ── Roda todo dia às 9h no horário de Brasília ────────────────────────────────
function startScheduler() {
  cron.schedule('0 9 * * *', async () => {
    const today = new Date()
    const day   = today.getDate()

    console.log(`[scheduler] Verificando clientes com billing_day = ${day}`)

    const clients = await db.getClientsByBillingDay(day)

    if (!clients.length) {
      console.log(`[scheduler] Nenhum cliente com cobrança hoje (dia ${day})`)
      return
    }

    if (clients.length === 1) {
      try {
        await sendScheduledReminder(clients[0])
      } catch (err) {
        console.error(`[scheduler] Erro ao enviar lembrete para ${clients[0].name}:`, err.message)
      }
    } else {
      await sendBatchReminder(clients)
    }
  }, {
    timezone: 'America/Sao_Paulo'
  })

  // ── Roadmap diário para o grupo de operações às 8h ──────────────────────────
  cron.schedule('0 8 * * 1-5', async () => {
    const groupId = process.env.OPERATIONS_GROUP_ID
    if (!groupId) {
      console.warn('[scheduler] OPERATIONS_GROUP_ID não configurado — roadmap não enviado')
      return
    }
    try {
      console.log('[scheduler] Enviando roadmap diário para o grupo de operações...')
      const msg = await fetchRoadmapMessage()
      await wpp.sendText(groupId, msg)
      console.log('[scheduler] Roadmap enviado com sucesso')
    } catch (err) {
      console.error('[scheduler] Erro ao enviar roadmap:', err.message)
    }
  }, {
    timezone: 'America/Sao_Paulo'
  })

  console.log('[scheduler] Iniciado — lembretes às 09:00 | roadmap às 08:00 (seg-sex, Brasília)')
}

module.exports = { startScheduler }
