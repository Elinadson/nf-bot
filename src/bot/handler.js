const db       = require('../services/supabase')
const wpp      = require('../services/whatsapp')
const email    = require('../services/email')
const tmpl     = require('./templates')
const Anthropic = require('@anthropic-ai/sdk')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Detecta intenção com Claude ───────────────────────────────────────────────
async function detectIntent(text) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: `Você é um classificador de intenções para um bot de notas fiscais.
Classifique a mensagem em UMA das opções:
- SOLICITAR_NF: quer solicitar/pedir nota fiscal
- VER_STATUS: quer ver status de uma nota existente
- CONFIRMAR: está confirmando algo (sim, ok, confirmo, s, yes)
- CANCELAR: está cancelando (não, nao, n, cancela, cancelar)
- SAUDACAO: oi, olá, bom dia, etc.
- OUTRO: qualquer outra coisa

Responda APENAS com a palavra da classificação, sem explicação.`,
      messages: [{ role: 'user', content: text }]
    })
    return msg.content[0].text.trim().toUpperCase()
  } catch (err) {
    console.error('[intent] erro:', err.message)
    return 'OUTRO'
  }
}

// ── Normaliza valor monetário ─────────────────────────────────────────────────
function parseValue(text) {
  // Aceita: "2500", "2.500", "2.500,00", "R$ 2.500,00"
  const clean = text.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const val   = parseFloat(clean)
  return isNaN(val) ? null : val
}

