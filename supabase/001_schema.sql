-- ============================================================
--  nf-bot — Schema
--  Execute em: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── CLIENTES ────────────────────────────────────────────────
-- Cada cliente tem número WhatsApp, CNPJ, email e serviço padrão
create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  whatsapp      text not null unique,   -- ex: "5511999999999"
  email         text not null,
  cnpj          text,                   -- ex: "12.345.678/0001-99"
  cpf           text,                   -- para pessoa física
  company       text,
  default_service text,                 -- ex: "Gestão de Tráfego"
  default_value   numeric(12,2),        -- valor mensal recorrente
  drive_folder_id text,                 -- pasta específica no Drive (opcional)
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ─── SOLICITAÇÕES DE NOTA FISCAL ─────────────────────────────
create table if not exists nf_requests (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,

  -- Dados da nota
  service       text not null,
  value         numeric(12,2) not null,
  document      text not null,          -- CNPJ ou CPF usado na nota
  reference     text,                   -- ex: "Abril/2026"
  notes         text,                   -- observações adicionais

  -- Status do fluxo
  status        text not null default 'pending'
                  check (status in (
                    'pending',          -- criada, aguardando envio à contabilidade
                    'sent',             -- notificação enviada à contabilidade
                    'processing',       -- contabilidade confirmou que está processando
                    'issued',           -- PDF detectado no Drive
                    'delivered',        -- PDF enviado ao cliente
                    'cancelled'
                  )),

  -- Arquivos
  drive_file_id   text,                 -- ID do arquivo no Google Drive
  drive_file_name text,
  drive_file_url  text,

  -- Rastreamento
  requested_via   text default 'whatsapp',  -- 'whatsapp' | 'admin'
  notified_at     timestamptz,          -- quando contabilidade foi notificada
  issued_at       timestamptz,          -- quando PDF apareceu no Drive
  delivered_at    timestamptz,          -- quando email foi enviado ao cliente

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists nf_requests_client_idx  on nf_requests(client_id);
create index if not exists nf_requests_status_idx  on nf_requests(status);
create index if not exists nf_requests_created_idx on nf_requests(created_at desc);

-- ─── LOG DE MENSAGENS ────────────────────────────────────────
-- Histórico de conversa com cada cliente no WhatsApp
create table if not exists wpp_messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete set null,
  whatsapp    text not null,
  direction   text not null check (direction in ('in', 'out')),
  body        text not null,
  request_id  uuid references nf_requests(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists wpp_messages_whatsapp_idx on wpp_messages(whatsapp, created_at desc);

-- ─── ESTADO DA CONVERSA ──────────────────────────────────────
-- Mantém o estado atual de cada conversa ativa
create table if not exists conversation_states (
  whatsapp    text primary key,
  client_id   uuid references clients(id) on delete cascade,
  state       text not null default 'idle',
  -- idle | awaiting_confirmation | awaiting_value | awaiting_service | awaiting_document
  context     jsonb not null default '{}',  -- dados parciais da solicitação
  updated_at  timestamptz not null default now()
);

-- ─── AUTO updated_at ─────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists clients_updated_at on clients;
create trigger clients_updated_at
  before update on clients
  for each row execute procedure set_updated_at();

drop trigger if exists nf_requests_updated_at on nf_requests;
create trigger nf_requests_updated_at
  before update on nf_requests
  for each row execute procedure set_updated_at();

drop trigger if exists conversation_states_updated_at on conversation_states;
create trigger conversation_states_updated_at
  before update on conversation_states
  for each row execute procedure set_updated_at();
