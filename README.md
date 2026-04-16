# NF Bot — Automação de Notas Fiscais via WhatsApp

Bot de WhatsApp para automatizar o fluxo completo de solicitação e entrega de notas fiscais entre clientes, equipe interna e contabilidade.

---

## Visão Geral

### Problema resolvido
Antes do bot, o fluxo era manual:
- Cliente lembrava via WhatsApp
- Equipe encaminhava para contabilidade por planilha + WhatsApp
- Contabilidade subia o PDF no Drive
- Equipe enviava o PDF ao cliente por email

### Solução
O cliente manda uma mensagem no WhatsApp → o bot faz tudo automaticamente.

### Fluxo completo
```
Cliente manda msg no WhatsApp
        ↓
Bot identifica o cliente pelo número
        ↓
Bot confirma: serviço, valor, CNPJ, referência
        ↓
Cliente confirma → solicitação criada no banco
        ↓
Contabilidade recebe notificação (WhatsApp + email)
        ↓
Contabilidade gera NF e sobe PDF no Google Drive
        ↓
Bot detecta o PDF automaticamente (polling a cada 2 min)
        ↓
Bot envia PDF ao cliente por email
        ↓
Bot avisa cliente no WhatsApp ✅
```

---

## Stack

| Componente | Tecnologia |
|------------|-----------|
| Runtime | Node.js |
| Framework | Express |
| Banco de dados | Supabase (PostgreSQL) |
| WhatsApp API | Evolution API v2 (self-hosted) |
| IA (intenção) | Claude Haiku (Anthropic) |
| Google Drive | Google Drive API (Service Account) |
| Email | Nodemailer + Gmail SMTP |
| Agendamento | node-cron |
| Process manager | PM2 |
| Infraestrutura | VPS Oracle Cloud (Ubuntu 22.04) |

---

## Estrutura do Projeto

```
nf-bot/
├── src/
│   ├── index.js                  # Servidor Express (porta 3001)
│   ├── bot/
│   │   ├── handler.js            # Máquina de estados da conversa + IA
│   │   └── templates.js          # Todas as mensagens do WhatsApp
│   ├── services/
│   │   ├── supabase.js           # Operações no banco de dados
│   │   ├── whatsapp.js           # Integração Evolution API
│   │   ├── drive.js              # Google Drive watcher (polling)
│   │   └── email.js              # Nodemailer (notificação + entrega)
│   ├── routes/
│   │   ├── webhook.js            # Recebe eventos da Evolution API
│   │   └── admin.js              # API REST do painel admin
│   └── admin/
│       └── index.html            # Painel admin (HTML puro)
├── supabase/
│   └── 001_schema.sql            # Schema completo do banco
├── ecosystem.config.js           # Configuração PM2
├── .env.example                  # Variáveis necessárias
└── .gitignore
```

---

## Banco de Dados (Supabase)

### Tabelas

**`clients`** — Cadastro de clientes
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| name | text | Nome completo ou empresa |
| whatsapp | text | Número (só dígitos, ex: 5511999999999) |
| email | text | Email para receber a NF |
| cnpj | text | CNPJ do cliente |
| cpf | text | CPF (pessoa física) |
| company | text | Razão social |
| default_service | text | Serviço padrão (ex: Gestão de Tráfego) |
| default_value | numeric | Valor mensal padrão |
| active | boolean | Ativo/inativo |

**`nf_requests`** — Solicitações de nota fiscal
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | uuid | PK |
| client_id | uuid | FK → clients |
| service | text | Serviço da nota |
| value | numeric | Valor |
| document | text | CNPJ ou CPF usado |
| reference | text | Mês de referência (ex: Abril/2026) |
| status | text | pending → sent → processing → issued → delivered |
| drive_file_id | text | ID do arquivo no Google Drive |
| drive_file_url | text | Link do PDF |
| notified_at | timestamptz | Quando contabilidade foi notificada |
| issued_at | timestamptz | Quando PDF apareceu no Drive |
| delivered_at | timestamptz | Quando email foi enviado ao cliente |

**`conversation_states`** — Estado atual de cada conversa
| Campo | Tipo | Descrição |
|-------|------|-----------|
| whatsapp | text | PK — número do cliente |
| state | text | idle / awaiting_service / awaiting_value / awaiting_reference / awaiting_confirmation |
| context | jsonb | Dados parciais da solicitação em andamento |

**`wpp_messages`** — Histórico de mensagens
| Campo | Tipo | Descrição |
|-------|------|-----------|
| whatsapp | text | Número |
| direction | text | in / out |
| body | text | Conteúdo da mensagem |

---

## Configuração do Ambiente

### Variáveis de ambiente (`.env`)

```env
# Servidor
PORT=3001

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=sua_service_role_key

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=429683C4C977415CAAFCCE10F7D57E11
EVOLUTION_INSTANCE=nf-bot

# Contabilidade
CONTABILIDADE_PHONE=5511999999999
CONTABILIDADE_EMAIL=contabilidade@empresa.com

# Claude AI
ANTHROPIC_API_KEY=sk-ant-...

# Google Drive
GOOGLE_SERVICE_ACCOUNT_EMAIL=bot@projeto.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
DRIVE_FOLDER_ID=1AbCdEfGhIjKlMnOpQrStUv

# Email Gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu@gmail.com
SMTP_PASS=senha_de_app_16_chars
EMAIL_FROM="NDD Estudio <seu@gmail.com>"

# Webhook
WEBHOOK_URL=http://172.18.0.1:3001

# Painel admin
ADMIN_KEY=sua_senha_aqui
```

