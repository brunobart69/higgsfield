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
| `SUPABASE_SERVICE_ROLE_KEY` | chave **service_role** (legacy) ou **secret** (`sb_secret_…`) | **Somente** Vercel (servidor). Necessária a partir da Fase 2 | **NUNCA**. Ignora a RLS. Não compartilhe, não commite |

> Para a Fase 1 bastam as três primeiras. Não envie a chave service_role por chat; cadastre‑a
> diretamente na Vercel quando chegarmos à Fase 2.

## 3. Passo a passo — Supabase

1. Crie o projeto (região EU). Guarde a senha do banco num gerenciador de senhas.
2. **Authentication → Sign In / Providers → Email**: mantenha *Email* ativo e **desative "Allow new users
   to sign up"** (somente convites).
3. **Authentication → URL Configuration**: *Site URL* = sua URL; em *Redirect URLs* adicione
   `https://SEU-DOMINIO/auth/confirm` e `http://localhost:3000/auth/confirm`.
4. **Authentication → Email Templates → Reset Password**: troque o link por
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
   ```
   (recomendado para SSR; o fluxo `?code=` também é aceito).
5. Aplique a migration — escolha uma opção:
   - **SQL Editor**: cole e execute `supabase/migrations/20261103000001_core_schema.sql`; ou
   - **CLI**: `npx supabase login && npx supabase link --project-ref SEU_REF && npx supabase db push`.
6. Crie o **administrador principal**: *Authentication → Users → Add user → Create new user* (e‑mail +
   senha, marque *Auto Confirm*). O primeiro usuário vira automaticamente "Administrador principal" e cria
   a empresa "JB RENT" (o nome poderá ser alterado nas Configurações, Fase 2; até lá via SQL:
   `update companies set name = 'JB RENT S.L.';`).
7. (Até a Fase 2) segundo administrador: crie o usuário e execute no SQL Editor:
   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data
          || jsonb_build_object('company_id', (select id from public.companies limit 1), 'role', 'admin')
    where email = 'segundo@exemplo.com';
   insert into public.profiles (id, company_id, role, email)
   select id, (raw_app_meta_data->>'company_id')::uuid, 'admin', email
     from auth.users where email = 'segundo@exemplo.com';
   ```
   Na Fase 2 isso será feito pela tela **Usuários → Convidar**.
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
npm test          # unitários: períodos/fuso, dinheiro, formatação, traduções, validação
npm run typecheck
npm run lint
npm run test:db   # migrations + RLS + conflitos + cálculos num PostgreSQL local descartável
                  # (requer psql/createdb; ex.: PGTEST_SUPERUSER=postgres npm run test:db)
```

## 5. Publicação na Vercel

1. *Add New → Project* → importe o repositório.
2. **Root Directory**: `jb-rent-pro`. Framework: Next.js (detectado).
3. *Environment Variables*: as três `NEXT_PUBLIC_*` (Production e Preview).
4. Deploy. Depois, configure o domínio e atualize *Site URL* / *Redirect URLs* no Supabase.

## 6. Instalar como aplicativo (PWA)

- **Android (Chrome)**: menu ⋮ → *Instalar aplicativo*.
- **iPhone (Safari)**: Compartilhar → *Adicionar à Tela de Início*.

## 7. Backups e retenção

- Plano Pro: backups diários automáticos (7 dias). Para mais segurança, ative PITR ou agende
  `pg_dump` semanal para um armazenamento europeu.
- Defina com o assessor jurídico/fiscal os prazos de retenção de contratos, faturas e documentos
  pessoais; o campo `documents.retention_until` já existe para aplicá‑los.
