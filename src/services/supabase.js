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

// Busca clientes por nome (busca parcial, case-insensitive)
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

// Busca clientes com billing_day igual ao dia informado
async function getClientsByBillingDay(day) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .eq('billing_day', day)
  if (error) console.error('[supabase] getClientsByBillingDay:', error.message)
  return data || []
}

async function upsertClient(client) {
  const { data, error } = await supabase
    .from('clients')
    .upsert(client, { onConflict: 'id' })
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

module.exports = {
  getClientByPhone, getAllClients, searchClientsByName, getClientsByBillingDay,
  upsertClient, deleteClient,
  createRequest, updateRequest, getRequestsByStatus, getAllRequests, getRequestById,
  getConversationState, setConversationState, clearConversationState,
  logMessage
}
