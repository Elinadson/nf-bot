const { Client } = require('@notionhq/client')

const notion = new Client({ auth: process.env.NOTION_API_KEY })

const DB_ID         = () => process.env.NOTION_CLIENTS_DB_ID
const ESCRITORIO_ID = () => process.env.NOTION_WORKSPACE_PAGE_ID

function formatCurrency(value) {
  if (!value) return null
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Adiciona cliente no database Estrategias & Calendarios (sem dados financeiros)
async function createClientPage(client) {
  if (!process.env.NOTION_API_KEY || !DB_ID()) return null

  const properties = {
    'Nome':      { title: [{ text: { content: client.name || '' } }] },
    'Status':    { select: { name: 'Ativo' } },
    'Selecionar': { select: { name: 'Ativo' } },
  }
  if (client.whatsapp) properties['WhatsApp']    = { phone_number: client.whatsapp }
  if (client.email)    properties['Email']        = { email: client.email }
  if (client.cnpj || client.cpf) properties['CNPJ/CPF'] = { rich_text: [{ text: { content: client.cnpj || client.cpf } }] }
  if (client.company)  properties['Razao Social'] = { rich_text: [{ text: { content: client.company } }] }

  // Etapa 1: cria a pagina com blocos simples (API nao permite child_page/child_database em children)
  const page = await notion.pages.create({
    parent: { database_id: DB_ID() },
    properties,
    children: buildStrategyHeader(),
  })

  // Etapa 2: cria sub-paginas e databases via endpoints proprios (unico jeito suportado pela API)
  await createClientSubpages(page.id, client.name)

  return page
}

// Cria pagina financeira do cliente em NDD | ESCRITORIO DIGITAL
async function createFinancialPage(client) {
  if (!process.env.NOTION_API_KEY || !ESCRITORIO_ID()) return null

  const hasFinancialData = client.default_value || client.default_service
    || client.billing_day || client.payment_method

  if (!hasFinancialData) return null

  const infoLines = [
    client.default_service && `Servico: ${client.default_service}`,
    client.default_value   && `Valor Mensal: ${formatCurrency(client.default_value)}`,
    client.billing_day     && `Vencimento: dia ${client.billing_day}`,
    client.payment_method  && `Forma de Pagamento: ${client.payment_method}`,
    (client.cnpj || client.cpf) && `Documento: ${client.cnpj || client.cpf}`,
    client.email    && `Email: ${client.email}`,
    client.whatsapp && `WhatsApp: ${client.whatsapp}`,
  ].filter(Boolean)

  await notion.pages.create({
    parent: { page_id: ESCRITORIO_ID() },
    properties: {
      title: [{ text: { content: client.name } }]
    },
    children: [
      {
        object: 'block', type: 'callout',
        callout: {
          icon: { emoji: '💰' },
          color: 'green_background',
          rich_text: [{ text: { content: 'Informacoes Financeiras' } }]
        }
      },
      ...infoLines.map(line => ({
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: line } }] }
      })),
      { object: 'block', type: 'divider', divider: {} },
      {
        object: 'block', type: 'heading_2',
        heading_2: { rich_text: [{ text: { content: 'Notas Fiscais' } }] }
      },
      {
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: 'Historico de NFs aparecera aqui.' } }] }
      },
    ]
  })
}

// Blocos simples (sem child_page/child_database) para pages.create()
function buildStrategyHeader() {
  const col  = (children) => ({ object: 'block', type: 'column',      column:      { children } })
  const cols = (children) => ({ object: 'block', type: 'column_list', column_list: { children } })
  const div  = () => ({ object: 'block', type: 'divider',   divider:   {} })
  const par  = () => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } })

  return [
    cols([
      col([
        {
          object: 'block', type: 'callout',
          callout: {
            icon: { emoji: '🔑' },
            color: 'yellow_background',
            rich_text: [{ type: 'text', text: { content: 'ACESSOS' } }]
          }
        },
        par()
      ]),
      col([
        par(), div(),
        {
          object: 'block', type: 'callout',
          callout: {
            icon: { emoji: '📋' },
            color: 'blue_background',
            rich_text: [{ type: 'text', text: { content: 'PROJETO' } }]
          }
        },
        par(), par(), par(), div()
      ])
    ]),
    div()
  ]
}

// Cria sub-paginas e databases como filhos da pagina do cliente
async function createClientSubpages(pageId, name) {
  const db = (title) => notion.databases.create({
    parent: { page_id: pageId },
    title:  [{ type: 'text', text: { content: title } }],
    properties: { 'Nome': { title: {} } }
  })
  const pg = (title) => notion.pages.create({
    parent: { page_id: pageId },
    properties: { title: [{ text: { content: title } }] }
  })

  await Promise.all([
    db('Relatorios ' + name),
    pg('Senha'),
    pg('Drives'),
    pg('Chuva de ideias'),
    pg('Reunioes'),
    db('Central de documentos'),
    db('ISCAS'),
    pg('Direcionamento de Conteudo | ' + name),
    pg('BRIEFING MASTER | ' + name.toUpperCase()),
  ])
}

async function registerClientOnNotion(client) {
  if (!process.env.NOTION_API_KEY) return null
  try {
    const page = await createClientPage(client)
    await createFinancialPage(client)
    console.log('[notion] Cliente "' + client.name + '" criado no Notion')
    if (!page) return null
    const pageUrl = 'https://www.notion.so/' + page.id.replace(/-/g, '')
    return { url: pageUrl, id: page.id }
  } catch (err) {
    console.error('[notion] Erro ao criar cliente:', err.message)
    return null
  }
}

