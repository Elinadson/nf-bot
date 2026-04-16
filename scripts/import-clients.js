require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── Extrai dia do mês de strings como "February 20, 2026" ─────────────────────
function extractDay(dateStr) {
  if (!dateStr) return null
  const match = dateStr.match(/(\d+),?\s*\d{4}/)
  return match ? parseInt(match[1]) : null
}

// ── Converte valor (ignora "Permuta" e vazios) ────────────────────────────────
function parseValue(val) {
  if (!val || val.trim().toLowerCase() === 'permuta') return null
  const n = parseFloat(val.replace(/[^\d.]/g, ''))
  return isNaN(n) ? null : n
}

// ── Dados dos clientes ────────────────────────────────────────────────────────
const clients = [
  { name: 'Natália Maesky',           date: 'February 20, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '1170' },
  { name: 'Ferro Velho',              date: 'March 1, 2026',     payment_method: 'Boleto', needs_nf: true,  notes: 'Fazer boleto e enviar',                   paid: false, nf_status: '',                value: '1000' },
  { name: 'Reverse Cirurgias',        date: 'February 5, 2026',  payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: true,  nf_status: '',                value: '1000' },
  { name: 'Fabrícia Guimarães',       date: 'February 23, 2026', payment_method: 'Cartão', needs_nf: false, notes: 'Pago 1000,00',                            paid: false, nf_status: 'Pendente de envio', value: '2000' },
  { name: 'Micheli Cesarini',         date: 'February 27, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '700' },
  { name: 'Ricardo',                  date: 'March 17, 2026',    payment_method: 'Cartão', needs_nf: false, notes: '',                                        paid: true,  nf_status: '',                value: '1487' },
  { name: 'Dr. João',                 date: 'February 20, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '780' },
  { name: 'Ana Carolina Rodarte',     date: 'February 20, 2026', payment_method: 'Boleto', needs_nf: true,  notes: 'Fazer boleto e enviar',                   paid: true,  nf_status: 'Pendente de envio', value: '1500' },
  { name: 'Solange Domingues',        date: 'February 10, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: true,  nf_status: '',                value: '1450' },
  { name: 'Casa dos Bichos',          date: 'February 23, 2026', payment_method: 'Cartão', needs_nf: false, notes: 'Pago junto com perfil da Fabrícia',       paid: false, nf_status: '',                value: '' },
  { name: 'Henrique Malheiros',       date: 'February 27, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '2500' },
  { name: 'Lauriete Diniz',           date: '',                  payment_method: 'Permuta', needs_nf: false, notes: '',                                       paid: false, nf_status: '',                value: 'Permuta' },
  { name: 'Allanys Gonçalves',        date: 'February 20, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '600' },
  { name: 'Lucila Stanziola',         date: 'February 5, 2026',  payment_method: 'Pix',    needs_nf: true,  notes: '',                                        paid: true,  nf_status: 'Enviado',         value: '400' },
  { name: 'Angélica (ChocoAngel)',    date: 'February 17, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: true,  nf_status: '',                value: '840' },
  { name: 'Ana Luiza',                date: 'February 16, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: true,  nf_status: '',                value: '2200' },
  { name: 'Ricácia Dantas',           date: 'February 27, 2026', payment_method: 'Pix',    needs_nf: false, notes: '',                                        paid: false, nf_status: '',                value: '250' },
  { name: 'Luana Simões Andrioli',    date: 'February 16, 2026', payment_method: 'Pix',    needs_nf: true,  notes: '',                                        paid: true,  nf_status: 'Pendente de envio', value: '2000' },
  { name: 'Eduarda Prado Crepaldi',   date: 'February 1, 2026',  payment_method: 'Pix',    needs_nf: false, notes: 'Está devendo.',                           paid: false, nf_status: '',                value: '1200' },
]

async function run() {
  console.log(`Importando ${clients.length} clientes...\n`)
  let ok = 0, erros = 0

  for (const c of clients) {
    const payload = {
      name:            c.name.trim(),
      payment_method:  c.payment_method || null,
      billing_day:     extractDay(c.date),
      needs_nf:        c.needs_nf,
      default_value:   parseValue(c.value),
      notes:           c.notes || null,
      paid:            c.paid,
      nf_status:       c.nf_status || null,
      active:          true,
      is_admin:        false,
      // WhatsApp e email podem ser adicionados depois pelo painel
      whatsapp:        null,
      email:           null,
    }

    const { error } = await supabase.from('clients').insert(payload)

    if (error) {
      console.error(`❌ ${c.name}: ${error.message}`)
      erros++
    } else {
      console.log(`✅ ${c.name} (dia ${payload.billing_day || '—'}, R$ ${payload.default_value || 'Permuta'})`)
      ok++
    }
  }

  console.log(`\n✅ ${ok} importados | ❌ ${erros} erros`)
  process.exit(0)
}

run()
