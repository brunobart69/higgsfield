# JB RENT PRO — Instalação e configuração

## 1. Serviços necessários

| Serviço | Para quê | Plano |
|---|---|---|
| **Supabase** (supabase.com) | Banco PostgreSQL, autenticação, armazenamento de arquivos | Free para testes; **Pro** recomendado em produção (backups diários, sem pausa por inatividade). Escolha a região **EU (Frankfurt ou Paris)** por RGPD |
| **Vercel** (vercel.com) | Hospedagem do site/PWA | Hobby para testes; Pro para uso comercial |
| **GitHub** | Código‑fonte e deploy automático na Vercel | — |
| Provedor de e‑mail SMTP (opcional, recomendado) | Envio dos e‑mails de recuperação de senha/convite com o seu domínio (ex.: Resend, Brevo, Amazon SES) | O SMTP padrão do Supabase tem limite baixo de envios |

## 2. Chaves e variáveis

Todas ficam em **Supabase → Project Settings → API / API Keys**.

| Variável | Onde obter | Onde usar | Pode ir ao navegador? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | "Project URL" (`https://xxxx.supabase.co`) | `.env.local` e Vercel | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave **anon** (legacy) ou **publishable** (`sb_publishable_…`) | `.env.local` e Vercel | Sim — é pública por design; a proteção é a RLS |
| `NEXT_PUBLIC_SITE_URL` | URL do seu site (ex.: `https://app.jbrent.es`) | `.env.local` e Vercel | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | chave **service_role** (legacy) ou **secret** (`sb_secret_…`) | **Somente** no servidor: Vercel e `.env.local` | **NUNCA**. Ignora a RLS. Não compartilhe, não commite |

> A chave service_role é usada **apenas** para convidar usuários e bloquear/desbloquear o login de
> contas desativadas, sempre depois de o servidor confirmar que quem pede é o administrador principal.
> Sem ela o sistema funciona normalmente, mas o botão **Convidar usuário** fica desativado.
> Não envie essa chave por chat; cadastre‑a diretamente na Vercel.

## 3. Passo a passo — Supabase

1. Crie o projeto (região EU). Guarde a senha do banco num gerenciador de senhas.
2. **Authentication → Sign In / Providers → Email**: mantenha *Email* ativo e **desative "Allow new users
   to sign up"** (somente convites).
3. **Authentication → URL Configuration**: *Site URL* = sua URL; em *Redirect URLs* adicione
   `https://SEU-DOMINIO/auth/confirm` e `http://localhost:3000/auth/confirm`.
4. **Authentication → Email Templates**: troque o link dos modelos por (recomendado para SSR; o
   fluxo `?code=` também é aceito):
   - **Reset Password**
     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
     ```
   - **Invite user**
     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password
     ```
   - **Magic Link** (área do cliente — o cliente entra com o **código** do e-mail; o link também funciona):
     ```
     Seu código de acesso: {{ .Token }}
     Ou entre pelo link: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/portal
     ```
     O mesmo endereço `https://SEU-DOMINIO/auth/confirm` já está nas *Redirect URLs*. A ativação do acesso
     de cada cliente (ficha do cliente → Área do cliente) usa a `SUPABASE_SERVICE_ROLE_KEY` já configurada.
     Para volume real de e-mails, configure um SMTP próprio em *Authentication → SMTP Settings* (o envio
     padrão do Supabase tem limite baixo por hora).
     O convidado abre o link e define a própria senha.
5. Aplique as migrations **em ordem** — escolha uma opção:
   - **SQL Editor**: execute, nesta ordem, os arquivos de `supabase/migrations/`
     (`20261103000001_core_schema.sql`, `20261104000001_users_settings.sql`,
     `20261105000001_vehicles_customers.sql`, `20261106000001_rentals.sql`, `20261107000001_inspections_damages.sql`,
     `20261108000001_insurance_documents.sql`, `20261109000001_finance_categories.sql`,
     `20261109000002_maintenance_fines_accidents.sql`, `20261110000001_finance_enums.sql`,
     `20261110000002_finance.sql`, `20261111000001_calendar_notifications_portal.sql`,
     `20261112000001_hardening.sql`); ou
   - **CLI**: `npx supabase login && npx supabase link --project-ref SEU_REF && npx supabase db push`.
