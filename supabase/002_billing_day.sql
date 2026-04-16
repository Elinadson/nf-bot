-- Adiciona dia de cobrança e flag de admin aos clientes
alter table clients
  add column if not exists billing_day integer check (billing_day between 1 and 31),
  add column if not exists is_admin boolean not null default false;

comment on column clients.billing_day is 'Dia do mês para lembrete automático (1-31)';
comment on column clients.is_admin is 'Se true, mensagens deste número são tratadas como comandos de admin';
