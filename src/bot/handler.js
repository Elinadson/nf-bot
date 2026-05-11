const db       = require('../services/supabase')
const wpp      = require('../services/whatsapp')
const email    = require('../services/email')
const tmpl     = require('./templates')
const notion   = require('../services/notion')
const { createClientFolder } = require('../services/drive')
const { sendDocumentBase64 } = require('../services/whatsapp')
const Anthropic = require('@anthropic-ai/sdk')
const { CONTRACT_MODELS, sendContract } = require('../services/autentique')
const { transcribeAudio, extractClientData, transcribeAndExtract, missingFields, formatClientSummary } = require('./register_client')
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Detecta intenção com Claude (com timeout de 8s) ───────────────────────────
async function detectIntent(text) {
  if (!text || !text.trim()) return 'OUTRO'
  try {
    const aiCall = anthropic.messages.create({
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
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
    )
    const msg = await Promise.race([aiCall, timeout])
    return msg.content[0].text.trim().toUpperCase()
  } catch (err) {
    if (err.message === 'timeout') {
      console.warn('[intent] timeout — usando fallback OUTRO')
    } else {
      console.error('[intent] erro:', err.message)
    }
    return 'OUTRO'
  }
}

// ── Roteador inteligente para admin_idle ─────────────────────────────────────
async function analyzeIntent(text) {
  if (!text || !text.trim()) return { intent: 'OUTRO', client_name: null, has_data: false }
  try {
    const aiCall = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `Você analisa mensagens de um administrador de bot de notas fiscais.
Retorne APENAS um JSON válido (sem markdown):
{
  "intent": "SOLICITAR_NF|VER_STATUS|CADASTRAR_CLIENTE|CONTRATO|HISTORICO|BUSCA_NOTION|CONFIRMAR|CANCELAR|SAUDACAO|OUTRO",
  "client_name": nome do cliente mencionado ou null,
  "has_data": true se a mensagem contém dados suficientes para cadastro (nome + pelo menos mais um campo), false caso contrário
}

Exemplos:
- "nota para João Silva" → {"intent":"SOLICITAR_NF","client_name":"João Silva","has_data":false}
- "preciso de uma nota pra Maria, gestão de tráfego, abril 2026" → {"intent":"SOLICITAR_NF","client_name":"Maria","has_data":false}
- "histórico do Pedro" → {"intent":"HISTORICO","client_name":"Pedro","has_data":false}
- "contrato para a Luana" → {"intent":"CONTRATO","client_name":"Luana","has_data":false}
- "pendentes" / "status" / "em aberto" → {"intent":"VER_STATUS","client_name":null,"has_data":false}
- "cadastra: João, 11987654321, joao@gmail.com" → {"intent":"CADASTRAR_CLIENTE","client_name":"João","has_data":true}
- "cadastrar cliente novo" → {"intent":"CADASTRAR_CLIENTE","client_name":null,"has_data":false}
- "sim" / "confirmar" → {"intent":"CONFIRMAR","client_name":null,"has_data":false}
- "quais clientes estão com briefing pendente?" → {"intent":"BUSCA_NOTION","client_name":null,"has_data":false}
- "o que tem no roadmap sobre a Luana?" → {"intent":"BUSCA_NOTION","client_name":"Luana","has_data":false}
- "notion [qualquer coisa]" / "busca no notion" / "pesquisa" → {"intent":"BUSCA_NOTION","client_name":null,"has_data":false}
- qualquer pergunta sobre tarefas, clientes, calendário, briefing, estratégia → {"intent":"BUSCA_NOTION","client_name":null,"has_data":false}`,
      messages: [{ role: 'user', content: text }]
    })
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
    )
    const msg = await Promise.race([aiCall, timeout])
    const textRaw = msg.content[0].text.trim()
    const jsonMatch = textRaw.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : textRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(raw)
  } catch (err) {
    if (err.message !== 'timeout') console.error('[intent] erro:', err.message)
    return { intent: 'OUTRO', client_name: null, has_data: false }
  }
}