---

## Infraestrutura na VPS

### VPS
- **Provedor:** Oracle Cloud
- **IP:** 136.248.126.144
- **OS:** Ubuntu 22.04
- **Usuário:** ubuntu

### Acesso SSH
```bash
ssh -i "ssh-key-2026-04-06.key" ubuntu@136.248.126.144
```

### Acesso com tunnel (painel local)
```bash
ssh -i "ssh-key-2026-04-06.key" \
  -L 8080:127.0.0.1:8080 \
  -L 3001:127.0.0.1:3001 \
  -L 3002:127.0.0.1:3002 \
  ubuntu@136.248.126.144
```

Acessos locais após tunnel:
- Painel NF Bot: `http://localhost:3001/admin`
- Evolution API: `http://localhost:8080/manager`
- Evolution Manager: `http://localhost:3002`

---

## Evolution API (WhatsApp)

### Instalação
Localização: `~/evolution-api/`
Rodando via Docker Compose.

### Containers
| Container | Imagem | Porta |
|-----------|--------|-------|
| evolution_api | evoapicloud/evolution-api:latest | 127.0.0.1:8080 |
| evolution_postgres | postgres:15 | interno |
| evolution_redis | redis:latest | interno |
| evolution_frontend | evoapicloud/evolution-manager:latest | 3002 |

### Credenciais
- **API Key:** `429683C4C977415CAAFCCE10F7D57E11`
- **Instância:** `nf-bot`
- **Status:** conectada (número: 5511947224569)

### Comandos úteis
```bash
cd ~/evolution-api

# Ver status
docker compose ps

# Ver logs da API
docker logs evolution_api --tail 30

# Reiniciar
docker compose restart api

# Parar tudo
docker compose down

# Subir tudo
docker compose up -d
```

### Configuração importante no .env
```env
DATABASE_CONNECTION_URI='postgresql://evolution:evolution123@evolution-postgres:5432/evolution_db?schema=evolution_api'
CACHE_REDIS_URI=redis://evolution_redis:6379/6
POSTGRES_DATABASE=evolution_db
POSTGRES_USERNAME=evolution
POSTGRES_PASSWORD=evolution123
```

> **Atenção:** O hostname do postgres deve ser `evolution-postgres` (nome do serviço no docker-compose), não `postgres`.

---

## NF Bot

### Instalação
Localização: `~/nf-bot/`
Rodando via PM2.

### Comandos PM2
```bash
# Ver status
pm2 status

# Ver logs
pm2 logs nf-bot

# Iniciar
pm2 start nf-bot

# Parar
pm2 stop nf-bot

# Reiniciar (com reload de env)
pm2 restart nf-bot --update-env

# Atualizar código
cd ~/nf-bot && git pull && pm2 restart nf-bot --update-env
```

### Webhook
A Evolution API envia eventos para: `http://172.18.0.1:3001/webhook/whatsapp`

> O IP `172.18.0.1` é o gateway da rede Docker `evolution-net`, que permite ao container Evolution alcançar o nf-bot rodando no host.

---

## Bot — Fluxo de Conversa

### Estados da máquina
```
idle
  ↓ (cliente diz "preciso de nota" ou "1")
awaiting_service      ← se não tem serviço padrão
  ↓
awaiting_value        ← se não tem valor padrão
  ↓
awaiting_reference    ← mês de referência
  ↓
awaiting_confirmation ← mostra resumo e pede confirmação
  ↓
[cria solicitação + notifica contabilidade]
idle
```

### Exemplo de conversa
```
Cliente: preciso de nota fiscal
Bot: Confirme sua solicitação:
     Cliente: João Silva
     Serviço: Gestão de Tráfego
     Valor: R$ 2.500,00
     CNPJ: 12.345.678/0001-99
     Referência: Abril/2026
     Está correto? (sim/não)

Cliente: sim
Bot: Solicitação enviada! Prazo estimado: 2 dias úteis.
     Vou te avisar quando estiver pronta.

[Contabilidade sobe PDF no Drive]

Bot: Sua nota fiscal está pronta! Enviamos o PDF para seu email.
```

---

## Painel Admin

Acesso: `http://localhost:3001/admin` (via tunnel SSH)
Senha: definida em `ADMIN_KEY` no `.env`

### Funcionalidades
- **Clientes:** cadastrar, editar, desativar
- **Solicitações:** ver todas com status, atualizar manualmente
- **Drive:** forçar verificação manual
- **Stats:** contadores por status

---

## Gmail — Configuração SMTP

Usa senha de app (não a senha normal da conta).

Para gerar: `https://myaccount.google.com/apppasswords`

Requisito: verificação em duas etapas ativada na conta Google.

---

## Google Drive — Configuração Pendente

Para ativar o watcher de PDFs:

1. Acesse Google Cloud Console → novo projeto
2. Ative a **Google Drive API**
3. Crie uma **Service Account**
4. Baixe a chave JSON
5. Compartilhe a pasta do Drive com o email da service account
6. Preencha no `.env`:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_KEY`
   - `DRIVE_FOLDER_ID` (ID da pasta da contabilidade)

---

## Próximos Passos

- [ ] Cadastrar os 20 clientes no painel admin
- [ ] Configurar Google Drive (service account + pasta)
- [ ] Testar fluxo completo com cliente real
- [ ] Configurar domínio/nginx para acesso sem tunnel SSH
- [ ] Definir padrão de nome de arquivo para o Drive (facilitar associação automática)