6. Crie o **administrador principal**: *Authentication → Users → Add user → Create new user* (e‑mail +
   senha, marque *Auto Confirm*). O primeiro usuário vira automaticamente "Administrador principal" e cria
   a empresa "JB RENT" (altere o nome em **Administração → Configurações**).
7. Entre no sistema como administrador principal e, em **Administração → Usuários → Convidar usuário**,
   convide o segundo administrador (requer `SUPABASE_SERVICE_ROLE_KEY`). Depois complete
   **Administração → Configurações** (empresa, fiscal, preços padrão, contrato, taxas, logotipo).
8. (Opcional) **Project Settings → Authentication → SMTP**: configure seu provedor de e‑mail.

## 4. Desenvolvimento local

```bash
cd jb-rent-pro
cp .env.example .env.local      # preencha URL e ANON KEY
npm install
npm run dev                     # http://localhost:3000
```

Sem as variáveis o app abre a tela **/setup** explicando o que falta.

### Testes

```bash
npm test          # unitários + verificações estáticas de segurança (guardas, segredos, rotas)
npm run typecheck
npm run lint
npm run test:db   # migrations + RLS + conflitos + cálculos num PostgreSQL local descartável
                  # (requer psql/createdb; ex.: PGTEST_SUPERUSER=postgres npm run test:db)
                  # inclui a auditoria de segurança do banco (RLS, anon, SECURITY DEFINER)
npm run test:e2e  # build com Supabase simulado + navegação real por todas as telas (computador e
                  # celular): erros de página, rolagem horizontal, rotas protegidas, CSV/PDF.
                  # Requer Playwright + Chromium (npm i -D playwright && npx playwright install chromium)
```

## 5. Publicação na Vercel

1. *Add New → Project* → importe o repositório.
2. **Root Directory**: `jb-rent-pro`. Framework: Next.js (detectado). Node 20 ou superior.
3. *Settings → Functions → Region*: escolha uma região da UE (ex.: **Frankfurt `fra1`**) — mais perto do
   Supabase e adequado ao RGPD.
4. *Environment Variables*:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` → Production e Preview.
   - `SUPABASE_SERVICE_ROLE_KEY` → **somente Production** (e Preview apenas se usar um projeto Supabase de
     testes). Marque como *Sensitive*. Cadastre você mesmo, nunca por chat.
5. Deploy. Configure o domínio (*Settings → Domains*), atualize `NEXT_PUBLIC_SITE_URL` e, no Supabase,
   *Site URL* e *Redirect URLs* (`https://SEU-DOMINIO/auth/confirm`). Faça um novo deploy.
6. Primeiro acesso: crie o administrador principal (passo 6 da seção 3), entre, complete **Configurações** e
   convide o segundo administrador. Teste: login, recuperação de senha, uma reserva completa (entrega,
   devolução, pagamento, caução), contrato em PDF, envio de documento e a área do cliente com um cliente
   de teste.
7. Siga o **checklist de publicação** em [docs/SECURITY.md](SECURITY.md#7-checklist-antes-de-publicar).

### Atualizações

- Novas versões: merge na branch de produção → a Vercel publica sozinha. Migrations novas: aplique no
  Supabase **antes** do deploy (são aditivas e compatíveis com a versão anterior).
- Antes de cada atualização: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:db`,
  `npm run test:e2e` e `npm audit`.

## 6. Instalar como aplicativo (PWA)

- **Android (Chrome)**: menu ⋮ → *Instalar aplicativo*.
- **iPhone (Safari)**: Compartilhar → *Adicionar à Tela de Início*.

## 7. Backups e retenção

- Plano Pro: backups diários automáticos (7 dias). Para mais segurança, ative PITR ou agende
  `pg_dump` semanal para um armazenamento europeu.
- Defina com o assessor jurídico/fiscal os prazos de retenção de contratos, faturas e documentos
  pessoais e configure-os em **Configurações**; a central de documentos aplica o prazo
  (`retention_until`) e só permite excluir depois dele.
- Exportações periódicas para o contador: **Relatórios** → CSV/PDF (lançamentos, resultado, contratos…).