// ── Busca Notion + resposta via IA ───────────────────────────────────────────
async function handleNotionQuery({ text, reply }) {
  await reply('🔍 Buscando no Notion...')
  try {
    const context = await notion.searchNotionContext(text)
    if (!context.trim()) {
      await reply('Não encontrei conteúdo relevante no Notion para essa pergunta.')
      return
    }
    const aiCall = anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `Você é um assistente interno da agência NDD. Responde perguntas sobre clientes, tarefas e operações com base no conteúdo do Notion fornecido.

Regras:
- Seja direto e objetivo
- Use bullet points (•) para listas
- Use *negrito* para nomes de clientes
- Máximo 400 palavras
- Se a informação não estiver no contexto, diga claramente
- Não invente dados`,
      messages: [{
        role: 'user',
        content: `CONTEXTO DO NOTION:\n${context}\n\nPERGUNTA: ${text}`
      }]
    })
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
    const msg = await Promise.race([aiCall, timeout])
    await reply(msg.content[0].text.trim())
  } catch (err) {
    console.error('[notion-query] erro:', err.message)
    await reply('Não consegui buscar no Notion agora. Tente novamente em instantes.')
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseValue(text) {
  const clean = text.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const val   = parseFloat(clean)
  return isNaN(val) ? null : val
}

function extractClientName(text) {
  const match = text.match(/nota\s+para\s+(.+)/i)
  return match ? match[1].trim() : null
}

function extractHistoryName(text) {
  const match = text.match(/hist[oó]rico\s+(.+)/i)
  return match ? match[1].trim() : null
}

function extractContractName(text) {
  const match = text.match(/contrato\s+para\s+(.+)/i)
  return match ? match[1].trim() : null
}

function isCancelCommand(textLower) {
  return ['0', 'cancelar', 'sair', '/cancelar', '/sair'].includes(textLower)
}

// ── Handler principal de mensagens ────────────────────────────────────────────
async function handleMessage({ from, body, audio = null }) {
  let text    = (body || '').trim()
  const phone = from.replace(/[^0-9]/g, '')

  if (!text && !audio) return

  const client = await db.getClientByPhone(phone)

  // Transcreve áudio para texto — funciona em qualquer estado do bot
  if (audio && !text) {
    if (audio.error) {
      if (client) await wpp.sendText(phone, 'Não consegui baixar o áudio. Tente por texto 📝')
      return
    }
    try {
      text = (await transcribeAudio(audio.base64, audio.mimeType)).trim()
      if (text) await wpp.sendText(phone, `🎙️ _"${text}"_`)
    } catch (err) {
      console.error('[transcription] erro:', err.message)
      if (client) await wpp.sendText(phone, 'Não consegui transcrever o áudio. Tente por texto 📝')
      return
    }
    if (!text) {
      if (client) await wpp.sendText(phone, 'Áudio não entendido. Fale mais claramente ou envie por texto 📝')
      return
    }
  }

  if (!text) return

  await db.logMessage({ whatsapp: phone, direction: 'in', body: text, clientId: client?.id })

  if (client?.is_admin) {
    return handleAdminMessage({ phone, text, admin: client })
  }

  if (!client) return  // ignora números não cadastrados

  // Clientes cadastrados recebem mensagem de atendimento manual
  const alreadyReplied = await db.getConversationState(phone)
  if (!alreadyReplied || alreadyReplied.state === 'idle') {
    await wpp.sendText(phone, `Olá! 👋 Recebemos sua mensagem e em breve nossa equipe entrará em contato. 😊`)
    await db.logMessage({ whatsapp: phone, direction: 'out', body: 'Mensagem de atendimento enviada', clientId: client.id })
    await db.setConversationState(phone, 'waiting_human', {}, client.id)
  }
  return

  const textLower = text.toLowerCase().trim()

  // ── Cancelar universal ────────────────────────────────────────────────────
  if (isCancelCommand(textLower) && conv.state !== 'idle') {
    if (conv.state === 'awaiting_confirmation') {
      await db.setConversationState(phone, 'awaiting_cancel_confirm', conv.context, client.id)
      await reply(`Tem certeza que deseja cancelar? Isso vai descartar a solicitação atual.\n\n*sim* para cancelar | *não* para voltar`)
      return
    }
    await db.clearConversationState(phone)
    await reply(`Operação cancelada. Qualquer coisa é só chamar. 👍`)
    return
  }

  switch (conv.state) {

    case 'idle': {
      const intent = await detectIntent(text)

      if (intent === 'SOLICITAR_NF' || text === '1') {
        const ctx = {
          service:  client.default_service || null,
          value:    client.default_value   || null,
          document: client.cnpj || client.cpf || null,
        }

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
        const all = await db.getAllRequests({ limit: 5 })
          .then(r => r.filter(x => x.client_id === client.id && x.status !== 'delivered'))
        await reply(tmpl.statusMessage(all))
        return
      }

      if (intent === 'SAUDACAO') {
        await reply(tmpl.greeting(client.name))
        return
      }

      await reply(tmpl.greeting(client.name))
      return
    }

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

    case 'awaiting_confirmation': {
      const intent = await detectIntent(text)

      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const ctx = conv.context

        const request = await db.createRequest({
          client_id:  client.id,
          service:    ctx.service || client.default_service || 'Serviço não especificado',
          value:      ctx.value,
          document:   ctx.document,
          reference:  ctx.reference,
          status:     'pending',
          requested_via: 'whatsapp'
        })

        await notifyAccounting(request)
        await db.updateRequest(request.id, { status: 'sent', notified_at: new Date().toISOString() })
        await db.clearConversationState(phone)
        await reply(tmpl.requestSent(ctx.reference))
        return
      }

      if (intent === 'CANCELAR' || textLower === 'não' || textLower === 'nao' || textLower === 'n') {
        await db.setConversationState(phone, 'awaiting_cancel_confirm', conv.context, client.id)
        await reply(`Tem certeza que deseja cancelar? Isso vai descartar a solicitação.\n\n*sim* para cancelar | *não* para voltar`)
        return
      }

      await reply(`Não entendi. Por favor, responda *sim* para confirmar ou *não* para cancelar.`)
      return
    }

    case 'awaiting_cancel_confirm': {
      const intent = await detectIntent(text)
      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        await db.clearConversationState(phone)
        await reply(tmpl.requestCancelled())
        return
      }
      await db.setConversationState(phone, 'awaiting_confirmation', conv.context, client.id)
      await reply(tmpl.confirmRequest(client, conv.context.service, conv.context.value, conv.context.document, conv.context.reference))
      return
    }

    default: {
      await db.clearConversationState(phone)
      await reply(tmpl.greeting(client.name))
    }
  }
}

// ── Notifica contabilidade ────────────────────────────────────────────────────
async function notifyAccounting(request) {
  const msg = tmpl.accountingNotification(request)

  if (process.env.CONTABILIDADE_PHONE) {
    await wpp.sendText(process.env.CONTABILIDADE_PHONE, msg)
  }

  if (process.env.CONTABILIDADE_EMAIL) {
    await email.sendAccountingNotification(request)
  }
}

// ── Chamado pelo Drive watcher quando PDF é detectado ────────────────────────
async function onNFIssued(request, fileUrl, fileName) {
  const client = request.clients
  let emailSent = false

  if (client.email) {
    await email.sendNFToClient(request, fileUrl, fileName)
    emailSent = true
    console.log(`[onNFIssued] Email enviado para ${client.email}`)
  } else {
    console.warn(`[onNFIssued] Cliente ${client.name} sem email — pulando envio`)
  }

  if (process.env.ADMIN_PHONE) {
    const adminMsg = tmpl.adminNFIssued(request, client, emailSent)
    await wpp.sendText(process.env.ADMIN_PHONE, adminMsg)
    await db.logMessage({
      whatsapp:  process.env.ADMIN_PHONE,
      direction: 'out',
      body:      adminMsg,
      clientId:  request.client_id,
      requestId: request.id
    })
  }

  if (client.whatsapp) {
    const msg = tmpl.notaReady(client.name, request.reference || request.service, { emailSent })
    await wpp.sendText(client.whatsapp, msg)
    await db.logMessage({
      whatsapp:  client.whatsapp,
      direction: 'out',
      body:      msg,
      clientId:  request.client_id,
      requestId: request.id
    })
  }

  return emailSent
}

