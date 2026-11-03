# JB RENT PRO — Segurança, privacidade e aspectos legais

Resultado da revisão de segurança da Fase 10. As verificações marcadas com 🔁 rodam
automaticamente em `npm test` e `npm run test:db`.

## 1. Modelo de acesso

| Quem | Como entra | O que vê |
|---|---|---|
| Administrador principal (`owner`) | e‑mail + senha | Tudo da própria empresa; usuários, configurações, exclusões após retenção, venda de veículos, saldo inicial de caixa |
| Administrador (`admin`) | e‑mail + senha (convite) | Operação, frota, finanças da própria empresa |
| Cliente (área do cliente) | código de uso único no e‑mail (sem senha; só e‑mails ativados pela empresa) | Apenas os próprios contratos, pagamentos, cauções, documentos, multas e solicitações |
| Anônimo | — | Telas de login/recuperação e `/setup` |

- **Isolamento por empresa**: toda tabela tem RLS 🔁; `company_id` vem de `app.current_company_id()`
  (perfil ativo do usuário), nunca do navegador.
- **Equipe × portal**: a conta do cliente é criada sem `company_id` no `app_metadata`, então nunca vira
  perfil da equipe; o banco impede uma mesma conta nos dois papéis (`PORTAL_STAFF_CONFLICT`). Os dados do
  portal saem só de funções `portal_*` que filtram pelo próprio cliente 🔁.
- **Server Actions** verificam sessão e cargo (`requireStaff`/`requireOwner`) antes de qualquer acesso 🔁;
  as do portal usam somente funções do portal 🔁. **Rotas de API** exigem sessão da equipe ou posse
  verificada no banco 🔁.
- **Desativação** de usuário: `profiles.is_active = false` + bloqueio de login no Auth; o cliente do portal
  é desativado por `disabled_at` (e automaticamente ao anonimizar).

## 2. Segredos

- `SUPABASE_SERVICE_ROLE_KEY` só existe no servidor (Vercel), é lida apenas em
  `src/lib/supabase/admin.ts` (`server-only`) 🔁 e usada em três pontos revisados 🔁:
  convites/bloqueio de usuários (administrador principal), ativação da área do cliente e contrato em PDF
  do portal (somente depois de `portal_owns_rental` confirmar a posse).
- Nenhuma variável `NEXT_PUBLIC_*` contém segredo 🔁; componentes do navegador não importam módulos de
  servidor 🔁. A chave anon/publishable é pública por design — a proteção é a RLS.
- Nunca envie chaves por chat ou e‑mail; cadastre‑as direto na Vercel. Se uma chave vazar, gere outra em
  Supabase → API Keys e atualize a Vercel.

## 3. Banco de dados

- RLS em 100% das tabelas; o papel `anon` não tem privilégio em tabelas nem execução de funções 🔁.
- Funções `SECURITY DEFINER` com `search_path` fixo 🔁; a busca de usuário por e‑mail só é executável
  pela chave de serviço 🔁.
- Exclusão definitiva bloqueada em contratos, financeiro, apólices, documentos, manutenções, multas e
  sinistros 🔁 — arquivar em vez de excluir. Documentos só são excluídos pelo administrador principal
  depois do prazo de retenção (`purge_document`).
- Lançamentos automáticos não podem ser alterados à mão; valores e conflitos de reserva são calculados e
  validados no banco (restrição de exclusão para reservas sobrepostas).
- Auditoria: inclusões, alterações e exclusões ficam em `activity_logs` com usuário, data e diferenças;
  acessos (IP e navegador), aberturas de documentos pessoais (também pelo portal) e exportações de
  relatórios são registrados.

## 4. Aplicação e navegador

- Cabeçalhos: HSTS (2 anos, preload), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (câmera só no próprio site, para as inspeções).
- Arquivos em bucket **privado**, por empresa; abertos por link assinado de 60 s; o servidor confere tipo
  real (assinatura do arquivo) e tamanho de cada envio.
- CSV exportado neutraliza fórmulas (`=`, `+`, `-`, `@`) para evitar injeção em planilhas 🔁.
- Login por senha com limite de tentativas do Supabase Auth; código do portal com `shouldCreateUser: false`
  e resposta idêntica para e‑mails existentes ou não (não revela cadastros).
- Service worker não guarda páginas nem respostas de API.
- Dependências: `npm audit --omit=dev` (o que vai para produção) **sem vulnerabilidades** — o PostCSS
  embutido no Next foi fixado na versão corrigida via `overrides`. Resta um alerta moderado
  (`minimatch`) apenas nas ferramentas de desenvolvimento (ESLint), que não são publicadas; será
  resolvido quando o ESLint atualizar a dependência. Rode `npm audit` a cada atualização.

## 5. Privacidade (RGPD)

- Hospede Supabase na **região UE** e mantenha Vercel com funções na UE (região `fra1` ou `cdg1`).
  Assine os DPAs (acordos de tratamento de dados) da Supabase e da Vercel.
- Base legal e informação ao cliente registradas (`gdpr_consent_at`); consentimento de marketing separado.
- Direitos: anonimização do cliente (apaga dados pessoais e documentos, mantém valores exigidos pela
  contabilidade e encerra o acesso ao portal); exportação dos dados do cliente pelos relatórios e pela ficha.
- Retenção: prazo configurável em **Configurações**; exclusão definitiva só após o prazo.
- Mantenha um **Registro de Atividades de Tratamento** (art. 30 RGPD) e uma política de privacidade no
  site/contrato. Em caso de incidente com dados pessoais, a notificação à AEPD deve ocorrer em até 72 h.

## 6. Aspectos legais e fiscais (não presumidos)

O sistema **não presume regras fiscais**. Defina com o seu gestor/assessor:

- **IVA**: taxa padrão e por lançamento são configuráveis; preços com ou sem IVA conforme a configuração.
- **Faturas**: o JB RENT PRO é um sistema de **gestão**; o contrato e os recibos não substituem a fatura
  oficial. A emissão de faturas na Espanha está sujeita ao Regulamento de faturação e às exigências de
  sistemas de faturação (Lei Antifraude / VERI*FACTU; TicketBAI no País Basco). Use um software de
  faturação certificado ou valide com o assessor antes de emitir faturas a partir deste sistema.
- **Multas**: prazos de identificação do condutor, descontos e recursos seguem a notificação oficial; a
  repercussão de multas e taxas de gestão ao cliente deve estar prevista no contrato.
- **Contrato**: revise as condições gerais (PT/ES) em Configurações com um advogado; a assinatura no
  sistema é manuscrita digitalizada (para assinatura eletrônica qualificada, integre um prestador eIDAS).
- **Seguro**: confirme com a seguradora prazos de comunicação de sinistros e franquias.

## 7. Checklist antes de publicar

- [ ] Migrations aplicadas em ordem (docs/SETUP.md) e `npm run test:db` verde num banco de teste.
- [ ] "Allow new users to sign up" **desativado** no Supabase.
- [ ] Modelos de e‑mail (recuperação, convite, Magic Link com `{{ .Token }}`) ajustados; SMTP próprio.
- [ ] `NEXT_PUBLIC_SITE_URL` = domínio final; *Site URL* e *Redirect URLs* atualizados no Supabase.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` só na Vercel (Production), sem `NEXT_PUBLIC_`.
- [ ] Senha forte e única para o administrador principal; MFA na conta Supabase e Vercel.
- [ ] Backups/PITR ativos no Supabase (plano Pro) e teste de restauração feito.
- [ ] Configurações da empresa, IVA, retenção e condições do contrato revisadas com o assessor.
