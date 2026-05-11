const Anthropic = require('@anthropic-ai/sdk')
const OpenAI    = require('openai')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getWhisperClient() {
  if (process.env.OPENAI_API_KEY) return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  if (process.env.GROQ_API_KEY)   return new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  return null
}

// Converte palavras da fala para símbolos antes de enviar à IA
function preprocessTranscription(text) {
  return text
    .replace(/\barroba\b/gi, '@')
    .replace(/\bponto\s+com\b/gi, '.com')
    .replace(/\bponto\s+com\s+ponto\s+br\b/gi, '.com.br')
    .replace(/\bponto\s+br\b/gi, '.br')
    .replace(/\bponto\s+net\b/gi, '.net')
    .replace(/\bponto\s+org\b/gi, '.org')
    .replace(/\btraço\b/gi, '-')
    .replace(/\bbarra\b/gi, '/')
    .replace(/\bcnpj\s*[:=]?\s*(?=[0-9])/gi, '')
    .replace(/\bcpf\s*[:=]?\s*(?=[0-9])/gi, '')
}

// Transcreve áudio para texto via Whisper (OpenAI ou Groq)
async function transcribeAudio(audioBase64, mimeType) {
  const client = getWhisperClient()
  if (!client) throw new Error('Configure OPENAI_API_KEY ou GROQ_API_KEY no .env para usar áudio')

  const mediaType = (mimeType || 'audio/ogg').split(';')[0].trim()
  const ext       = mediaType.includes('ogg')  ? 'ogg'
                  : mediaType.includes('webm') ? 'webm'
                  : mediaType.includes('mp4') || mediaType.includes('mpeg') ? 'mp3'
                  : 'ogg'
  const model = process.env.OPENAI_API_KEY ? 'whisper-1' : 'whisper-large-v3-turbo'

  const buffer    = Buffer.from(audioBase64, 'base64')
  const audioFile = new File([buffer], `audio.${ext}`, { type: mediaType })

  const result = await client.audio.transcriptions.create({
    file:            audioFile,
    model,
    language:        'pt',
    response_format: 'text'
  })

  return typeof result === 'string' ? result : (result.text || '')
}

// Extrai campos cadastrais de texto livre ou fala transcrita
async function extractClientData(text) {
  const processed = preprocessTranscription(text)
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: `Você extrai dados cadastrais de clientes a partir de texto livre ou fala transcrita pelo Whisper (português brasileiro).

PADRÕES COMUNS NA TRANSCRIÇÃO DE FALA:
- Email sem @: "joao.gmail.com" provavelmente é "joao@gmail.com". Se ver "nome.dominio.com" sem @, insira @ entre usuário e domínio.
- "arroba" já foi substituído por @ no pré-processamento, mas pode aparecer como palavra.
- CNPJ/CPF: pode vir sem pontuação, 14 ou 11 dígitos respectivamente. Remova prefixo "cnpj" ou "cpf" se ainda presente.
- WhatsApp: somente dígitos com DDD, 10 ou 11 dígitos, SEM prefixo 55.
- Números por extenso: "onze noventa e oito..." = "11 98...", "dois mil" = 2000, "mil e quinhentos" = 1500.
- Dia de vencimento: "vence dia 5" / "vence todo dia cinco" → billing_day: 5.
- Pagamento: "pix" → "Pix", "boleto" → "Boleto", "cartão" → "Cartão", "permuta" → "Permuta".

HEURÍSTICA DE EMAIL — se o texto tiver algo como "palavra.dominio.com" sem @, reconstrua:
- "joao.gmail.com" → "joao@gmail.com"
- "maria.hotmail.com" → "maria@hotmail.com"
- "contato.empresa.com.br" → "contato@empresa.com.br"
- "ana silva arroba terra ponto com ponto br" → "anasilva@terra.com.br"

EXEMPLOS COMPLETOS:
Entrada: "João Silva, onze noventa e oito seis cinco quatro três dois um, joao.gmail.com, cnpj12345678000199, gestão de tráfego, dois mil reais, vence dia dez, pix"
Saída: {"name":"João Silva","whatsapp":"11987654321","email":"joao@gmail.com","cnpj":"12345678000199","default_service":"Gestão de Tráfego","default_value":2000,"billing_day":10,"payment_method":"Pix"}

Entrada: "Maria Costa, zap onze noventa e dois três quatro cinco seis sete oito, maria@hotmail.com, social media, mil e quinhentos, dia quinze, boleto"
Saída: {"name":"Maria Costa","whatsapp":"11923456789","email":"maria@hotmail.com","cnpj":null,"cpf":null,"default_service":"Social Media","default_value":1500,"billing_day":15,"payment_method":"Boleto"}

Campos a extrair (null se ausente ou incerto):
- name: nome completo ou razão social
- whatsapp: somente dígitos, DDD + número (10 ou 11 dígitos)
- email: endereço válido com @
- cnpj: somente 14 dígitos
- cpf: somente 11 dígitos
- company: razão social se diferente do name
- default_service: serviço prestado
- default_value: valor numérico mensal (sem R$)
- billing_day: número do dia (1–31)
- payment_method: Pix | Boleto | Cartão | Permuta

Retorne APENAS JSON válido, sem markdown, sem explicação.`,
      messages: [{ role: 'user', content: processed }]
    })
    const raw = msg.content[0].text.trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function transcribeAndExtract(audioBase64, mimeType) {
  const transcription = await transcribeAudio(audioBase64, mimeType)
  const data          = await extractClientData(transcription)
  return { transcription, data }
}

function missingFields(data) {
  const missing = []
  if (!data.name)              missing.push('name')
  if (!data.whatsapp)          missing.push('whatsapp')
  if (!data.email)             missing.push('email')
  if (!data.cnpj && !data.cpf) missing.push('document')
  return missing
}

function formatClientSummary(data) {
  const val = data.default_value
    ? Number(data.default_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null
  return [
    `👤 *Nome:* ${data.name || '—'}`,
    `📱 *WhatsApp:* ${data.whatsapp || '—'}`,
    `📧 *Email:* ${data.email || '—'}`,
    `🏢 *CNPJ/CPF:* ${data.cnpj || data.cpf || '—'}`,
    data.company         ? `🏭 *Razão social:* ${data.company}` : null,
    data.default_service ? `📝 *Serviço:* ${data.default_service}` : null,
    val                  ? `💰 *Valor:* ${val}` : null,
    data.billing_day     ? `📅 *Vencimento:* dia ${data.billing_day}` : null,
    data.payment_method  ? `💳 *Pagamento:* ${data.payment_method}` : null,
  ].filter(Boolean).join('\n')
}

module.exports = { transcribeAudio, extractClientData, transcribeAndExtract, preprocessTranscription, missingFields, formatClientSummary }