// ── Fluxo admin ───────────────────────────────────────────────────────────────
async function handleAdminMessage({ phone, text, admin }) {
  const textLower = text.toLowerCase().trim()

  async function reply(msg) {
    await wpp.sendText(phone, msg)
    await db.logMessage({ whatsapp: phone, direction: 'out', body: msg, clientId: admin.id })
  }

  const conv = await db.getConversationState(phone) || { state: 'admin_idle', context: {} }

  // ── Cancelar universal ──────────────────────────────────────────────────────
  if (isCancelCommand(textLower) && conv.state !== 'admin_idle') {
    await db.setConversationState(phone, 'admin_awaiting_cancel_confirm',
      { ...conv.context, _previousState: conv.state }, admin.id)
    await reply(`⚠️ Tem certeza que deseja cancelar?\n\nResponda *sim* para cancelar ou *não* para voltar de onde parou.`)
    return
  }

  switch (conv.state) {

    // ── Idle admin ────────────────────────────────────────────────────────────
    case 'admin_idle':
    default: {
      const clientName    = extractClientName(text)
      const histName      = extractHistoryName(text)
      const contractName  = extractContractName(text)

      if (clientName)   return searchAndSelectClient({ phone, reply, clientName, admin, action: 'request' })
      if (histName)     return searchAndSelectClient({ phone, reply, clientName: histName, admin, action: 'history' })
      if (contractName) return searchAndSelectClient({ phone, reply, clientName: contractName, admin, action: 'contract' })

      if (text === '5' || textLower === 'cadastrar' || textLower === 'novo cliente' || textLower === 'cadastrar cliente') {
        await db.setConversationState(phone, 'admin_registering_client', { step: 'awaiting_info' }, admin.id)
        await reply(tmpl.registerClientStart())
        return
      }

      // ── Roteamento inteligente por IA ─────────────────────────────────────
      const intent = await analyzeIntent(text)

      if (intent.intent === 'SOLICITAR_NF' || text === '1') {
        if (intent.client_name) {
          return searchAndSelectClient({ phone, reply, clientName: intent.client_name, admin, action: 'request' })
        }
        await reply(`Para quem é a nota? Envie: *nota para [nome do cliente]*`)
        return
      }

      if (intent.intent === 'VER_STATUS' || text === '2') {
        const all     = await db.getAllRequests({ limit: 10 })
        const pending = all.filter(r => ['pending','sent','processing'].includes(r.status))
        if (!pending.length) {
          await reply(`Nenhuma solicitação em aberto no momento.`)
          return
        }
        let msg = `📋 *Solicitações em aberto:*\n\n`
        pending.forEach((r, i) => {
          const val    = Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          const status = { pending: '⏳', sent: '📤', processing: '⚙️' }[r.status] || ''
          msg += `${i+1}. ${status} *${r.clients?.name}* — ${val}\n   ${r.reference || r.service}\n\n`
        })
        await reply(msg.trim())
        return
      }

      if (intent.intent === 'HISTORICO') {
        if (intent.client_name) {
          return searchAndSelectClient({ phone, reply, clientName: intent.client_name, admin, action: 'history' })
        }
        await reply(`Histórico de qual cliente? Envie: *histórico [nome]*`)
        return
      }

      if (intent.intent === 'CONTRATO') {
        if (intent.client_name) {
          return searchAndSelectClient({ phone, reply, clientName: intent.client_name, admin, action: 'contract' })
        }
        await reply(`Para qual cliente é o contrato?\n\nEnvie: *contrato para [nome do cliente]*`)
        return
      }

      if (intent.intent === 'BUSCA_NOTION') {
        return handleNotionQuery({ text, reply })
      }

      if (intent.intent === 'CADASTRAR_CLIENTE') {
        await db.setConversationState(phone, 'admin_registering_client', { step: 'awaiting_info' }, admin.id)
        if (intent.has_data) {
          return handleAdminMessage({ phone, text, admin })
        }
        await reply(tmpl.registerClientStart())
        return
      }

      if (text === '3') {
        const all = await db.getAllRequests({ limit: 500 })
        await reply(tmpl.adminStats(all))
        return
      }

      if (text === '4') {
        await reply(`Para qual cliente é o contrato?\n\nEnvie: *contrato para [nome do cliente]*`)
        return
      }

      if (text === '6' || textLower === 'exportar' || textLower === 'exportar clientes') {
        await reply(`⏳ Gerando planilha de clientes...`)
        await exportClientsCSV(phone)
        return
      }

      await reply(tmpl.adminGreeting())
      return
    }
    // ── Selecionando cliente da lista ─────────────────────────────────────────
    case 'admin_selecting_client': {
      const clients = conv.context.clients || []
      const action  = conv.context.action  || 'request'
      const idx     = parseInt(text) - 1

      if (isNaN(idx) || idx < 0 || idx >= clients.length) {
        await reply(`Responda com o número da lista (1 a ${clients.length}).`)
        return
      }

      const selected = clients[idx]

      if (action === 'history') {
        const requests = await db.getRequestsByClientId(selected.id, { limit: 10 })
        await reply(tmpl.adminHistory(selected, requests))
        await db.clearConversationState(phone)
        return
      }

      if (action === 'contract') {
        await startContractFlow({ phone, reply, client: selected, admin })
        return
      }

      await startAdminRequestFlow({ phone, reply, client: selected, admin })
      return
    }

    // ── Admin aguardando serviço ──────────────────────────────────────────────
    case 'admin_awaiting_service': {
      const service = text.trim()
      if (!service) {
        await reply('Informe o serviço/descrição da nota.')
        return
      }
      const ctx = { ...conv.context, service, _serviceManual: true }
      if (!ctx.value) {
        await db.setConversationState(phone, 'admin_awaiting_value', ctx, admin.id)
        await reply(`Qual o valor da nota para *${ctx.client?.name}*?

Exemplo: _2500_ ou _2.500,00_`)
        return
      }
      await db.setConversationState(phone, 'admin_awaiting_confirmation', ctx, admin.id)
      await reply(tmpl.confirmRequest(ctx.client, ctx.service, ctx.value, ctx.document, ctx.reference))
      return
    }

    // ── Admin aguardando valor ────────────────────────────────────────────────
    case 'admin_awaiting_value': {
      const value = parseValue(text)
      if (!value) {
        await reply(`Não entendi o valor. Informe apenas o número.
Ex: *2500* ou *2.500,00*`)
        return
      }
      const ctx = { ...conv.context, value, _valueManual: true }
      await db.setConversationState(phone, 'admin_awaiting_confirmation', ctx, admin.id)
      await reply(tmpl.confirmRequest(ctx.client, ctx.service, ctx.value, ctx.document, ctx.reference))
      return
    }

    // ── Confirmação admin ─────────────────────────────────────────────────────
    case 'admin_awaiting_confirmation': {
      const intent = await detectIntent(text)
      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const ctx    = conv.context
        const client = ctx.client

        const request = await db.createRequest({
          client_id:     client.id,
          service:       ctx.service || client.default_service || 'Serviço não especificado',
          value:         ctx.value,
          document:      ctx.document,
          reference:     ctx.reference,
          status:        'pending',
          requested_via: 'admin'
        })

        await notifyAccounting({ ...request, clients: client })
        await db.updateRequest(request.id, { status: 'sent', notified_at: new Date().toISOString() })

        if (ctx._serviceManual || ctx._valueManual) {
          await db.setConversationState(phone, 'admin_awaiting_save_defaults', {
            client,
            service: ctx.service,
            value:   ctx.value
          }, admin.id)
          await reply(
            `✅ Solicitação criada e contabilidade notificada!\n\nCliente: *${client.name}*\nReferência: *${ctx.reference}*\n\n` +
            tmpl.askSaveDefaults(client.name, ctx.service, ctx.value)
          )
          return
        }

        await db.clearConversationState(phone)
        await reply(`✅ Solicitação criada e contabilidade notificada!\n\nCliente: *${client.name}*\nReferência: *${ctx.reference}*`)
        return
      }

      if (intent === 'CANCELAR' || textLower === 'não' || textLower === 'nao' || textLower === 'n') {
        await db.setConversationState(phone, 'admin_awaiting_cancel_confirm', conv.context, admin.id)
        await reply(`Tem certeza que deseja cancelar? Isso vai descartar a solicitação.\n\n*sim* para cancelar | *não* para voltar`)
        return
      }

      await reply(`Responda *sim* para confirmar ou *não* para cancelar.`)
      return
    }

    // ── Confirmar cancelamento ────────────────────────────────────────────────
    case 'admin_awaiting_cancel_confirm': {
      const intent = await detectIntent(text)
      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        await db.clearConversationState(phone)
        await reply(`Cancelado. Qualquer coisa é só chamar. 👍`)
        return
      }
      // Restaura o estado anterior
      const { _previousState, ...prevCtx } = conv.context
      const prevState = _previousState || 'admin_idle'
      await db.setConversationState(phone, prevState, prevCtx, admin.id)
      if (prevState === 'admin_awaiting_confirmation') {
        await reply(tmpl.confirmRequest(prevCtx.client, prevCtx.service, prevCtx.value, prevCtx.document, prevCtx.reference))
      } else if (prevState === 'admin_contract_confirm') {
        await reply(tmpl.contractConfirm(prevCtx.client, prevCtx.model, prevCtx.email, prevCtx.vars))
      } else {
        await reply(`Ok! Continuando de onde paramos. 👍`)
      }
      return
    }

    // ── Salvar padrões após criação manual ────────────────────────────────────
    case 'admin_awaiting_save_defaults': {
      const intent = await detectIntent(text)
      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const { client, service, value } = conv.context
        try {
          await db.upsertClient({ ...client, default_service: service, default_value: value })
          await db.clearConversationState(phone)
          await reply(`💾 Padrão salvo para *${client.name}*!\n\nNa próxima vez você só precisa confirmar.`)
        } catch (err) {
          console.error('[handler] upsertClient erro:', err.message)
          await db.clearConversationState(phone)
          await reply(`Não foi possível salvar o padrão, mas a solicitação foi criada com sucesso.`)
        }
        return
      }
      await db.clearConversationState(phone)
      await reply(`Ok, padrão não salvo. Qualquer coisa é só chamar.`)
      return
    }

    // ── Lembrete agendado ─────────────────────────────────────────────────────
    case 'admin_awaiting_scheduled_confirm': {
      const intent = await detectIntent(text)
      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const client = conv.context.client
        await startAdminRequestFlow({ phone, reply, client, admin, skipConfirm: false })
        return
      }
      if (intent === 'CANCELAR' || textLower === 'não' || textLower === 'nao' || textLower === 'n') {
        await db.clearConversationState(phone)
        await reply(`Ok, lembrete ignorado. Você pode solicitar manualmente quando quiser.`)
        return
      }
      await reply(`Responda *sim* para iniciar a solicitação ou *não* para ignorar.`)
      return
    }

    // ── Contrato: selecionando modelo ─────────────────────────────────────────
    case 'admin_contract_selecting_model': {
      const idx = parseInt(text) - 1
      if (isNaN(idx) || idx < 0 || idx >= CONTRACT_MODELS.length) {
        await reply(`Responda com um número de 1 a ${CONTRACT_MODELS.length}.`)
        return
      }

      const model  = CONTRACT_MODELS[idx]
      const client = conv.context.client
      const vars   = { service: client.default_service || null, value: client.default_value || null }

      if (model.type === 'freela') {
        await db.setConversationState(phone, 'admin_contract_awaiting_freelancer', { client, model, email: client.email || null, vars: {} }, admin.id)
        await reply(tmpl.contractAskFreelancer())
      } else if (model.id === 1) {
        await db.setConversationState(phone, 'admin_contract_awaiting_plataformas', { client, model, email: client.email || null, vars: { service: model.label } }, admin.id)
        await reply(tmpl.contractAskPlataformas())
      } else if (model.id === 2) {
        await db.setConversationState(phone, 'admin_contract_awaiting_plataforma', { client, model, email: client.email || null, vars: { service: model.label } }, admin.id)
        await reply(tmpl.contractAskPlataforma())
      } else {
        await db.setConversationState(phone, 'admin_contract_awaiting_service', { client, model, email: client.email || null, vars }, admin.id)
        await reply(tmpl.contractAskService(client.name, vars.service))
      }
      return
    }

    // ── Freela: nome do freelancer ───────────────────────────────────────────
    case 'admin_contract_awaiting_freelancer': {
      const { vars } = conv.context
      const freelancerName = text.trim()
      if (!freelancerName) { await reply(`Informe o nome completo do freelancer.`); return }
      const newCtx = { ...conv.context, vars: { ...vars, freelancerName } }
      await db.setConversationState(phone, 'admin_contract_awaiting_freelancer_doc', newCtx, admin.id)
      await reply(tmpl.contractAskFreelancerDoc(freelancerName))
      return
    }

    // ── Freela: CPF/CNPJ do freelancer ───────────────────────────────────────
    case 'admin_contract_awaiting_freelancer_doc': {
      const { vars } = conv.context
      let freelancerDoc = null
      if (textLower !== 'pular') {
        freelancerDoc = text.replace(/[^0-9]/g, '') || null
      }
      const newCtx = { ...conv.context, vars: { ...vars, freelancerDoc } }
      await db.setConversationState(phone, 'admin_contract_awaiting_freela_endereco', newCtx, admin.id)
      await reply(tmpl.contractAskFreelancerEndereco(vars.freelancerName))
      return
    }


    // ── Freela: endereço do freelancer ───────────────────────────────────────────
    case 'admin_contract_awaiting_freela_endereco': {
      const { client, model, vars } = conv.context
      const enderecoFreela = text.trim()
      if (!enderecoFreela) { await reply(tmpl.contractAskFreelancerEndereco(vars.freelancerName)); return }
      const newCtx = { ...conv.context, vars: { ...vars, enderecoFreela } }
      if (model.id === 4) {
        await db.setConversationState(phone, 'admin_contract_awaiting_tipo_material', newCtx, admin.id)
        await reply(tmpl.contractAskTipoMaterial())
      } else if (model.id === 5) {
        await db.setConversationState(phone, 'admin_contract_awaiting_plataforma', newCtx, admin.id)
        await reply(tmpl.contractAskPlataforma())
      } else if (model.id === 6) {
        await db.setConversationState(phone, 'admin_contract_awaiting_qtd_videos', newCtx, admin.id)
        await reply(tmpl.contractAskQtdVideos())
      } else {
        await db.setConversationState(phone, 'admin_contract_awaiting_service', newCtx, admin.id)
        await reply(tmpl.contractAskService(vars.freelancerName, null))
      }
      return
    }

    // ── Freela Designer: tipo de material ────────────────────────────────────────
    case 'admin_contract_awaiting_tipo_material': {
      const { client, vars } = conv.context
      const tipoMaterial = text.trim()
      if (!tipoMaterial) { await reply(tmpl.contractAskTipoMaterial()); return }
      const newCtx = { ...conv.context, vars: { ...vars, tipoMaterial } }
      await db.setConversationState(phone, 'admin_contract_awaiting_value', newCtx, admin.id)
      await reply(tmpl.contractAskValue(client.name, vars.value))
      return
    }

    // ── Freela Editor: quantidade de vídeos ──────────────────────────────────────
    case 'admin_contract_awaiting_qtd_videos': {
      const { client, vars } = conv.context
      const qtdVideos = text.trim()
      if (!qtdVideos) { await reply(tmpl.contractAskQtdVideos()); return }
      const newCtx = { ...conv.context, vars: { ...vars, qtdVideos } }
      await db.setConversationState(phone, 'admin_contract_awaiting_value', newCtx, admin.id)
      await reply(tmpl.contractAskValue(client.name, vars.value))
      return
    }

    // ── Freela: prazo de entrega ──────────────────────────────────────────────
    case 'admin_contract_awaiting_prazo': {
      const { client, model, vars } = conv.context
      const prazo = text.trim()
      if (!prazo) { await reply(`Informe o prazo de entrega.

Ex: _15/05/2026_ ou _30 dias_`); return }
      const newCtx = { ...conv.context, vars: { ...vars, prazo } }
      await db.setConversationState(phone, 'admin_contract_awaiting_pagamento', newCtx, admin.id)
      await reply(tmpl.contractAskPagamento())
      return
    }

    // ── Freela: forma de pagamento ────────────────────────────────────────────
    case 'admin_contract_awaiting_pagamento': {
      const { client, model, vars } = conv.context
      const pagamento = text.trim()
      if (!pagamento) { await reply(`Informe a forma de pagamento.

Ex: _PIX, 50% entrada + 50% entrega_`); return }
      const newVars = { ...vars, pagamento }
      const email   = conv.context.email || client.email
      if (!email) {
        await db.setConversationState(phone, 'admin_contract_awaiting_email', { ...conv.context, vars: newVars }, admin.id)
        await reply(`*${client.name}* não tem e-mail cadastrado.

Informe o e-mail para enviar o contrato:`)
        return
      }
      await db.setConversationState(phone, 'admin_contract_confirm', { ...conv.context, email, vars: newVars }, admin.id)
      await reply(tmpl.contractConfirm(client, model, email, newVars))
      return
    }

    // ── Contrato: coletando serviço ──────────────────────────────────────────
    // ── Redes Sociais: plataformas ──────────────────────────────────────────────
    case 'admin_contract_awaiting_plataformas': {
      const { vars } = conv.context
      const plataformas = text.trim()
      if (!plataformas) { await reply(tmpl.contractAskPlataformas()); return }
      const newCtx = { ...conv.context, vars: { ...vars, plataformas } }
      await db.setConversationState(phone, 'admin_contract_awaiting_qtd_posts', newCtx, admin.id)
      await reply(tmpl.contractAskQtdPosts())
      return
    }

    // ── Redes Sociais: quantidade de posts ──────────────────────────────────────
    case 'admin_contract_awaiting_qtd_posts': {
      const { client, vars } = conv.context
      const qtdPosts = text.trim()
      if (!qtdPosts) { await reply(tmpl.contractAskQtdPosts()); return }
      const newCtx = { ...conv.context, vars: { ...vars, qtdPosts } }
      await db.setConversationState(phone, 'admin_contract_awaiting_value', newCtx, admin.id)
      await reply(tmpl.contractAskValue(client.name, vars.value))
      return
    }

    // ── Tráfego: plataforma ──────────────────────────────────────────────────────
    case 'admin_contract_awaiting_plataforma': {
      const { client, vars } = conv.context
      const plataforma = text.trim()
      if (!plataforma) { await reply(tmpl.contractAskPlataforma()); return }
      const newCtx = { ...conv.context, vars: { ...vars, plataforma } }
      await db.setConversationState(phone, 'admin_contract_awaiting_value', newCtx, admin.id)
      await reply(tmpl.contractAskValue(client.name, vars.value))
      return
    }

    // ── Contrato: dia de vencimento ──────────────────────────────────────────────
    case 'admin_contract_awaiting_vencimento': {
      const { client, vars } = conv.context
      const n = parseInt(text.replace(/\D/g, ''))
      if (isNaN(n) || n < 1 || n > 31) { await reply(tmpl.contractAskVencimento()); return }
      const newCtx = { ...conv.context, vars: { ...vars, vencimento: String(n) } }
      await db.setConversationState(phone, 'admin_contract_awaiting_endereco', newCtx, admin.id)
      await reply(tmpl.contractAskEndereco(client.name))
      return
    }

    // ── Contrato: endereço do cliente ────────────────────────────────────────────
    case 'admin_contract_awaiting_endereco': {
      const { client, vars } = conv.context
      const endereco = text.trim()
      if (!endereco) { await reply(tmpl.contractAskEndereco(client.name)); return }
      const newCtx = { ...conv.context, vars: { ...vars, endereco } }
      const today = new Date().toLocaleDateString('pt-BR')
      await db.setConversationState(phone, 'admin_contract_awaiting_start', newCtx, admin.id)
      await reply(tmpl.contractAskStart(client.name, today))
      return
    }

    case 'admin_contract_awaiting_service': {
      const { client, vars } = conv.context
      let service
      if (textLower === 'ok' && vars.service) {
        service = vars.service
      } else {
        service = text.trim()
        if (!service) { await reply(`Informe a descrição do serviço.`); return }
      }
      const newCtx = { ...conv.context, vars: { ...vars, service } }
      await db.setConversationState(phone, 'admin_contract_awaiting_value', newCtx, admin.id)
      await reply(tmpl.contractAskValue(client.name, vars.value))
      return
    }

    // ── Contrato: coletando valor ─────────────────────────────────────────────
    case 'admin_contract_awaiting_value': {
      const { client, model, vars } = conv.context
      let value
      if (textLower === 'ok' && vars.value) {
        value = vars.value
      } else {
        value = parseValue(text)
        if (!value) { await reply(`Valor inválido.\n\nEx: _2500_ ou _2.500,00_`); return }
      }
      const newCtx = { ...conv.context, vars: { ...vars, value } }
      if (model.type === 'freela') {
        await db.setConversationState(phone, 'admin_contract_awaiting_prazo', newCtx, admin.id)
        await reply(tmpl.contractAskPrazo())
      } else if (model.id === 1 || model.id === 2) {
        await db.setConversationState(phone, 'admin_contract_awaiting_vencimento', newCtx, admin.id)
        await reply(tmpl.contractAskVencimento())
      } else {
        const today = new Date().toLocaleDateString('pt-BR')
        await db.setConversationState(phone, 'admin_contract_awaiting_start', newCtx, admin.id)
        await reply(tmpl.contractAskStart(client.name, today))
      }
      return
    }

    // ── Contrato: coletando data de início ────────────────────────────────────
    case 'admin_contract_awaiting_start': {
      const { client, vars } = conv.context
      const dataInicio = (textLower === 'ok')
        ? new Date().toLocaleDateString('pt-BR')
        : text.trim()
      const newCtx = { ...conv.context, vars: { ...vars, dataInicio } }
      await db.setConversationState(phone, 'admin_contract_awaiting_duration', newCtx, admin.id)
      await reply(tmpl.contractAskDuration())
      return
    }

    // ── Contrato: coletando vigência ──────────────────────────────────────────
    case 'admin_contract_awaiting_duration': {
      const { client, model, vars } = conv.context
      let vigencia
      if (textLower === 'ok') {
        vigencia = '12'
      } else {
        const n = parseInt(text)
        if (isNaN(n) || n < 1) { await reply(`Informe o número de meses.\n\nEx: _12_`); return }
        vigencia = String(n)
      }
      const newVars = { ...vars, vigencia }
      const email   = conv.context.email || client.email

      if (!email) {
        await db.setConversationState(phone, 'admin_contract_awaiting_email', { ...conv.context, vars: newVars }, admin.id)
        await reply(`*${client.name}* não tem e-mail cadastrado.\n\nInforme o e-mail do cliente para enviar o contrato:`)
        return
      }

      const ctx = { client, model, email, vars: newVars }
      await db.setConversationState(phone, 'admin_contract_confirm', ctx, admin.id)
      await reply(tmpl.contractConfirm(client, model, email, newVars))
      return
    }

    // ── Contrato: aguardando e-mail do cliente ────────────────────────────────
    case 'admin_contract_awaiting_email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(text.trim())) {
        await reply(`E-mail inválido. Informe um e-mail válido.\n\nEx: cliente@email.com`)
        return
      }
      const { client, model, vars } = conv.context
      const ctx = { client, model, email: text.trim().toLowerCase(), vars: vars || {} }
      await db.setConversationState(phone, 'admin_contract_confirm', ctx, admin.id)
      await reply(tmpl.contractConfirm(client, model, ctx.email, ctx.vars))
      return
    }

    // ── Contrato: confirmação final ───────────────────────────────────────────
    case 'admin_contract_confirm': {
      const intent = await detectIntent(text)

      if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
        const { client, model, email, vars } = conv.context

        await reply(`⏳ Enviando contrato para *${client.name}*...`)

        try {
          const now      = new Date()
          const v        = vars || {}
          const baseVars = {
            NOME_EMPRESA:    process.env.STUDIO_NAME || 'Nadson Dias Comercial',
            CIDADE:          process.env.CIDADE || 'São Paulo',
            DATA_ASSINATURA: now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
          }
          let fullVars
          if (model.type === 'freela') {
            fullVars = {
              ...baseVars,
              NOME_FREELA:      v.freelancerName || '—',
              DOC_FREELA:       v.freelancerDoc  || '—',
              ENDERECO_FREELA:  v.enderecoFreela || '—',
              EMAIL_FREELA:     email,
              SERVICO:          v.service || v.tipoMaterial || '—',
              PLATAFORMA:       v.plataforma || '—',
              TIPO_MATERIAL:    v.tipoMaterial  || '—',
              QTD_VIDEOS:       v.qtdVideos     || '—',
              VALOR:            Number(v.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
              PRAZO_ENTREGA:    v.prazo    || '—',
              FORMA_PAGAMENTO:  v.pagamento || '—',
              // compatibilidade com campos genéricos
              NOME_CLIENTE:     v.freelancerName || '—',
              DOCUMENTO:        v.freelancerDoc  || '—',
              EMAIL:            email
            }
          } else {
            fullVars = {
              ...baseVars,
              NOME_CLIENTE:  client.name,
              DOCUMENTO:     client.cnpj || client.cpf || '—',
              ENDERECO:      v.endereco  || '—',
              EMAIL:         email,
              SERVICO:       v.service   || client.default_service || '—',
              PLATAFORMA:    v.plataforma || v.plataformas || '—',
              PLATAFORMAS:   v.plataformas || '—',
              QTD_POSTS:     v.qtdPosts  || '—',
              VALOR:         Number(v.value || client.default_value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
              VENCIMENTO:    v.vencimento ? `dia ${v.vencimento}` : '—',
              DATA_INICIO:   v.dataInicio || now.toLocaleDateString('pt-BR'),
              VIGENCIA:      String(v.vigencia || '12')
            }
          }
          const docTitle = `Contrato ${model.label} — ${client.name}`
          const doc      = await sendContract({
            clientName:    client.name,
            clientEmail:   email,
            modelFile:     model.file,
            documentTitle: docTitle,
            vars:          fullVars
          })

          const clientSig = doc.signatures.find(s => s.email.toLowerCase() === email.toLowerCase())
          const studioSig = doc.signatures.find(s => s.email.toLowerCase() === (process.env.STUDIO_EMAIL || '').toLowerCase())

          await db.createContract({
            client_id:    client.id,
            autentique_id: doc.id,
            model:        model.label,
            status:       'pending',
            client_link:  clientSig?.link?.short_link || null,
            studio_link:  studioSig?.link?.short_link || null
          })

          await db.clearConversationState(phone)
          await reply(tmpl.contractSent(client.name, model.label, clientSig?.link?.short_link))

        } catch (err) {
          console.error('[contract] erro ao enviar:', err.message)
          await reply(`❌ Erro ao enviar contrato: ${err.message}\n\nResponda *sim* para tentar novamente ou *não* para cancelar.`)
        }
        return
      }

      if (intent === 'CANCELAR' || textLower === 'não' || textLower === 'nao' || textLower === 'n') {
        await db.clearConversationState(phone)
        await reply(`Envio cancelado. Qualquer coisa é só chamar. 👍`)
        return
      }

      await reply(tmpl.contractConfirm(conv.context.client, conv.context.model, conv.context.email, conv.context.vars))
      return
    }

    // ── Criação de novo cliente ─────────────────────────────────────────────
    case 'admin_creating_client': {
      const ctx  = conv.context
      const step = ctx.step

      if (step === 'confirm_create') {
        const intent = await detectIntent(text)
        if (intent === 'CONFIRMAR' || textLower === 'sim' || textLower === 's') {
          await db.setConversationState(phone, 'admin_creating_client', { ...ctx, step: 'awaiting_phone' }, admin.id)
          await reply(`📱 Qual o número de WhatsApp de *${ctx.name}*?\n\nSó números com DDD. Ex: _11987654321_`)
          return
        }
        await db.clearConversationState(phone)
        await reply(`Ok. Qualquer coisa é só chamar. 👍`)
        return
      }

      if (step === 'awaiting_phone') {
        const whatsapp = text.replace(/[^0-9]/g, '')
        if (whatsapp.length < 10) {
          await reply(`Número inválido. Informe o WhatsApp com DDD.\n\nEx: _11987654321_`)
          return
        }
        await db.setConversationState(phone, 'admin_creating_client', { ...ctx, whatsapp, step: 'awaiting_email' }, admin.id)
        await reply(`📧 Qual o e-mail de *${ctx.name}*?`)
        return
      }

      if (step === 'awaiting_email') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(text.trim())) {
          await reply(`E-mail inválido. Informe um e-mail válido.\n\nEx: _cliente@email.com_`)
          return
        }
        await db.setConversationState(phone, 'admin_creating_client', { ...ctx, email: text.trim().toLowerCase(), step: 'awaiting_document' }, admin.id)
        await reply(`🏢 Qual o CNPJ ou CPF de *${ctx.name}*?\n\nOu responda *pular* para deixar em branco.`)
        return
      }

      if (step === 'awaiting_document') {
        let cnpj = null, cpf = null
        if (textLower !== 'pular') {
          const doc = text.replace(/[^0-9]/g, '')
          if (doc.length > 11)     cnpj = doc
          else if (doc.length > 0) cpf  = doc
        }
        try {
          const newClient = await db.upsertClient({
            name:     ctx.name,
            whatsapp: ctx.whatsapp,
            email:    ctx.email,
            cnpj,
            cpf,
            active:   true
          })
          const [notionResult, driveFolder] = await Promise.all([
            notion.registerClientOnNotion(newClient),
            createClientFolder(newClient.name),
          ])
          await reply(buildRegistrationSummary(newClient, notionResult?.url, driveFolder?.webViewLink))
          if (ctx.action === 'contract') {
            await startContractFlow({ phone, reply, client: newClient, admin })
          } else {
            await startAdminRequestFlow({ phone, reply, client: newClient, admin })
          }
        } catch (err) {
          console.error('[handler] criar cliente erro:', err.message)
          await db.clearConversationState(phone)
          await reply(`❌ Erro ao cadastrar cliente: ${err.message}`)
        }
        return
      }

      await db.clearConversationState(phone)
      await reply(tmpl.adminGreeting())
      return
    }

    // ── Cadastro inteligente de cliente ──────────────────────────────────────
    case 'admin_registering_client': {
      const ctx  = conv.context
      const step = ctx.step || 'awaiting_info'

      // Mescla dados extraídos com contexto atual, priorizando valores não-nulos
      const mergeData = (base, extracted) => {
        const merged = { ...base }
        for (const [k, v] of Object.entries(extracted || {})) {
          if (k !== 'step' && v !== null && v !== undefined && v !== '') merged[k] = v
        }
        return merged
      }

      // Avança para o próximo campo faltante ou para confirmação
      const advance = async (data) => {
        const missing = missingFields(data)
        if (missing.includes('name')) {
          await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'awaiting_name' }, admin.id)
          await reply('\u270f\ufe0f Qual o nome completo do cliente?')
        } else if (missing.includes('whatsapp')) {
          await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'awaiting_whatsapp' }, admin.id)
          await reply(tmpl.registerClientAskWhatsapp(data.name))
        } else if (missing.includes('email')) {
          await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'awaiting_email' }, admin.id)
          await reply(tmpl.registerClientAskEmail(data.name))
        } else if (missing.includes('document')) {
          await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'awaiting_document' }, admin.id)
          await reply(tmpl.registerClientAskDocument(data.name))
        } else {
          await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'confirm' }, admin.id)
          await reply(tmpl.registerClientConfirm(formatClientSummary(data)))
        }
      }

      if (step === 'awaiting_info') {
        await reply('🔍 Analisando as informa\u00e7\u00f5es...')
        const extracted = await extractClientData(text)
        // Mescla com ctx para preservar dados já coletados (fluxo de correção)
        const data    = mergeData(ctx, extracted)
        const missing = missingFields(data)
        const summary = formatClientSummary(data)
        await reply(tmpl.registerClientExtracted(summary, missing))
        await advance(data)
        return
      }

      if (step === 'awaiting_name') {
        const extracted = await extractClientData(text)
        const name = extracted.name || text.trim()
        if (!name) {
          await reply('\u270f\ufe0f Por favor, informe o nome completo do cliente.')
          return
        }
        const data = mergeData(ctx, extracted)
        data.name = name
        await advance(data)
        return
      }

      if (step === 'awaiting_whatsapp') {
        const extracted = await extractClientData(text)
        const rawDigits = (extracted.whatsapp || text).replace(/[^0-9]/g, '')
        if (rawDigits.length < 10) {
          await reply('N\u00famero inv\u00e1lido. Informe o WhatsApp com DDD.\n\nEx: _11987654321_')
          return
        }
        const data = mergeData(ctx, extracted)
        data.whatsapp = rawDigits
        await advance(data)
        return
      }

      if (step === 'awaiting_email') {
        if (textLower === 'pular') {
          await advance({ ...ctx, email: null })
          return
        }
        const extracted  = await extractClientData(text)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const email      = extracted.email && emailRegex.test(extracted.email) ? extracted.email : null
        if (!email) {
          await reply('E-mail inv\u00e1lido. Informe um e-mail v\u00e1lido ou envie *pular*.')
          return
        }
        const data = mergeData(ctx, extracted)
        data.email = email
        await advance(data)
        return
      }

      if (step === 'awaiting_document') {
        if (textLower === 'pular') {
          await advance({ ...ctx, cnpj: null, cpf: null })
          return
        }
        const extracted = await extractClientData(text)
        const docStr    = extracted.cnpj || extracted.cpf || text
        const rawDigits = String(docStr).replace(/[^0-9]/g, '')
        let cnpj = null, cpf = null
        if (rawDigits.length === 14)      cnpj = rawDigits
        else if (rawDigits.length === 11) cpf  = rawDigits
        else {
          await reply('Documento inv\u00e1lido. Informe CNPJ (14 d\u00edgitos) ou CPF (11 d\u00edgitos), ou envie *pular*.')
          return
        }
        const data = mergeData(ctx, extracted)
        data.cnpj = cnpj
        data.cpf  = cpf
        await advance(data)
        return
      }

      if (step === 'confirm') {
        const intent = await detectIntent(text)

        // Correção de dados: 'corrigir', 'mudar', 'alterar'
        const isCorrection = /\b(corrigir?|mudar?|alterar?|trocar?|atualizar?)\b/i.test(text)
        if (isCorrection) {
          // Tenta extrair dado corrigido inline (ex: 'corrigir email: novo@email.com')
          const extracted = await extractClientData(text)
          const hasNewData = Object.entries(extracted)
            .filter(([k]) => k !== 'step')
            .some(([, v]) => v !== null && v !== undefined && v !== '')

          if (hasNewData) {
            const data = mergeData(ctx, extracted)
            await db.setConversationState(phone, 'admin_registering_client', { ...data, step: 'confirm' }, admin.id)
            await reply(tmpl.registerClientConfirm(formatClientSummary(data)))
            return
          }

          // Identifica o campo pelo nome mencionado e volta ao passo correto
          const fieldMap = [
            [/\b(nome|raz.o\s*social)\b/i,              'awaiting_name',     'o nome'],
            [/\b(whatsapp|zap|celular|fone|telefone)\b/i, 'awaiting_whatsapp', 'o WhatsApp'],
            [/\b(e?-?mail)\b/i,                           'awaiting_email',    'o e-mail'],
            [/\b(cnpj|cpf|documento|doc)\b/i,             'awaiting_document', 'o CNPJ/CPF'],
          ]
          for (const [regex, targetStep, label] of fieldMap) {
            if (regex.test(text)) {
              await db.setConversationState(phone, 'admin_registering_client', { ...ctx, step: targetStep }, admin.id)
              await reply(`✏️ Qual é ${label} correto?`)
              return
            }
          }

          // Campo não identificado — abre para correção livre
          await db.setConversationState(phone, 'admin_registering_client', { ...ctx, step: 'awaiting_info' }, admin.id)
          await reply(
            '✏️ O que você quer corrigir? Mande o dado atualizado.\n\n'
            + 'Exemplos:\n_email: novo@email.com_\n_serviço: Marketing Digital_\n_valor: 2000_'
          )
          return
        }

        if (intent !== 'CONFIRMAR' && textLower !== 'sim' && textLower !== 's') {
          if (intent === 'CANCELAR' || textLower === 'n\u00e3o' || textLower === 'nao' || textLower === 'n') {
            await db.clearConversationState(phone)
            await reply('Cadastro cancelado. Qualquer coisa \u00e9 s\u00f3 chamar. 👍')
          } else {
            await reply('Responda *sim* para confirmar, *corrigir* para alterar algo ou *n\u00e3o* para cancelar.')
          }
          return
        }
        try {
          const newClient = await db.upsertClient({
            name:            ctx.name,
            whatsapp:        ctx.whatsapp,
            email:           ctx.email           || null,
            cnpj:            ctx.cnpj            || null,
            cpf:             ctx.cpf             || null,
            company:         ctx.company         || null,
            default_service: ctx.default_service || null,
            default_value:   ctx.default_value   || null,
            billing_day:     ctx.billing_day      || null,
            payment_method:  ctx.payment_method   || null,
            active:          true,
          })
          const [notionResult, driveFolder] = await Promise.all([
            notion.registerClientOnNotion(newClient),
            createClientFolder(newClient.name),
          ])
          await db.clearConversationState(phone)
          await reply(buildRegistrationSummary(newClient, notionResult?.url, driveFolder?.webViewLink))
        } catch (err) {
          console.error('[register_client] erro:', err.message)
          // WhatsApp duplicado: não perde os dados, pede para corrigir o número
          if (err.message.includes('duplicate key') && err.message.includes('whatsapp')) {
            await db.setConversationState(phone, 'admin_registering_client', { ...ctx, step: 'awaiting_whatsapp' }, admin.id)
            await reply(
              `⚠️ O WhatsApp *${ctx.whatsapp}* já está cadastrado para outro cliente.\n\n`
              + 'Informe um número diferente ou envie *cancelar* para sair.'
            )
          } else {
            await db.clearConversationState(phone)
            await reply(`❌ Erro ao cadastrar: ${err.message}`)
          }
        }
        return
      }

      await db.clearConversationState(phone)
      await reply(tmpl.adminGreeting())
      return
    }
  }
}

