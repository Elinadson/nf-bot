// Mensagens do bot — centralizadas aqui para fácil edição

function greeting(name) {
  return `Olá, *${name}*! 👋\nSou o assistente da *Nadson Dias Comercial*.\n\nComo posso te ajudar?\n\n1️⃣ Solicitar nota fiscal\n2️⃣ Ver status da minha nota\n\nResponda com o número da opção.`
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

function accountingNotification(request) {
  const val  = Number(request.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const date = new Date(request.created_at).toLocaleDateString('pt-BR')
  return (
    `🔔 *Nova solicitação de Nota Fiscal — Nadson Dias Comercial*\n\n` +
    `👤 *Cliente:* ${request.clients.name}\n` +
    `📝 *Serviço:* ${request.service}\n` +
    `💰 *Valor:* ${val}\n` +
    `🏢 *CNPJ/CPF:* ${request.document}\n` +
    `📅 *Referência:* ${request.reference || '—'}\n` +
    `🗓️ *Solicitado em:* ${date}\n\n` +
    `Por favor, gere a nota e suba o PDF na pasta do Drive. ✅`
  )
}

function adminNFIssued(request, client) {
  const val = Number(request.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return (
    `✅ *NF emitida — ${client.name}*\n\n` +
    `📝 ${request.service}\n` +
    `💰 ${val}\n` +
    `📅 ${request.reference || '—'}\n\n` +
    `PDF enviado ao cliente por e-mail.`
  )
}

function adminGreeting() {
  return (
    `👋 *Painel Admin — Nadson Dias Comercial*\n\n` +
    `O que deseja fazer?\n\n` +
    `1️⃣ Solicitar nota para um cliente\n` +
    `2️⃣ Ver solicitações em aberto\n` +
    `3️⃣ Status geral\n` +
    `4️⃣ Enviar contrato\n` +
    `5️⃣ Cadastrar novo cliente\n` +
    `6️⃣ Exportar lista de clientes\n\n` +
    `Ou envie diretamente:\n` +
    `• *nota para [nome]* — solicitar NF\n` +
    `• *contrato para [nome]* — enviar contrato\n` +
    `• *histórico [nome]* — ver histórico`
  )
}

function adminClientList(clients) {
  let msg = `🔍 *Clientes encontrados:*\n\n`
  clients.forEach((c, i) => {
    const val = c.default_value
      ? Number(c.default_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—'
    msg += `${i + 1}. *${c.name}*\n`
    msg += `   ${c.default_service || '—'} — ${val}\n\n`
  })
  msg += `Responda com o *número* do cliente desejado.`
  return msg
}

function adminClientNotFound(name) {
  return `❌ Nenhum cliente encontrado com o nome *"${name}"*.\n\nVerifique o nome e tente novamente.`
}

function scheduledReminder(client) {
  const val = client.default_value
    ? Number(client.default_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—'
  return (
    `🗓️ *Lembrete de Nota Fiscal*\n\n` +
    `Hoje é o dia programado para solicitar a nota de:\n\n` +
    `👤 *${client.name}*\n` +
    `📝 ${client.default_service || '—'}\n` +
    `💰 ${val}\n\n` +
    `Confirma o envio da solicitação para a contabilidade? (sim/não)`
  )
}

function batchReminder(clients) {
  let msg = `🗓️ *Lembretes de Nota Fiscal — Hoje*\n\n`
  msg += `Os seguintes clientes têm nota agendada:\n\n`
  clients.forEach((c, i) => {
    const val = c.default_value
      ? Number(c.default_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '—'
    msg += `${i + 1}. *${c.name}* — ${val}\n`
  })
  msg += `\nResponda com o *número* do cliente para iniciar a solicitação.`
  return msg
}

function askSaveDefaults(clientName, service, value) {
  const val = Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return (
    `💾 Deseja salvar como padrão para *${clientName}*?\n\n` +
    `📝 Serviço: *${service}*\n` +
    `💰 Valor: *${val}*\n\n` +
    `Responda *sim* para salvar ou *não* para continuar sem salvar.`
  )
}

function adminHistory(client, requests) {
  if (!requests.length) {
    return `📋 *${client.name}* não tem solicitações registradas.`
  }
  const statusIcon = {
    pending: '⏳', sent: '📤', processing: '⚙️',
    issued: '✅', delivered: '📧', cancelled: '❌'
  }
  let msg = `📋 *Histórico — ${client.name}*\n\n`
  requests.forEach((r, i) => {
    const val  = Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const date = new Date(r.created_at).toLocaleDateString('pt-BR')
    const icon = statusIcon[r.status] || '•'
    msg += `${i + 1}. ${icon} *${r.reference || r.service}* — ${val}\n`
    msg += `   ${date}\n\n`
  })
  return msg.trim()
}

function adminStats(requests) {
  const now    = new Date()
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
  const mesAtual = `${months[now.getMonth()]}/${now.getFullYear()}`

  const doMes  = requests.filter(r => (r.reference || '').includes(months[now.getMonth()]))
  const count  = (arr, status) => arr.filter(r => r.status === status).length
  const fmt    = (n) => n.toString().padStart(2, ' ')
  const abertas = requests.filter(r => !['delivered','cancelled'].includes(r.status))

  let msg = `📊 *Status — ${mesAtual}*\n\n`
  msg += `📅 *Este mês*\n`
  msg += `⏳ Pendentes:   ${fmt(count(doMes, 'pending'))}\n`
  msg += `📤 Enviadas:    ${fmt(count(doMes, 'sent'))}\n`
  msg += `⚙️ Processando: ${fmt(count(doMes, 'processing'))}\n`
  msg += `✅ Emitidas:    ${fmt(count(doMes, 'issued'))}\n`
  msg += `📧 Entregues:   ${fmt(count(doMes, 'delivered'))}\n`

  if (abertas.length) {
    msg += `\n📋 *Em aberto (${abertas.length}):*\n`
    abertas.slice(0, 5).forEach(r => {
      const val  = Number(r.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      const icon = { pending: '⏳', sent: '📤', processing: '⚙️', issued: '✅' }[r.status] || '•'
      msg += `${icon} *${r.clients?.name || '—'}* — ${val}\n`
    })
    if (abertas.length > 5) msg += `...e mais ${abertas.length - 5}\n`
  } else {
    msg += `\n✅ Nenhuma solicitação em aberto.`
  }

  return msg.trim()
}

// ── Contrato: lista de modelos disponíveis ────────────────────────────────────
function contractModelList() {
  return (
    `📄 *Qual modelo de contrato deseja enviar?*\n\n` +
    `1️⃣ Gestão de Redes Sociais\n` +
    `2️⃣ Gestão de Tráfego\n` +
    `3️⃣ Landing Page\n` +
    `4️⃣ Freela Designer\n` +
    `5️⃣ Freela Gestão de Tráfego\n` +
    `6️⃣ Freela Editor de Vídeo\n` +
    `7️⃣ Freela Outro\n\n` +
    `Responda com o *número* do modelo.`
  )
}

// ── Contrato: tela de confirmação antes de enviar ─────────────────────────────
function contractConfirm(client, model, email, vars) {
  const v = vars || {}
  const val = v.value
    ? Number(v.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '—'
  return (
    `📄 *Confirme o envio do contrato:*\n\n` +
    `👤 *Cliente:* ${client.name}\n` +
    `📋 *Modelo:* ${model.label}\n` +
    `📝 *Serviço:* ${v.service || '—'}\n` +
    `💰 *Valor:* ${val}\n` +
    `📅 *Início:* ${v.dataInicio || '—'} | *Vigência:* ${v.vigencia || '12'} meses\n` +
    `📧 *E-mail:* ${email}\n\n` +
    `Responda *sim* para enviar ou *não* para cancelar.`
  )
}

// ── Contrato: confirmação de envio ────────────────────────────────────────────
function contractSent(clientName, modelLabel, clientLink) {
  let msg = (
    `✅ *Contrato enviado com sucesso!*\n\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `📋 *Modelo:* ${modelLabel}\n\n` +
    `📧 E-mails enviados para ambas as partes assinarem.\n`
  )
  if (clientLink) {
    msg += `\n🔗 *Link de assinatura do cliente:*\n${clientLink}`
  }
  msg += `\n\nVou te avisar quando o contrato for assinado. ✍️`
  return msg
}




function contractAskFreelancer() {
  return `👤 *Nome completo do freelancer:*

Ex: _João Silva_`
}

function contractAskFreelancerDoc(name) {
  return (
    `🏢 *CPF ou CNPJ de ${name}:*

` +
    `Responda *pular* para deixar em branco.`
  )
}

function contractAskPrazo() {
  return `📅 *Prazo de entrega:*

Ex: _15/05/2026_ ou _30 dias após assinatura_`
}

function contractAskPagamento() {
  return `💳 *Forma de pagamento:*

Ex: _PIX_ | _50% entrada + 50% entrega_ | _Boleto 30 dias_`
}



function contractAskFreelancerEndereco(name) {
  return `🏠 *Endereço completo de ${name}:*\n\nEx: _Rua das Flores, 123 — São Paulo/SP_`
}

function contractAskTipoMaterial() {
  return `🎨 *Que tipo de material será criado?*\n\nEx: _Logo, Posts para Instagram, Banners, Identidade Visual_`
}

function contractAskQtdVideos() {
  return `🎬 *Quantidade de vídeos:*\n\nEx: _4 vídeos por mês_ ou _1 vídeo por semana_`
}

function contractAskPlataformas() {
  return `📱 *Quais plataformas serão gerenciadas?*\n\nEx: _Instagram, Facebook, TikTok_`
}

function contractAskQtdPosts() {
  return `📊 *Quantidade de posts por mês:*\n\nEx: _12 posts_ ou _3 por semana_`
}

function contractAskPlataforma() {
  return `🎯 *Qual plataforma de tráfego?*\n\nEx: _Google Ads_ | _Facebook Ads_ | _Google + Meta_`
}

function contractAskVencimento() {
  return `📅 *Dia de vencimento do pagamento:*\n\nEx: _5_, _10_, _15_, _20_`
}

function contractAskEndereco(clientName) {
  return `🏠 *Endereço completo de ${clientName}:*\n\nEx: _Rua das Flores, 123, Apto 45 — São Paulo/SP_`
}

function contractAskService(clientName, defaultService) {
  if (defaultService) {
    return (
      `📝 *Serviço do contrato para ${clientName}:*\n\n` +
      `Padrão cadastrado: *${defaultService}*\n\n` +
      `Responda *ok* para usar o padrão ou escreva outro serviço.`
    )
  }
  return `📝 *Qual o serviço do contrato para ${clientName}?*\n\nEx: _Gestão de Redes Sociais_`
}

function contractAskValue(clientName, defaultValue) {
  if (defaultValue) {
    const val = Number(defaultValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    return (
      `💰 *Valor do contrato para ${clientName}:*\n\n` +
      `Padrão cadastrado: *${val}*\n\n` +
      `Responda *ok* para usar o padrão ou informe outro valor.`
    )
  }
  return `💰 *Qual o valor do contrato para ${clientName}?*\n\nEx: _2500_ ou _2.500,00_`
}

function contractAskStart(clientName, today) {
  return (
    `📅 *Data de início do contrato para ${clientName}:*\n\n` +
    `Sugestão: *${today}*\n\n` +
    `Responda *ok* para usar hoje ou informe outra data (DD/MM/AAAA).`
  )
}

function contractAskDuration() {
  return (
    `⏳ *Vigência do contrato em meses:*\n\n` +
    `Padrão: *12 meses*\n\n` +
    `Responda *ok* para 12 meses ou informe outro número.`
  )
}

function adminClientNotFoundCreate(name) {
  return (
    `❌ Nenhum cliente encontrado com *"${name}"*.

` +
    `Deseja cadastrar um novo cliente com esse nome?

` +
    `Responda *sim* para criar ou *não* para cancelar.`
  )
}


// ── Cadastro inteligente de cliente ───────────────────────────────────────────
function registerClientStart() {
  return (
    `📋 *Cadastro de cliente*\n\n` +
    `Mande todas as informações de uma vez, em qualquer formato!\n\n` +
    `Exemplo:\n` +
    `_João Silva, 11987654321, joao@email.com, CNPJ 12.345.678/0001-99, Gestão de Tráfego, R$ 2.500, vence dia 10, Pix_\n\n` +
    `Extraio tudo automaticamente e peço o que faltar. 👍`
  )
}

function registerClientExtracted(summary, missing) {
  let msg = `✅ *Entendi as seguintes informações:*\n\n${summary}`
  if (missing.length) {
    const labels = { name: 'Nome', whatsapp: 'WhatsApp', email: 'E-mail', document: 'CNPJ ou CPF' }
    const list = missing.map(f => ('• ' + (labels[f] || f))).join('\n')
    msg += `\n\n⚠️ *Não encontrei:*\n${list}`
  }
  return msg
}

function registerClientAskWhatsapp(name) {
  return `📱 Qual o número de *WhatsApp de ${name}*?\n\nSó o número com DDD. Ex: _11987654321_`
}

function registerClientAskEmail(name) {
  return `📧 Qual o *e-mail de ${name}*?\n\nOu envie *pular* para deixar em branco.`
}

function registerClientAskDocument(name) {
  return `🏢 Qual o *CNPJ ou CPF de ${name}*?\n\nOu envie *pular* para deixar em branco.`
}

function registerClientConfirm(summary) {
  return (
    `📋 *Confirme o cadastro:*\n\n${summary}\n\n` +
    `Responda *sim* para cadastrar ou *corrigir* para alterar.`
  )
}

module.exports = {
  greeting, unknownClient, confirmRequest, requestSent, requestCancelled,
  notaReady, statusMessage, askService, askValue, askReference,
  accountingNotification, adminNFIssued,
  adminGreeting, adminClientList, adminClientNotFound, adminClientNotFoundCreate,
  scheduledReminder, batchReminder,
  askSaveDefaults, adminHistory, adminStats,
  contractModelList, contractConfirm, contractSent,
  contractAskService, contractAskValue, contractAskStart, contractAskDuration,
  contractAskFreelancer, contractAskFreelancerDoc, contractAskPrazo, contractAskPagamento,
  contractAskPlataformas, contractAskQtdPosts, contractAskPlataforma, contractAskVencimento, contractAskEndereco,
  contractAskFreelancerEndereco, contractAskTipoMaterial, contractAskQtdVideos,
  registerClientStart, registerClientExtracted,
  registerClientAskWhatsapp, registerClientAskEmail,
  registerClientAskDocument, registerClientConfirm
}