// ── Busca e formata o roadmap diário do Notion ───────────────────────────────
async function fetchRoadmapMessage() {
  const pageId = process.env.NOTION_ROADMAP_PAGE_ID
  if (!pageId) throw new Error('NOTION_ROADMAP_PAGE_ID não configurado')

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo'
  })

  const richText = (block) =>
    block?.rich_text?.map(t => t.plain_text).join('') || ''

  async function collectBlocks(blockId) {
    const lines = []
    let cursor
    do {
      const res = await notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {})
      })
      cursor = res.has_more ? res.next_cursor : undefined

      for (const b of res.results) {
        const t = b.type
        const text = richText(b[t]).trim()

        if (t === 'column_list' || t === 'column') {
          lines.push(...await collectBlocks(b.id))
        } else if (t === 'heading_1') {
          if (text) lines.push(`\n*${text}*`)
        } else if (t === 'heading_2') {
          if (text) lines.push(`\n_${text}_`)
        } else if (t === 'heading_3') {
          if (text) lines.push(`_${text}_`)
        } else if (t === 'paragraph') {
          if (text) lines.push(text)
        } else if (t === 'numbered_list_item') {
          if (text) lines.push(`• ${text}`)
        } else if (t === 'bulleted_list_item') {
          if (text) lines.push(`• ${text}`)
        } else if (t === 'to_do') {
          if (text) lines.push(`${b[t].checked ? '✅' : '⬜'} ${text}`)
        } else if (t === 'divider') {
          lines.push('─────────────────')
        } else if (t === 'child_database' || t === 'child_page') {
          const title = b[t]?.title || ''
          if (title) lines.push(`\n📌 *${title}*`)
        }
      }
    } while (cursor)
    return lines
  }

  const lines = await collectBlocks(pageId)
  const body  = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const link  = `https://www.notion.so/${pageId.replace(/-/g, '')}`

  return `🗺️ *ROADMAP DO DIA — ${today.toUpperCase()}*\n\n${body}\n\n🔗 ${link}`
}

// ── Extrai texto puro de blocos (recursivo, 3 níveis) ────────────────────────
async function fetchPageText(blockId, depth = 0) {
  if (depth > 2) return ''
  const lines = []
  let cursor
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId, page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    })
    cursor = res.has_more ? res.next_cursor : undefined
    for (const b of res.results) {
      const t = b.type
      const c = b[t]
      const text = c?.rich_text?.map(x => x.plain_text).join('') || ''
      if (['column_list', 'column'].includes(t)) {
        lines.push(await fetchPageText(b.id, depth + 1))
      } else if (t === 'heading_1')           lines.push(`\n## ${text}`)
      else if (t === 'heading_2')             lines.push(`\n### ${text}`)
      else if (t === 'heading_3')             lines.push(`#### ${text}`)
      else if (t === 'paragraph' && text)     lines.push(text)
      else if (t === 'numbered_list_item')    lines.push(`- ${text}`)
      else if (t === 'bulleted_list_item')    lines.push(`- ${text}`)
      else if (t === 'to_do')                 lines.push(`[${c?.checked ? 'x' : ' '}] ${text}`)
      else if (t === 'callout' && text)       lines.push(`> ${text}`)
      else if (t === 'child_page')            lines.push(`[página: ${c?.title || ''}]`)
      else if (t === 'child_database')        lines.push(`[database: ${c?.title || ''}]`)
      if (b.has_children && !['column_list','column'].includes(t) && depth < 2) {
        lines.push(await fetchPageText(b.id, depth + 1))
      }
    }
  } while (cursor)
  return lines.filter(Boolean).join('\n')
}

// ── Busca contexto do Notion para responder perguntas via IA ─────────────────
async function searchNotionContext(query) {
  const sections = []

  // 1. Sempre inclui o roadmap (principal documento operacional)
  if (process.env.NOTION_ROADMAP_PAGE_ID) {
    try {
      const text = await fetchPageText(process.env.NOTION_ROADMAP_PAGE_ID)
      if (text) sections.push(`=== ROADMAP CLIENTES ===\n${text}`)
    } catch { /* ignora se falhar */ }
  }

  // 2. Busca semântica no Notion
  try {
    const res = await notion.search({ query, page_size: 4 })
    const roadmapId = (process.env.NOTION_ROADMAP_PAGE_ID || '').replace(/-/g, '')
    for (const item of res.results) {
      const id = item.id.replace(/-/g, '')
      if (id === roadmapId) continue  // já incluído
      const title = item.object === 'database'
        ? item.title?.map(t => t.plain_text).join('') || 'Database'
        : Object.values(item.properties || {}).find(p => p.type === 'title')
            ?.title?.map(t => t.plain_text).join('') || 'Página'
      try {
        const text = await fetchPageText(item.id)
        if (text.trim()) sections.push(`=== ${title.toUpperCase()} ===\n${text}`)
      } catch { /* ignora */ }
    }
  } catch { /* ignora falha na busca */ }

  // Limita contexto total a 12.000 chars para não estourar o prompt
  const full = sections.join('\n\n')
  return full.length > 12000 ? full.slice(0, 12000) + '\n[...conteúdo truncado]' : full
}

module.exports = { registerClientOnNotion, createClientPage, createFinancialPage, fetchRoadmapMessage, searchNotionContext }