// ── Busca clientes e redireciona para ação correta ────────────────────────────
async function searchAndSelectClient({ phone, reply, clientName, admin, action = 'request' }) {
  const clients = await db.searchClientsByName(clientName)

  if (!clients.length) {
    if (action === 'contract' || action === 'request') {
      await db.setConversationState(phone, 'admin_creating_client', { name: clientName, action, step: 'confirm_create' }, admin.id)
      await reply(tmpl.adminClientNotFoundCreate(clientName))
      return
    }
    await reply(tmpl.adminClientNotFound(clientName))
    return
  }

  if (clients.length === 1) {
    if (action === 'history') {
      const requests = await db.getRequestsByClientId(clients[0].id, { limit: 10 })
      await reply(tmpl.adminHistory(clients[0], requests))
      return
    }
    if (action === 'contract') {
      await startContractFlow({ phone, reply, client: clients[0], admin })
      return
    }
    await startAdminRequestFlow({ phone, reply, client: clients[0], admin })
    return
  }

  await db.setConversationState(phone, 'admin_selecting_client', { clients, action }, admin.id)
  await reply(tmpl.adminClientList(clients))
}

// ── Inicia fluxo de solicitação de NF ────────────────────────────────────────
async function startAdminRequestFlow({ phone, reply, client, admin, skipConfirm = false }) {
  const now    = new Date()
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const ctx = {
    client,
    service:   client.default_service || null,
    value:     client.default_value   || null,
    document:  client.cnpj || client.cpf || '—',
    reference: `${months[now.getMonth()]}/${now.getFullYear()}`
  }

  if (!ctx.service) {
    await db.setConversationState(phone, 'admin_awaiting_service', ctx, admin.id)
    await reply(`Para *${client.name}*, qual é o serviço/descrição da nota?

Exemplo: _Assessoria contábil_`)
    return
  }

  if (!ctx.value) {
    await db.setConversationState(phone, 'admin_awaiting_value', ctx, admin.id)
    await reply(`Qual o valor da nota para *${client.name}*?

Exemplo: _2500_ ou _2.500,00_`)
    return
  }

  await db.setConversationState(phone, 'admin_awaiting_confirmation', ctx, admin.id)
  await reply(tmpl.confirmRequest(client, ctx.service, ctx.value, ctx.document, ctx.reference))
}

