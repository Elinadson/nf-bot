-- Adiciona campos de gestão financeira aos clientes
alter table clients
  add column if not exists needs_nf       boolean not null default false,
  add column if not exists payment_method text,   -- Pix | Boleto | Cartão | Permuta
  add column if not exists paid           boolean not null default false,
  add column if not exists nf_status      text;   -- status visual da nota (Pendente / Enviado / etc)

comment on column clients.needs_nf       is 'Se true, bot envia lembrete de NF no billing_day';
comment on column clients.payment_method is 'Forma de pagamento: Pix, Boleto, Cartão, Permuta';
comment on column clients.paid           is 'Se o cliente pagou no mês atual';
comment on column clients.nf_status      is 'Status visual da nota fiscal';
