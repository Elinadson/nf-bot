require('dotenv').config({ path: '/home/ubuntu/nf-bot/.env' });
const db = require('./src/services/supabase');
const { sendScheduledReminder } = require('./src/bot/handler');

async function run() {
  const today = new Date().getDate();
  console.log(`Verificando clientes com billing_day = ${today}...`);
  const clients = await db.getClientsByBillingDay(today);
  if (!clients.length) {
    console.log('Nenhum cliente com cobrança hoje.');
    process.exit(0);
  }
  for (const c of clients) {
    console.log(`Enviando lembrete: ${c.name}`);
    await sendScheduledReminder(c);
  }
  console.log('Pronto!');
  process.exit(0);
}
run();