// ── Handler principal de mensagens ────────────────────────────────────────────
async function handleMessage({ from, body }) {
  const text  = (body || '').trim()
  const phone = from.replace(/[^0-9]/g, '')

  if (!text) return

  // Log entrada
  const client = await db.getClientByPhone(phone)
  await db.logMessage({ whatsapp: phone, direction: 'in', body: text, clientId: client?.id })

  // Estado atual da conversa
  const conv = await db.getConversationState(phone) || { state: 'idle', context: {} }

  async function reply(msg) {
    await wpp.sendText(phone, msg)
    await db.logMessage({ whatsapp: phone, direction: 'out', body: msg, clientId: client?.id })
  }

  // ── Cliente não cadastrado ────────────────────────────────────────────────
  if (!client) {
    await reply(tmpl.unknownClient())
    return
  }

  const textLower = text.toLowerCase().trim()

  // ── Máquina de estados ────────────────────────────────────────────────────
  switch (conv.state) {

    // ── IDLE: início de conversa ────────────────────────────────────────────
    case 'idle': {
      const intent = await detectIntent(text)

      if (intent === 'SOLICITAR_NF' || text === '1') {
        // Inicia fluxo de solicitação
        const ctx = {
          service:  client.default_service || null,
          value:    client.default_value   || null,
          document: client.cnpj || client.cpf || null,
        }

        // Se já tem tudo, pula para confirmação
        if (ctx.service && ctx.value && ctx.document) {
          const now    = new Date()
          const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
          ctx.reference = `${months[now.getMonth()]}/${now.getFullYear()}`
          await db.setConversationState(phone, 'awaiting_confirmation', ctx, client.id)
          await reply(tmpl.confirmRequest(client, ctx.service, ctx.value, ctx.document, ctx.reference))
        } else if (!ctx.service) {
          await db.setConversationState(phone, 'awaiting_service', ctx, client.id)
          await reply(tmpl.askService(client.default_service))
        } else if (!ctx.value) {
          await db.setConversationState(phone, 'awaiting_value', ctx, client.id)
          await reply(tmpl.askValue(client.default_value))
        } else {
          await db.setConversationState(phone, 'awaiting_reference', ctx, client.id)
          await reply(tmpl.askReference())
        }
        return
      }

      if (intent === 'VER_STATUS' || text === '2') {
        const requests = await db.getRequestsByStatus('pending')
          .then(r => r.filter(x => x.client_id === client.id))
        const all = await db.getAllRequests({ limit: 5 })
          .then(r => r.filter(x => x.client_id === client.id && x.status !== 'delivered'))
        await reply(tmpl.statusMessage(all))
        return
      }

      if (intent === 'SAUDACAO') {
        await reply(tmpl.greeting(client.name))
        return
      }

      // Fallback: mostra menu
      await reply(tmpl.greeting(client.name))
      return
    }

    // ── Aguardando serviço ──────────────────────────────────────────────────
    case 'awaiting_service': {
      let service
      if (textLower === 'ok' && client.default_service) {
        service = client.default_service
      } else {
        service = text
      }
      const ctx = { ...conv.context, service }

      if (!ctx.value) {
        await db.setConversationState(phone, 'awaiting_value', ctx, client.id)
        await reply(tmpl.askValue(client.default_value))
      } else {
        await db.setConversationState(phone, 'awaiting_reference', ctx, client.id)
        await reply(tmpl.askReference())
      }
      return
    }

    // ── Aguardando valor ────────────────────────────────────────────────────
    case 'awaiting_value': {
      let value
      if (textLower === 'ok' && client.default_value) {
        value = client.default_value
      } else {
        value = parseValue(text)
        if (!value) {
          await reply(`Não consegui entender o valor. Por favor, informe apenas o número.\nEx: *2500* ou *2.500,00*`)
          return
        }
      }
      const ctx = { ...conv.context, value }
      await db.setConversationState(phone, 'awaiting_reference', ctx, client.id)
      await reply(tmpl.askReference())
      return
    }

    // ── Aguardando referência ───────────────────────────────────────────────
    case 'awaiting_reference': {
      const now    = new Date()
      const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
      let reference
      if (textLower === 'ok') {
        reference = `${months[now.getMonth()]}/${now.getFullYear()}`
      } else {
        reference = text
      }
      const ctx = {
        ...conv.context,
        reference,
        document: conv.context.document || client.cnpj || client.cpf || '—'
      }
      await db.setConversationState(phone, 'awaiting_confirmation', ctx, client.id)
      await reply(tmpl.confirmRequest(client, ctx.service, ctx.value, ctx.document, ctx.reference))
      return
    }

    // ── Aguardando confirmação final ────────────────────────────────────────
    case 'awaiting_confirmation': {
      const intent = await detectIntent(text)

      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const ctx = conv.context

        // Cria a solicitação no banco
        const request = await db.createRequest({
          client_id:  client.id,
          service:    ctx.service,
          value:      ctx.value,
          document:   ctx.document,
          reference:  ctx.reference,
          status:     'pending',
          requested_via: 'whatsapp'
        })

        // Notifica contabilidade
        await notifyAccounting(request)
        await db.updateRequest(request.id, {
          status:       'sent',
          notified_at:  new Date().toISOString()
        })

        await db.clearConversationState(phone)
        await reply(tmpl.requestSent(ctx.reference))
        return
      }

      if (intent === 'CANCELAR' || textLower === 'não' || textLower === 'nao' || textLower === 'n') {
        await db.clearConversationState(phone)
        await reply(tmpl.requestCancelled())
        return
      }

      // Não entendeu — repergunta
      await reply(`Não entendi. Por favor, responda *sim* para confirmar ou *não* para cancelar.`)
      return
    }

    default: {
      await db.clearConversationState(phone)
      await reply(tmpl.greeting(client.name))
    }
  }
}

// ── Notifica contabilidade (WhatsApp + email) ─────────────────────────────────
async function notifyAccounting(request) {
  const msg = tmpl.accountingNotification(request)

  // WhatsApp para o número da contabilidade
  if (process.env.CONTABILIDADE_PHONE) {
    await wpp.sendText(process.env.CONTABILIDADE_PHONE, msg)
  }

  // Email para a contabilidade
  if (process.env.CONTABILIDADE_EMAIL) {
    await email.sendAccountingNotification(request)
  }
}

// ── Chamado pelo Drive watcher quando PDF é detectado ────────────────────────
async function onNFIssued(request, fileUrl, fileName) {
  // Envia email ao cliente com o PDF
  await email.sendNFToClient(request, fileUrl, fileName)

  // Avisa o cliente no WhatsApp
  await wpp.sendText(
    request.clients.whatsapp,
    tmpl.notaReady(request.clients.name, request.reference || request.service)
  )

  await db.logMessage({
    whatsapp:  request.clients.whatsapp,
    direction: 'out',
    body:      tmpl.notaReady(request.clients.name, request.reference),
    clientId:  request.client_id,
    requestId: request.id
  })
}

module.exports = { handleMessage, onNFIssued }
