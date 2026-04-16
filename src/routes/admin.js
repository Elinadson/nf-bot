const express = require('express')
const db      = require('../services/supabase')
const { checkNewFiles } = require('../services/drive')

const router  = express.Router()

// ── Chave de acesso simples para o painel ─────────────────────────────────────
function requireAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key
  if (key && key === process.env.ADMIN_KEY) return next()
  res.status(401).json({ error: 'Unauthorized' })
}

// ── Clientes ──────────────────────────────────────────────────────────────────
router.get('/clients', requireAuth, async (req, res) => {
  const clients = await db.getAllClients()
  res.json(clients)
})

router.post('/clients', requireAuth, async (req, res) => {
  try {
    const client = await db.upsertClient(req.body)
    res.json(client)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

router.delete('/clients/:id', requireAuth, async (req, res) => {
  try {
    await db.deleteClient(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Solicitações ──────────────────────────────────────────────────────────────
router.get('/requests', requireAuth, async (req, res) => {
  const requests = await db.getAllRequests({ limit: 100 })
  res.json(requests)
})

router.patch('/requests/:id', requireAuth, async (req, res) => {
  try {
    const updated = await db.updateRequest(req.params.id, req.body)
    res.json(updated)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// ── Forçar verificação do Drive ───────────────────────────────────────────────
router.post('/drive/check', requireAuth, async (req, res) => {
  res.json({ ok: true, message: 'Verificação iniciada' })
  await checkNewFiles()
})

// ── Status geral ──────────────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  const all     = await db.getAllRequests({ limit: 500 })
  const pending = all.filter(r => r.status === 'pending').length
  const sent    = all.filter(r => r.status === 'sent').length
  const processing = all.filter(r => r.status === 'processing').length
  const issued  = all.filter(r => r.status === 'issued').length
  const delivered = all.filter(r => r.status === 'delivered').length
  res.json({ total: all.length, pending, sent, processing, issued, delivered })
})

module.exports = router
