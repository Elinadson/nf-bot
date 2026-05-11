const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// ── Clientes ──────────────────────────────────────────────────────────────────

async function getClientByPhone(whatsapp) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('whatsapp', whatsapp)
    .eq('active', true)
    .single()
  if (error && error.code !== 'PGRST116') console.error('[supabase] getClientByPhone:', error.message)
  return data || null
}

async function getAllClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .order('name')
  if (error) console.error('[supabase] getAllClients:', error.message)
  return data || []
}

async function searchClientsByName(name) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .ilike('name', `%${name}%`)
    .order('name')
  if (error) console.error('[supabase] searchClientsByName:', error.message)
  return data || []
}

async function getClientsByBillingDay(day) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .eq('billing_day', day)
    .eq('needs_nf', true)
  if (error) console.error('[supabase] getClientsByBillingDay:', error.message)
  return data || []
}

async function upsertClient(client) {
  // Se tem id => atualiza pelo id; se não => upsert pelo whatsapp (novo cadastro via bot)
  const conflictCol = client.id ? 'id' : 'whatsapp'
  const { data, error } = await supabase
    .from('clients')
    .upsert(client, { onConflict: conflictCol })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function deleteClient(id) {
  const { error } = await supabase
    .from('clients')
    .update({ active: false })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Solicitações ──────────────────────────────────────────────────────────────

async function createRequest(payload) {
  const { data, error } = await supabase
    .from('nf_requests')
    .insert(payload)
    .select('*, clients(*)')
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function updateRequest(id, updates) {
  const { data, error } = await supabase
    .from('nf_requests')
    .update(updates)
    .eq('id', id)
    .select('*, clients(*)')
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function getRequestsByStatus(status) {
  const { data, error } = await supabase
    .from('nf_requests')
    .select('*, clients(*)')
    .eq('status', status)
    .order('created_at', { ascending: false })
  if (error) console.error('[supabase] getRequestsByStatus:', error.message)
  return data || []
}

async function getAllRequests({ limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('nf_requests')
    .select('*, clients(*)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) console.error('[supabase] getAllRequests:', error.message)
  return data || []
}

async function getRequestById(id) {
  const { data, error } = await supabase
    .from('nf_requests')
    .select('*, clients(*)')
    .eq('id', id)
    .single()
  if (error) return null
  return data
}

async function getRequestsByClientId(clientId, { limit = 10 } = {}) {
  const { data, error } = await supabase
    .from('nf_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) console.error('[supabase] getRequestsByClientId:', error.message)
  return data || []
}

// ── Estado da conversa ────────────────────────────────────────────────────────

async function getConversationState(whatsapp) {
  const { data } = await supabase
    .from('conversation_states')
    .select('*')
    .eq('whatsapp', whatsapp)
    .single()
  return data || null
}

async function setConversationState(whatsapp, state, context = {}, clientId = null) {
  const { error } = await supabase
    .from('conversation_states')
    .upsert({
      whatsapp,
      state,
      context,
      client_id: clientId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'whatsapp' })
  if (error) console.error('[supabase] setConversationState:', error.message)
}

async function clearConversationState(whatsapp) {
  await setConversationState(whatsapp, 'idle', {})
}

// ── Log de mensagens ──────────────────────────────────────────────────────────

async function logMessage({ whatsapp, direction, body, clientId = null, requestId = null }) {
  await supabase.from('wpp_messages').insert({
    whatsapp,
    direction,
    body,
    client_id: clientId,
    request_id: requestId
  })
}

// ── Contratos ─────────────────────────────────────────────────────────────────

async function createContract({ client_id, autentique_id, model, status = 'pending', client_link, studio_link }) {
  const { data, error } = await supabase
    .from('contracts')
    .insert({ client_id, autentique_id, model, status, client_link, studio_link })
    .select('*, clients(*)')
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function updateContract(id, updates) {
  const { data, error } = await supabase
    .from('contracts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function getContractByAutentiqueId(autentiqueId) {
  const { data } = await supabase
    .from('contracts')
    .select('*, clients(*)')
    .eq('autentique_id', autentiqueId)
    .single()
  return data || null
}

async function getContractsByClientId(clientId, { limit = 5 } = {}) {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) console.error('[supabase] getContractsByClientId:', error.message)
  return data || []
}

module.exports = {
  getClientByPhone, getAllClients, searchClientsByName, getClientsByBillingDay,
  upsertClient, deleteClient,
  createRequest, updateRequest, getRequestsByStatus, getAllRequests,
  getRequestById, getRequestsByClientId,
  getConversationState, setConversationState, clearConversationState,
  logMessage,
  createContract, updateContract, getContractByAutentiqueId, getContractsByClientId
}
