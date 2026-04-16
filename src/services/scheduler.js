const cron = require('node-cron')
const db   = require('./supabase')
const { sendScheduledReminder } = require('../bot/handler')

// ── Roda todo dia às 9h no horário de Brasília ────────────────────────────────
function startScheduler() {
  // Cron: segundos minutos horas dia mês dia-semana
  // '0 9 * * *' = todo dia às 09:00
  cron.schedule('0 9 * * *', async () => {
    const today = new Date()
    const day   = today.getDate()

    console.log(`[scheduler] Verificando clientes com billing_day = ${day}`)

    const clients = await db.getClientsByBillingDay(day)

    if (!clients.length) {
      console.log(`[scheduler] Nenhum cliente com cobrança hoje (dia ${day})`)
      return
    }

    for (const client of clients) {
      try {
        await sendScheduledReminder(client)
      } catch (err) {
        console.error(`[scheduler] Erro ao enviar lembrete para ${client.name}:`, err.message)
      }
    }
  }, {
    timezone: 'America/Sao_Paulo'
  })

  console.log('[scheduler] Iniciado — lembretes às 09:00 (Brasília)')
}

module.exports = { startScheduler }
