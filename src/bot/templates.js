// Mensagens do bot — centralizadas aqui para fácil edição

function greeting(name) {
  return `Olá, *${name}*! 👋\nSou o assistente da *NDD Estudio Criativo*.\n\nComo posso te ajudar?\n\n1️⃣ Solicitar nota fiscal\n2️⃣ Ver status da minha nota\n\nResponda com o número da opção.`
}

function unknownClient() {
  return `Olá! 👋\nNão encontrei seu número em nosso cadastro.\n\nPor favor, entre em contato pelo e-mail ou fale com nossa equipe para se cadastrar.`
}

function confirmRequest(client, service, value, document, reference) {
  const valueStr = Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return (
    `📋 *Confirme sua solicitação de Nota Fiscal:*\n\n` +
    `👤 *Cliente:* ${client.name}\n` +
    `📝 *Serviço:* ${service}\n` +
    `💰 *Valor:* ${valueStr}\n` +
    `🏢 *Documento:* ${document}\n` +
    `📅 *Referência:* ${reference}\n\n` +
    `Está correto? Responda *sim* para confirmar ou *não* para cancelar.`
  )
}

function requestSent(reference) {
  return (
    `✅ *Solicitação enviada!*\n\n` +
    `Sua nota fiscal de *${reference}* foi encaminhada para a contabilidade.\n\n` +
    `Prazo estimado: *2 dias úteis*.\n` +
    `Vou te avisar aqui quando estiver pronta e enviar o PDF para o seu e-mail. 😊`
  )
}

function requestCancelled() {
  return `Tudo bem! Solicitação cancelada. Se precisar, é só chamar. 😊`
}

function notaReady(clientName, reference) {
  return (
    `🎉 *Sua nota fiscal está pronta, ${clientName}!*\n\n` +
    `A NF referente a *${reference}* foi emitida.\n` +
    `Enviamos o PDF para o seu e-mail cadastrado.\n\n` +
    `Qualquer dúvida, é só falar! 👍`
  )
}

function statusMessage(requests) {
  if (!requests || requests.length === 0) {
    return `Não encontrei nenhuma solicitação em aberto para você. 😊`
  }
  const statusLabel = {
    pending:    '⏳ Aguardando envio',
    sent:       '📤 Enviada à contabilidade',
    processing: '⚙️ Em processamento',
    issued:     '✅ Emitida',
    delivered:  '📧 Enviada ao seu e-mail',
    cancelled:  '❌ Cancelada'
  }
  let msg = `📋 *Status das suas notas fiscais:*\n\n`
  requests.forEach((r, i) => {
    const val = Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    msg += `${i + 1}. *${r.reference || r.service}* — ${val}\n`
    msg += `   ${statusLabel[r.status] || r.status}\n\n`
  })
  return msg.trim()
}

function askService(defaultService) {
  if (defaultService) {
    return (
      `Qual o serviço da nota?\n\n` +
      `Seu serviço padrão é *${defaultService}*.\n\n` +
      `Responda com o nome do serviço ou *ok* para usar o padrão.`
    )
  }
  return `Qual o serviço da nota? (ex: Gestão de Tráfego, Social Media, Consultoria)`
}

function askValue(defaultValue) {
  if (defaultValue) {
    const val = Number(defaultValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    return (
      `Qual o valor da nota?\n\n` +
      `Seu valor padrão é *${val}*.\n\n` +
      `Responda com o valor ou *ok* para usar o padrão.`
    )
  }
  return `Qual o valor da nota? (ex: 2500 ou 2.500,00)`
}

function askReference() {
  const now    = new Date()
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const suggest = `${months[now.getMonth()]}/${now.getFullYear()}`
  return `Qual o mês de referência? (ex: *${suggest}*)\n\nOu responda *ok* para usar *${suggest}*.`
}

// ── Notificação para a contabilidade ─────────────────────────────────────────
function accountingNotification(request) {
  const val  = Number(request.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const date = new Date(request.created_at).toLocaleDateString('pt-BR')
  return (
    `🔔 *Nova solicitação de Nota Fiscal — NDD Estudio Criativo*\n\n` +
    `👤 *Cliente:* ${request.clients.name}\n` +
    `📝 *Serviço:* ${request.service}\n` +
    `💰 *Valor:* ${val}\n` +
    `🏢 *CNPJ/CPF:* ${request.document}\n` +
    `📅 *Referência:* ${request.reference || '—'}\n` +
    `🗓️ *Solicitado em:* ${date}\n\n` +
    `Por favor, gere a nota e suba o PDF na pasta do Drive. ✅`
  )
}

module.exports = {
  greeting, unknownClient, confirmRequest, requestSent, requestCancelled,
  notaReady, statusMessage, askService, askValue, askReference,
  accountingNotification
}
