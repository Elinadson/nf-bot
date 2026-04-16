const nodemailer = require('nodemailer')
const https      = require('https')
const http       = require('http')

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
})

// ── Baixa PDF de uma URL como buffer ─────────────────────────────────────────
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    proto.get(url, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end',  () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

// ── Notificação à contabilidade ───────────────────────────────────────────────
async function sendAccountingNotification(request) {
  const val  = Number(request.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const date = new Date(request.created_at).toLocaleDateString('pt-BR')

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:8px">
      <h2 style="color:#1a1a1a;margin-bottom:4px">🔔 Nova Solicitação de Nota Fiscal</h2>
      <p style="color:#666;margin-top:0">NDD Estudio Criativo</p>
      <hr style="border:1px solid #e0e0e0"/>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;color:#666;width:140px">Cliente</td><td style="padding:8px;font-weight:bold">${request.clients.name}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;color:#666">Serviço</td><td style="padding:8px">${request.service}</td></tr>
        <tr><td style="padding:8px;color:#666">Valor</td><td style="padding:8px;font-weight:bold;color:#16a34a">${val}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;color:#666">CNPJ/CPF</td><td style="padding:8px">${request.document}</td></tr>
        <tr><td style="padding:8px;color:#666">Referência</td><td style="padding:8px">${request.reference || '—'}</td></tr>
        <tr style="background:#fff"><td style="padding:8px;color:#666">Solicitado em</td><td style="padding:8px">${date}</td></tr>
        <tr><td style="padding:8px;color:#666">Email cliente</td><td style="padding:8px">${request.clients.email}</td></tr>
      </table>
      <hr style="border:1px solid #e0e0e0"/>
      <p style="color:#666;font-size:13px">Por favor, gere a nota fiscal e faça o upload do PDF na pasta do Google Drive.</p>
      <p style="color:#999;font-size:12px">ID da solicitação: ${request.id}</p>
    </div>
  `

  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to:      process.env.CONTABILIDADE_EMAIL,
    subject: `[NF] Solicitação — ${request.clients.name} — ${request.reference || request.service}`,
    html
  })

  console.log(`[email] Notificação enviada para contabilidade: ${request.clients.name}`)
}

// ── Envio da NF ao cliente ────────────────────────────────────────────────────
async function sendNFToClient(request, fileUrl, fileName) {
  const client = request.clients
  const val    = Number(request.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // Baixa o PDF para anexar
  let attachment = null
  try {
    const buf = await fetchBuffer(fileUrl)
    attachment = { filename: fileName, content: buf, contentType: 'application/pdf' }
  } catch (err) {
    console.error('[email] Não foi possível baixar o PDF, enviando link:', err.message)
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9f9f9;padding:24px;border-radius:8px">
      <h2 style="color:#1a1a1a">📄 Sua Nota Fiscal está pronta!</h2>
      <p style="color:#444">Olá, <strong>${client.name}</strong>!</p>
      <p style="color:#444">Sua nota fiscal foi emitida. Seguem os detalhes:</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="padding:10px;color:#666;width:130px">Serviço</td><td style="padding:10px">${request.service}</td></tr>
        <tr style="background:#f4f4f4"><td style="padding:10px;color:#666">Valor</td><td style="padding:10px;font-weight:bold;color:#16a34a">${val}</td></tr>
        <tr><td style="padding:10px;color:#666">Referência</td><td style="padding:10px">${request.reference || '—'}</td></tr>
      </table>
      ${attachment
        ? '<p style="color:#444;margin-top:20px">A nota fiscal está <strong>em anexo</strong> neste email.</p>'
        : `<p style="color:#444;margin-top:20px"><a href="${fileUrl}" style="color:#2563eb">Clique aqui para baixar sua nota fiscal</a></p>`
      }
      <hr style="border:1px solid #e0e0e0;margin-top:24px"/>
      <p style="color:#999;font-size:12px">NDD Estudio Criativo • Qualquer dúvida, responda este e-mail.</p>
    </div>
  `

  const mailOptions = {
    from:    process.env.EMAIL_FROM,
    to:      client.email,
    subject: `Nota Fiscal — ${request.reference || request.service} — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
    attachments: attachment ? [attachment] : []
  }

  await transporter.sendMail(mailOptions)
  console.log(`[email] NF enviada para cliente: ${client.email}`)
}

module.exports = { sendAccountingNotification, sendNFToClient }
