# NF Bot — Bot WhatsApp para Notas Fiscais

Automação completa do fluxo de solicitação e entrega de notas fiscais via WhatsApp.

## Fluxo

```
Cliente → WhatsApp → Bot identifica → Confirma dados → Notifica contabilidade
                                                               ↓
                                              Contabilidade sobe PDF no Drive
                                                               ↓
                                         Bot detecta PDF → Envia email ao cliente
                                                               ↓
                                              Bot avisa cliente no WhatsApp ✅
```

## Instalação

```bash
npm install
cp .env.example .env
# Edite o .env com suas credenciais
```

## Configuração Supabase

Execute o SQL em `supabase/001_schema.sql` no Supabase Dashboard > SQL Editor.

## Configuração Google Drive

1. Crie um projeto no Google Cloud Console
2. Ative a Google Drive API
3. Crie uma conta de serviço e baixe a chave JSON
4. Compartilhe a pasta do Drive com o email da conta de serviço
5. Copie o `GOOGLE_SERVICE_ACCOUNT_EMAIL` e `GOOGLE_SERVICE_ACCOUNT_KEY` para o `.env`

## Variáveis de ambiente

Veja `.env.example` para todas as variáveis necessárias.

Chave obrigatória:
- `ADMIN_KEY` — senha para acessar o painel admin (qualquer string)

## Rodar localmente

```bash
npm run dev
# Painel admin: http://localhost:3001/admin
```

## Deploy na VPS

```bash
npm install
pm2 start ecosystem.config.js
pm2 save
```

## Painel Admin

Acesse `http://seudominio.com/admin` e use a `ADMIN_KEY` configurada no `.env`.

Funcionalidades:
- Cadastro de clientes (nome, WhatsApp, email, CNPJ, serviço/valor padrão)
- Acompanhamento de todas as solicitações com status
- Forçar verificação do Drive manualmente
- Atualizar status de qualquer solicitação

## Conversa com o cliente

O bot entende linguagem natural. Exemplos que funcionam:
- "preciso de nota"
- "quero solicitar nota fiscal"
- "me manda a NF do mês"
- "1" (menu)

O Claude Haiku classifica a intenção automaticamente.

## Estrutura

```
src/
├── index.js              # Servidor Express
├── bot/
│   ├── handler.js        # Lógica principal do bot
│   └── templates.js      # Mensagens do WhatsApp
├── services/
│   ├── supabase.js       # Banco de dados
│   ├── whatsapp.js       # Evolution API
│   ├── drive.js          # Google Drive watcher
│   └── email.js          # Nodemailer
├── routes/
│   ├── webhook.js        # Webhook Evolution API
│   └── admin.js          # API do painel admin
└── admin/
    └── index.html        # Painel admin
```