// ── Inicia fluxo de envio de contrato ────────────────────────────────────────
async function startContractFlow({ phone, reply, client, admin }) {
  await db.setConversationState(phone, 'admin_contract_selecting_model', { client }, admin.id)
  await reply(tmpl.contractModelList())
}

// ── Lembrete agendado ─────────────────────────────────────────────────────────
async function sendScheduledReminder(client) {
  const adminPhone = process.env.ADMIN_PHONE
  if (!adminPhone) {
    console.warn('[scheduler] ADMIN_PHONE não configurado')
    return
  }

  await wpp.sendText(adminPhone, tmpl.scheduledReminder(client))
  await db.setConversationState(adminPhone, 'admin_awaiting_scheduled_confirm', { client }, null)
  await db.logMessage({ whatsapp: adminPhone, direction: 'out', body: tmpl.scheduledReminder(client), clientId: client.id })

  console.log(`[scheduler] Lembrete enviado para admin — cliente: ${client.name}`)
}

// ── Lembrete em lote ──────────────────────────────────────────────────────────
async function sendBatchReminder(clients) {
  const adminPhone = process.env.ADMIN_PHONE
  if (!adminPhone) return

  const msg = tmpl.batchReminder(clients)
  await wpp.sendText(adminPhone, msg)
  await db.setConversationState(adminPhone, 'admin_selecting_client', { clients, action: 'request' }, null)
  await db.logMessage({ whatsapp: adminPhone, direction: 'out', body: msg })

  console.log(`[scheduler] Lembrete em lote enviado — ${clients.length} clientes`)
}

