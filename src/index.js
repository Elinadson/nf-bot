require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const express = require('express')
const path    = require('path')

const webhookRoutes    = require('./routes/webhook')
const adminRoutes      = require('./routes/admin')
const { setupWebhook } = require('./services/whatsapp')
const { startWatcher } = require('./services/drive')
const { startScheduler } = require('./services/scheduler')

const app  = express()
const PORT = process.env.PORT || 3001

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Painel admin ──────────────────────────────────────────────────────────────
app.use('/admin', adminRoutes)
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')))
app.get('/',      (req, res) => res.redirect('/admin'))

// ── Webhooks ──────────────────────────────────────────────────────────────────
app.use('/webhook', webhookRoutes)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  uptime: Math.floor(process.uptime()),
  time:   new Date().toISOString()
}))

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🤖 NF Bot iniciado na porta ${PORT}`)
  console.log(`   Painel admin: http://localhost:${PORT}/admin`)
  console.log(`   Webhook URL:  ${process.env.WEBHOOK_URL || 'http://localhost:' + PORT}/webhook/whatsapp\n`)

  // Configura webhook na Evolution API
  if (process.env.EVOLUTION_API_URL && process.env.WEBHOOK_URL) {
    await setupWebhook()
  } else {
    console.warn('[init] EVOLUTION_API_URL ou WEBHOOK_URL não configurados — webhook não registrado')
  }

  // Inicia watcher do Google Drive (verifica a cada 2 minutos)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.DRIVE_FOLDER_ID) {
    startWatcher(2 * 60 * 1000)
  } else {
    console.warn('[init] Google Drive não configurado — watcher desativado')
  }

  // Inicia scheduler de lembretes diários
  startScheduler()
})