// ── Exporta lista de clientes como CSV ───────────────────────────────────────
async function exportClientsCSV(phone) {
  try {
    const clients = await db.getAllClients()

    const header = [
      'Nome', 'WhatsApp', 'Email', 'CNPJ', 'CPF', 'Razão Social',
      'Serviço', 'Valor Mensal', 'Dia Vencimento', 'Forma Pagamento', 'Precisa NF', 'Ativo'
    ]

    const rows = clients.map(c => [
      c.name            || '',
      c.whatsapp        || '',
      c.email           || '',
      c.cnpj            || '',
      c.cpf             || '',
      c.company         || '',
      c.default_service || '',
      c.default_value   || '',
      c.billing_day     || '',
      c.payment_method  || '',
      c.needs_nf        ? 'Sim' : 'Não',
      c.active          ? 'Sim' : 'Não',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`))

    const csv = [header.join(';'), ...rows.map(r => r.join(';'))].join('\n')
    const base64 = Buffer.from('﻿' + csv, 'utf-8').toString('base64')

    const now      = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')
    const fileName = `clientes_${now}.csv`

    await sendDocumentBase64(
      phone,
      base64,
      'text/csv',
      fileName,
      `📋 *${clients.length} clientes* exportados em ${now}`
    )
  } catch (err) {
    console.error('[exportar] erro:', err.message)
    await wpp.sendText(phone, `❌ Erro ao gerar planilha: ${err.message}`)
  }
}

// ── Resumo de cadastro com links ──────────────────────────────────────────────
function buildRegistrationSummary(client, notionUrl, driveUrl) {
  const val = client.default_value
    ? Number(client.default_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null

  const lines = [
    `✅ *${client.name}* cadastrado com sucesso!\n`,
    `👤 *Dados do cliente:*`,
    `📱 WhatsApp: ${client.whatsapp || '—'}`,
    client.email             && `📧 Email: ${client.email}`,
    (client.cnpj || client.cpf) && `📄 Documento: ${client.cnpj || client.cpf}`,
    client.company           && `🏢 Empresa: ${client.company}`,
    client.default_service   && `🛠️ Serviço: ${client.default_service}`,
    val                      && `💰 Valor: ${val}`,
    client.billing_day       && `📅 Vencimento: dia ${client.billing_day}`,
    client.payment_method    && `💳 Pagamento: ${client.payment_method}`,
  ].filter(Boolean)

  if (notionUrl || driveUrl) {
    lines.push(`\n🔗 *Links de acesso:*`)
    if (notionUrl) lines.push(`📓 Notion: ${notionUrl}`)
    if (driveUrl)  lines.push(`📁 Drive: ${driveUrl}`)
  }

  return lines.join('\n')
}

module.exports = { handleMessage, onNFIssued, sendScheduledReminder, sendBatchReminder }
