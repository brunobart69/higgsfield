# JB RENT PRO — Arquitetura

> Sua frota, seu patrimônio, seu controle.

## 1. Visão geral

```
┌───────────────────────────── Navegador / PWA (Android, iPhone, desktop) ─────────────────────────────┐
│  Next.js (React 19, App Router) · Tailwind 4 · componentes estilo shadcn/ui · Recharts · Lucide      │
└───────────────┬──────────────────────────────────────────────────────────────────────────────────────┘
                │ HTTPS (cookies de sessão httpOnly via @supabase/ssr)
┌───────────────▼──────────────────────────── Vercel ──────────────────────────────────────────────────┐
│  middleware.ts      → renova sessão e protege rotas                                                  │
│  Server Components  → leem dados com o JWT do usuário (RLS aplicada)                                 │
│  Server Actions     → login, senha, idioma (validação zod) … e, nas próximas fases, todos os CRUDs   │
│  Route Handlers     → /auth/confirm, /auth/signout, (fase 4+) geração de PDF                         │
│  service_role       → SOMENTE no servidor, apenas para convidar usuários (fase 2)                    │
└───────────────┬──────────────────────────────────────────────────────────────────────────────────────┘
                │ PostgREST / Auth / Storage
┌───────────────▼──────────────────────────── Supabase ────────────────────────────────────────────────┐
│  Auth (e-mail + senha, recuperação, convites)                                                        │
│  PostgreSQL 15+  · RLS em todas as tabelas · triggers de auditoria · EXCLUDE anti‑sobreposição       │
│  RPCs SECURITY INVOKER para indicadores (cálculo em NUMERIC dentro do banco)                         │
│  Storage: bucket privado "documents" (links temporários assinados)                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Princípios**

1. **O banco é a fonte da verdade e a última linha de defesa.** Permissões (RLS), conflitos de reserva
   (constraint `EXCLUDE`), disponibilidade do veículo, proibição de exclusão definitiva e auditoria são
   impostos no PostgreSQL — nenhuma regra crítica depende apenas do frontend.
2. **Dinheiro nunca é float.** Colunas `numeric(12,2)`; somatórios em SQL; no TypeScript, aritmética em
   centavos inteiros (`src/lib/money.ts`).
3. **Competência × caixa.** `competence_date` (regime de competência) e `paid_at` (fluxo de caixa) em
   cada lançamento. Cauções ficam em tabela própria e **nunca** entram em receita. Compra de veículo é
   categoria `vehicle_purchase` → `is_operational = false` (investimento, não despesa operacional).
4. **Arquivar em vez de excluir.** Todas as entidades têm `archived_at`. Contratos e lançamentos
   financeiros só podem ser excluídos pelo administrador principal com autorização explícita na transação.
5. **Multiempresa desde o início.** Toda tabela tem `company_id`; preparado para filiais.
6. **Regional fixo da operação:** EUR, `Europe/Madrid`, `DD/MM/YYYY`, 24h — independente do idioma.

## 2. Estrutura de pastas

```
jb-rent-pro/
├── docs/                      Arquitetura, instalação, roadmap
├── public/                    Ícones do PWA, service worker (sw.js)
├── scripts/generate-icons.mjs Gera PNGs do PWA a partir do SVG
├── supabase/
│   ├── migrations/            SQL versionado (timestamp_nome.sql)
│   └── tests/                 Testes de banco (RLS, conflitos, cálculos) + stubs do Supabase
├── tests/                     Testes unitários (Vitest)
└── src/
    ├── middleware.ts          Sessão + proteção de rotas
    ├── app/
    │   ├── (auth)/            login, forgot-password, reset-password, actions.ts
    │   ├── (app)/             Painel autenticado (layout com menu) → dashboard, account, …
    │   ├── auth/confirm       Callback dos links de e-mail
    │   ├── auth/signout       Logout (POST)
    │   ├── setup/             Aviso enquanto o Supabase não está configurado
    │   └── manifest.ts        Manifesto do PWA
    ├── components/
    │   ├── ui/                Primitivos (button, card, input, dropdown, sheet, …)
    │   ├── brand/             Logotipo
    │   ├── layout/            AppShell, menu lateral, navegação móvel, idioma, usuário
    │   └── dashboard/         KPIs, filtros de período, gráficos, alertas
    └── lib/
        ├── supabase/          Clientes browser/server/middleware
        ├── i18n/              Config, dicionários pt-BR/es-ES, provider, actions
        ├── auth/              Sessão/perfil e validação (zod)
        ├── dashboard/         Consultas (RPCs)
        ├── format.ts          Moeda, datas, horários
        ├── periods.ts         Filtros de período em Europe/Madrid
        └── money.ts           Aritmética monetária exata
```

Futuros módulos seguem o mesmo padrão: `src/app/(app)/<modulo>/` (páginas + `actions.ts`),
`src/components/<modulo>/`, `src/lib/<modulo>/` (consultas + schemas zod) e uma migration nova.

## 3. Banco de dados

### 3.1 Tabelas (✅ = criada na migration 0001; demais nas fases indicadas)

| Tabela | Fase | Finalidade |
|---|---|---|
| `auth.users` | Supabase | Credenciais (gerenciadas pelo Supabase Auth). Equivale a `users` |
| ✅ `companies` | 1 | Empresa/filial: dados fiscais, idioma, moeda, IVA, `settings` jsonb |
| ✅ `profiles` | 1 | 1:1 com `auth.users`: empresa, cargo (`owner`/`admin`), idioma, ativo |
| ✅ `activity_logs` | 1 | Auditoria: quem fez o quê (insert/update/delete/login) com diff |
| ✅ `vehicles` | 1 (CRUD na 3) | Frota: identificação, operação, preços, ITV, status |
| ✅ `vehicle_valuations` | 1 (UI na 8) | Histórico de valor de mercado → evolução patrimonial |
| ✅ `customers` | 1 (CRUD na 3) | Pessoa física / jurídica, consentimento RGPD |
| ✅ `rentals` | 1 (CRUD na 4) | Reservas e contratos, preços, quilometragem, combustível, assinatura |
| ✅ `reservations` (view) | 1 | Visão de `rentals` com status `reservation` (uma tabela só = uma regra de conflito) |
| ✅ `insurance_policies` | 1 (UI na 6) | Apólices, renovações (`renewed_from_id`) |
| ✅ `documents` | 1 (UI na 6) | Metadados de arquivos no Storage, validade e retenção |
| ✅ `financial_transactions` | 1 (UI na 8) | Receitas/despesas, competência e caixa, comprovante |
| ✅ `fee_catalog` | 2 | Catálogo de taxas adicionais (por aluguel / por dia, IVA opcional) |
| ✅ `branches` | 2 (UI futura) | Filiais — estrutura preparada para expansão |
| ✅ `vehicle_photos` | 3 | Fotos (principal, externas, internas, detalhes); uma única principal por veículo |
| ✅ `customer_documents` | 3 | Documentos pessoais (DNI/NIE, carteira, comprovantes) — exclusão só pelo adm. principal |
| ✅ `rental_payments` | 4 | Pagamentos e estornos do contrato (fluxo de caixa); nunca alterados, só anulados com motivo |
| ✅ `rental_extras` | 4 | Extras do contrato (catálogo ou livres), por aluguel ou por dia |
| ✅ `deposits` | 4 | Cauções: recebido, devolvido, retido (com motivo), saldo e situação calculados — **fora da receita** |
| ✅ `inspections` | 5 | Entrega, devolução e periódica; checklist por área (jsonb validado no banco), km, combustível, cliente presente; concluída = evidência imutável |
| ✅ `inspection_photos` | 5 | Fotos por área da inspeção (bloqueadas após a conclusão) |
| ✅ `damages` | 5 | Avarias: área, categoria, gravidade, custos estimado/real, oficina, situação; ligadas a veículo, contrato, cliente e inspeção |
| ✅ `damage_photos` | 5 | Fotos de cada avaria |
| `maintenance_records` | 7 | Preventiva/corretiva, próxima revisão por data/km |
| `fines` | 7 | Multas |
| `accidents` | 7 | Sinistros |
| `notifications` | 9 | Central de notificações (in‑app; e-mail/WhatsApp preparados) |
| `customer_portal_accounts` | 9 | Vínculo usuário‑cliente para a área do cliente |

### 3.2 Relacionamentos principais

```
companies 1─* profiles ─1 auth.users
companies 1─* vehicles 1─* vehicle_valuations
                      1─* insurance_policies ─(renewed_from_id)→ insurance_policies
                      1─* rentals *─1 customers *─1 companies
                      1─* documents   *─0..1 customers / rentals
                      1─* financial_transactions *─0..1 customers / rentals
(fase 4+) rentals 1─* rental_payments, 1─0..1 deposits, 1─* inspections 1─* damages
(fase 7)  vehicles 1─* maintenance_records, fines, accidents
```

Chaves estrangeiras usam `ON DELETE RESTRICT` para tudo que é histórico (contratos, financeiro):
não é possível apagar um veículo ou cliente que tenha histórico — arquiva‑se.

### 3.3 Regras impostas no banco

| Regra | Mecanismo |
|---|---|
| Sem reservas sobrepostas para o mesmo veículo (considerando horário) | `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(pickup_at, return_at, '[)') WITH &&)` para status ativos. Devolução às 10:00 e nova retirada às 10:00 é permitida |
| Não alugar veículo em manutenção/indisponível/vendido/arquivado | trigger `app.validate_rental` |
| Veículo e cliente da mesma empresa do contrato | trigger `app.validate_rental` |
| Matrícula única por empresa (ignora espaços/maiúsculas), VIN único | índices únicos por expressão |
| Categoria compatível com tipo (receita/despesa) | `CHECK` |
| Lançamento pago exige data de pagamento | `CHECK` |
| Proibir exclusão definitiva de contratos/financeiro | trigger `app.prevent_hard_delete` (só proprietário + `app.allow_hard_delete=on`) |
| Quem criou/alterou | `created_by/updated_by/created_at/updated_at` por trigger (não confiam no cliente) |
| Histórico de alterações | trigger `app.log_activity` grava diff jsonb em `activity_logs` |
| Admin não se autopromove; dono não se rebaixa nem se desativa; e-mail do perfil só muda pelo sistema | trigger `app.guard_profile_update` |
| Sempre há ao menos um administrador principal ativo | trigger `app.ensure_active_owner` |
| Perfil de convidado criado só quando o servidor define empresa/cargo em `app_metadata` | trigger `app.handle_user_app_metadata` em `auth.users` |
| Eventos administrativos (convite, link de senha, sessões encerradas, logotipo) com autor | RPC `log_event` (lista fechada de ações) |
| Matrícula, VIN, DNI/NIE, CIF e e-mail normalizados; documento e CIF únicos por empresa | triggers `app.normalize_vehicle` / `app.normalize_customer` + índices únicos |
| Quilometragem não diminui (só o adm. principal corrige) | trigger `app.normalize_vehicle` |
| Arquivos sempre na pasta `<empresa>/<entidade>/<id>/…` | `CHECK` em `vehicle_photos`, `customer_documents` e `documents` |
| RGPD: anonimização apaga dados pessoais, documentos e os dados pessoais guardados no histórico | RPC `anonymize_customer` (só adm. principal, sem contratos ativos) |

### 3.4 RLS (Row Level Security)

Funções `SECURITY DEFINER` (`app.current_company_id()`, `app.is_owner()`, `app.is_staff()`) leem o perfil
do usuário autenticado (apenas se `is_active`). Políticas:

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `companies` | equipe da empresa | — (só via sistema) | administrador principal | — |
| `profiles` | equipe da empresa | — (trigger de convite) | o próprio (nome, telefone, idioma) / adm. principal | — |
| `fee_catalog`, `branches` | equipe da empresa | adm. principal | adm. principal | adm. principal |
| `activity_logs` | adm. principal: tudo · admin: só as próprias ações | — (só triggers) | — | — |
| operacionais | equipe da empresa | equipe da empresa | equipe da empresa | adm. principal |
| `vehicle_photos` | equipe | equipe | equipe | equipe (gestão de veículos) |
| `customer_documents` | equipe | equipe | equipe | adm. principal |
| `storage.objects` (bucket `documents`) | pasta `<company_id>/…` | idem | idem | adm. principal; equipe na pasta `vehicles/`; quem enviou pode desfazer o próprio envio |

`anon` não tem nenhum privilégio. Testado em `supabase/tests/001_core_test.sql`.

### 3.5 Indicadores (RPCs)

| Função | Retorno |
|---|---|
| `dashboard_kpis(from, to)` | contagens da frota, receita/despesa/lucro operacional do período (competência, sem cancelados, sem compra de veículo), contratos ativos, devoluções em 7 dias, seguros/documentos/ITV a vencer em 30 dias |
| `dashboard_monthly(from, to)` | por mês: receita, despesa, lucro, ocupação (%) e valor da frota (última avaliação ≤ fim do mês, ou preço de compra) |
| `dashboard_vehicle_performance(from, to)` | por veículo: receita, despesa, lucro, dias alugados, dias disponíveis, ocupação |
| `dashboard_alerts(limit)` | alertas priorizados por gravidade (devolução atrasada/próxima, retirada próxima, seguro, ITV, documentos, pagamentos vencidos) |

**Fórmulas** — Ocupação = dias alugados ÷ dias em que o veículo esteve na frota × 100 (dias civis em
Europe/Madrid, devolução exclusiva). ROI (fase 8) = resultado acumulado ÷ investimento inicial × 100.

### 3.6 Contratos (cálculo no banco)

| Item | Regra (`app.compute_rental`) |
|---|---|
| Dias cobrados | blocos de 24 h desde a retirada, mínimo 1; tolerância configurável em minutos (`companies.rental_grace_minutes`) |
| Valor base | diária × dias; semanal = preço × dias ÷ 7; mensal = preço × dias ÷ 30; personalizado = valor fechado |
| Extras | Σ valor × quantidade × (dias, se "por dia") |
| Km incluída | ilimitada / limite × dias / × semanas iniciadas / × meses iniciados / limite total |
| Km excedente | max(0, rodados − incluídos) × preço por km, calculado na devolução |
| Total | base + outras taxas − desconto + extras + km excedente (desconto ≤ base + taxas) |
| Fluxo de status | reserva → confirmado → em andamento → finalizado; reserva/confirmado → cancelado (com motivo). "Atrasado" é derivado (em andamento e devolução prevista vencida) |
| Entrega / devolução | exigem km e combustível; o veículo passa a "alugado" e volta a "disponível"; a km do veículo é atualizada |
| Contrato fechado | finalizado/cancelado não pode ter valores, período, extras ou partes alterados |
| Financeiro | linhas automáticas em `financial_transactions` (aluguel, extras, km excedente) com competência na data de devolução; ficam "pagas" quando o saldo do contrato zera; reservas não geram receita; cancelamento anula |
| Gravação | `save_rental` grava contrato + extras numa transação (tudo ou nada) |

O formulário mostra uma prévia com as mesmas fórmulas (`src/lib/rentals/calc.ts`), conferidas por testes
contra os mesmos casos do banco. O contrato em PDF (`/api/rentals/<id>/contract?lang=pt-BR|es-ES`) é
gerado no servidor com `pdf-lib`, com logotipo, partes, veículo, período, valores, caução,
quilometragem, combustível, condições cadastradas e campos de assinatura; `rentals.signature_status`
e `signature_provider_ref` preparam a integração futura com assinatura eletrônica.

### 3.7 Inspeções e avarias

- Uma inspeção de entrega e uma de devolução por contrato (índice único); a de devolução só depois da entrega.
- Concluir a **inspeção de entrega** registra a entrega do contrato com a km e o combustível da inspeção
  (o veículo passa a "alugado"). A devolução do contrato continua no fluxo do contrato (km excedente, atraso).
- Inspeção concluída não pode ser alterada nem excluída, nem suas fotos; rascunhos podem ser descartados.
- A **comparação** (`compareInspections`) marca as áreas cujo estado piorou entre entrega e devolução
  (OK → marca leve → avaria) como possível nova avaria, com fotos lado a lado e atalho para registrar a avaria.
- Relatórios em PDF: inspeção (checklist, fotos, avarias, assinaturas) e comparação entrega × devolução.
- Avarias graves (alta/crítica) em aberto geram alerta no dashboard.

### 3.8 Envio de arquivos

```
Navegador ─ reduz fotos para ≤ 2000 px (JPEG) ─► upload direto ao Storage privado (RLS da pasta da empresa)
          ─► Server Action register…() ─► confere prefixo do caminho + lê os primeiros bytes (Range)
               tipo real ∈ {PDF, JPG, PNG} e ≤ 15 MB? ── não ─► apaga o arquivo e mostra o erro
               sim ─► grava os metadados (RLS) ─► auditoria
Abrir/baixar ─► /api/files/<tipo>/<id> ─► RLS confirma o acesso ─► link assinado de 60 s
               (documentos pessoais: cada abertura registrada em activity_logs)
```

O envio direto evita o limite de 4,5 MB do corpo das funções da Vercel.

### 3.9 Seguros e documentos (migration 0006)

- **Apólices**: o banco normaliza o número (maiúsculas), confere se o veículo é da empresa e impede
  duplicidade (mesmo número e início). **Renovação** = nova apólice com `renewed_from_id`; só uma
  renovação ativa por apólice, do mesmo veículo e começando até 31 dias antes do fim da anterior
  (`RENEWAL_MISMATCH`). Apólice renovada deixa de gerar alerta.
- **Prêmio**: lançado automaticamente em `financial_transactions` como despesa "Seguros" do veículo
  (competência = início da vigência; "pago" quando `paid_at` é informado; anulado ao arquivar).
  Apólices não são excluídas, apenas arquivadas.
- **Situação** (`src/lib/insurance/status.ts`): futura, vigente, vencendo (≤ 30 dias, com faixas de
  alerta 30/15/7), vencida, renovada, arquivada. Sugestão de renovação mantém meses completos.
- **Alertas complementares** (`extra_alert_rows`): documentos de clientes vencendo/vencidos e
  veículos em operação sem apólice vigente (crítico). Somados aos alertas do dashboard e ao sino.
- **Documentos**: vínculo opcional com veículo, contrato ou apólice (validados na mesma empresa);
  pastas `<empresa>/company/general`, `<empresa>/vehicles/<id>`, `<empresa>/rentals/<id>`.
  `retention_until` = emissão (ou envio) + `companies.document_retention_years`. A exclusão
  definitiva só é possível pelo administrador principal **depois** do prazo (`purge_document`),
  e remove o arquivo do Storage; antes disso, apenas arquivar. Documentos pessoais de clientes
  podem ser excluídos pelo dono a qualquer momento (RGPD).
- **Contrato assinado**: enviar um documento da categoria "contrato" no contrato marca
  `signature_status = 'signed'` (assinatura manuscrita digitalizada; assinatura eletrônica
  qualificada fica para integração futura).

### 3.10 Manutenção, multas e sinistros (migrations 0007a e 0007)

- **0007a** só adiciona valores de enum (categorias `repairs`, `fines`, `fine_recharge`,
  `damage_recovery` e documentos `maintenance_invoice`, `fine_notice`, `accident_report`) — fica em
  arquivo separado porque o PostgreSQL só permite usar valores novos depois do commit.
- **Lançamentos automáticos** usam `financial_transactions.source_ref` (ex.: `maintenance:<id>`,
  `fine:<id>:expense`, `fine:<id>:recharge`, `accident:<id>:deductible`, `accident:<id>:payout`),
  com índice único: um lançamento por origem, atualizado ou anulado conforme o registro muda.
- **Planos** (`maintenance_plans`): intervalo em km e/ou meses a partir do último serviço;
  `maintenance_due()` calcula próximo serviço e situação (em breve = até 30 dias ou 1.000 km).
- **Ordens** (`maintenance_records`): agendada → na oficina → concluída/cancelada. Na oficina, o
  veículo fica "Em manutenção" (bloqueia reservas; não é possível se estiver alugado —
  `VEHICLE_BUSY`). Concluída: atualiza km do veículo e o plano, resolve a avaria ligada (custo real e
  oficina) e lança a despesa (pneus/ITV/limpeza/reparos/manutenção) na data de conclusão. Depois de
  concluída, só pagamento, fatura e observações mudam. Cancelar exige motivo. Nada é excluído.
- **Multas** (`traffic_fines`): contrato e cliente são identificados pela data/hora da infração
  (`app.rental_at`); "condutor identificado" exige cliente. Paga pela empresa → despesa "Multas";
  valor cobrado do cliente → receita "Repasse de multas". Prazos geram alertas (7 dias).
- **Sinistros** (`accidents`): contrato, cliente e apólice vigente identificados automaticamente;
  fotos (`accident_photos`), avarias ligadas (`damages.accident_id`) e documentos. Franquia cobrada
  do cliente e indenização recebida → "Recuperação de danos". Alerta enquanto não for comunicado à
  seguradora. Os prazos legais e contratuais não são presumidos: constam nas notificações e na apólice.

### 3.11 Financeiro e patrimônio (migrations 0008a e 0008)

- **Resultado operacional × não operacional**: `is_operational` é calculado por
  `app.is_operational_category`. Ficam fora do resultado (mas entram no caixa e no patrimônio):
  compra e venda de veículo, financiamento recebido/parcelas e aportes/retiradas de sócios.
- **Lançamentos automáticos** (contratos, apólices, manutenções, multas, sinistros, compra/venda de
  veículo) não podem ser alterados manualmente (`AUTO_ENTRY_LOCKED`): só observações e comprovante.
  A verificação usa `pg_trigger_depth()` — as rotinas de sincronização rodam dentro de gatilhos.
  Lançamento anulado não volta a valer (crie outro). Nada é excluído.
- **Compra do veículo**: lançada automaticamente a partir do preço e da data de aquisição (as
  compras existentes são lançadas pela migration). Lançar a compra à mão gera `DUPLICATE_PURCHASE`.
- **Venda do veículo** (somente administrador principal): `sold_at` + `sale_price` → status
  "vendido", saída da frota e entrada "Venda de veículo". Bloqueada com reservas/contratos abertos.
- **Parcelas**: o lançamento manual pode ser dividido em até 120 parcelas mensais (`series_id`,
  `installment_no/count`); o arredondamento em centavos fica na última parcela.
- **Regimes**: `finance_report(from, to, 'accrual'|'cash')`. Competência = `competence_date`
  (aluguel na devolução). Caixa = `app.cash_movements`: pagamentos/estornos efetivos dos contratos
  (`rental_payments`) + demais lançamentos pagos pela data de pagamento. Cauções nunca entram.
- **Fluxo de caixa** (`cash_flow`): entradas/saídas realizadas, previsão (lançamentos pendentes pelo
  vencimento e saldos de contratos), cauções à parte e saldo acumulado a partir do saldo inicial
  (`companies.cash_opening_balance/date`, definido pelo administrador principal). Meses futuros
  mostram saldo projetado.
- **Contas a pagar/receber** (`open_items`): saldos de contratos + lançamentos pendentes.
- **Rentabilidade** (`fleet_roi`): receita, despesas e lucro operacional por veículo desde a entrada,
  valor atual (venda, última avaliação, valor de mercado ou compra), ROI, retorno total e meses
  estimados para o lucro cobrir a depreciação (`vehicleReturns`).

### 3.12 Calendário, notificações e área do cliente (migration 0009)

- **Calendário** (`calendar_events`): contratos (retirada → devolução), oficina, fim de apólice, ITV e
  prazos de multas. **Disponibilidade** (`available_vehicles`): para um período, indica veículos livres,
  ocupados (contrato em conflito; em andamento ocupa até a devolução ou agora, se atrasado), com
  manutenção agendada ou sem seguro para todo o período. A reserva continua protegida pela restrição
  de conflito do banco.
- **Notificações**: `refresh_notifications()` transforma os alertas (`dashboard_alerts` +
  `extra_alert_rows`) em notificações persistentes por empresa, no máximo a cada 5 minutos (chamado
  pelo layout do painel), e resolve as que deixaram de existir. Leitura por usuário em
  `notification_reads`. Eventos (solicitações do portal) entram com `source = 'event'`.
- **Área do cliente**: `customer_portal_accounts` liga um usuário de autenticação a UM cliente. A conta
  é criada pelo servidor SEM `company_id` no `app_metadata` — portanto nunca recebe perfil da equipe
  (`app.current_company_id()` é nulo e toda a RLS da empresa nega acesso). Os dados chegam apenas por
  funções `portal_*` (SECURITY DEFINER) que filtram pelo próprio cliente; arquivos por política de
  Storage específica; o contrato em PDF é gerado com a chave de serviço somente depois de
  `portal_owns_rental` confirmar a posse. Equipe e portal são mutuamente exclusivos
  (`PORTAL_STAFF_CONFLICT`); anonimizar o cliente desativa o acesso. Login por código de uso único
  (`signInWithOtp` com `shouldCreateUser: false`), sem senha.
- **Solicitações de reserva** (`rental_requests`): criadas pelo cliente (`portal_request_rental`, até 5
  abertas), notificam a equipe e são tratadas em Notificações (criar reserva já preenchida).

## 4. Fluxo de autenticação

```
Login (e-mail+senha) ──► Server Action signInAction
   │ zod valida ─► supabase.auth.signInWithPassword ─► cookies httpOnly
   │ perfil ativo? ── não ─► signOut + "Conta sem acesso"
   │ sim ─► rpc log_sign_in (histórico de acessos) ─► redirect seguro (?next, só caminhos internos)
Cada requisição ─► middleware: auth.getUser() (valida JWT no Supabase) ─► renova cookies
                   sem sessão em rota protegida ─► /login?next=…
Esqueci a senha ─► resetPasswordForEmail(redirectTo=/auth/confirm?next=/reset-password)
                   (resposta idêntica exista ou não a conta → sem enumeração de e-mails)
Link do e-mail ─► /auth/confirm (verifyOtp token_hash ou exchangeCode) ─► /reset-password ─► updateUser
Alterar senha (Minha conta) ─► reautentica com a senha atual ─► updateUser
Logout ─► POST /auth/signout
```

**Criação de usuários.** O cadastro público deve ficar **desativado** no Supabase. O primeiro usuário
criado vira automaticamente **Administrador principal** e cria a empresa. Os demais entram por convite:

```
Adm. principal ─► Usuários → Convidar (Server Action, requireOwner + zod)
   ├─ auth.admin.inviteUserByEmail (service_role) ─► Supabase envia o e-mail
   ├─ auth.admin.updateUserById(app_metadata = {company_id, role})
   │     └─ trigger app.handle_user_app_metadata ─► cria o perfil (auditado)
   │     (falhou? o usuário recém-criado é removido — nada fica pela metade)
   └─ rpc log_event('user.invite')
Convidado ─► link do e-mail ─► /auth/confirm (type=invite) ─► /reset-password ─► define a senha
```

`app_metadata` não pode ser alterado pelo próprio usuário. Conta sem convite autentica, mas não vê
nenhum dado. **Desativar** um usuário: `profiles.is_active = false` (a RLS corta o acesso na hora) +
`ban_duration` no Auth (impede novo login e a renovação das sessões abertas).

**Permissões na aplicação.** Toda Server Action chama `requireStaff()` ou `requireOwner()` antes de
qualquer operação; páginas exclusivas do administrador principal (Usuários, Configurações) mostram
"sem permissão" para administradores. A RLS do banco aplica as mesmas regras de forma independente.

## 5. Internacionalização

- Dicionários tipados (`src/lib/i18n/dictionaries`). `es-ES` é tipado como `Dictionary` → faltar uma
  chave quebra a compilação; um teste garante paridade de chaves e placeholders.
- Idioma: cookie `jb_locale` (preferência de interface) + `profiles.locale` (persistido no banco).
- Mensagens de erro do servidor trafegam como **chaves** e são traduzidas na interface.
- Novo idioma: criar dicionário, registrar em `LOCALES` e `dictionaries/index.ts`.

## 6. Segurança e RGPD

- Chave `service_role` nunca vai para o navegador (sem prefixo `NEXT_PUBLIC_`), usada apenas em código
  de servidor a partir da fase 2.
- Cabeçalhos de segurança (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy).
- Documentos pessoais apenas no bucket privado, por empresa, acessados via URL assinada de curta duração;
  `documents.is_personal_data` e `retention_until` preparam a política de retenção.
- Service worker não armazena páginas nem respostas de API (apenas estáticos versionados).
- `customers.gdpr_consent_at` / `marketing_consent` registram base legal e consentimento.
- Parâmetros fiscais (IVA etc.) são **configuráveis** (`companies.vat_rate`, `financial_transactions.vat_rate`)
  — nenhuma regra tributária é presumida; devem ser definidos com o gestor/assessor fiscal.
- Backups: Supabase faz backups diários (planos pagos; PITR opcional). Ver docs/SETUP.md.

## 7. Plano de implementação

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Identidade visual, estrutura, login, recuperação/alteração de senha, dashboard real, PWA, i18n, núcleo do banco com RLS | ✅ concluída |
| 2 | Usuários (convite, cargos, desativação, link de senha), configurações da empresa (dados, fiscal, preços padrão, contrato, taxas, logotipo), perfil próprio, histórico de acessos e registro de atividades | ✅ concluída |
| 3 | Veículos (ficha com 9 abas, fotos, documentos, busca, arquivamento, histórico de valor) e clientes (PF/PJ, DNI/NIE validado, documentos pessoais, histórico, RGPD/anonimização), busca global | ✅ concluída |
| 4 | Reservas/contratos com cálculo no banco, disponibilidade, extras, entrega/devolução, km excedente, pagamentos e estornos, cauções, integração com financeiro, contrato em PDF PT/ES | ✅ concluída |
| 5 | Inspeções de entrega/devolução/periódicas com checklist e fotos, comparação, avarias com fotos e custos, relatórios PDF | ✅ concluída |
| 6 | Seguros (renovações, alertas 30/15/7, prêmio como despesa, veículos sem seguro) e central de documentos (vínculos, retenção, contrato assinado) | ✅ concluída |
| 7 | Manutenção (planos por data/km, oficina, custos), multas (identificação do condutor, repasse) e sinistros (franquia, indenização) | ✅ concluída |
| 8 | Financeiro completo (competência × caixa), lançamentos e parcelas, contas a pagar/receber, fluxo de caixa com saldo e previsão, patrimônio, ROI e venda de veículos | ✅ concluída |
| 9 | Calendário (mês, linha do tempo da frota, disponibilidade), notificações persistentes e área do cliente (login por código, contratos, pagamentos, documentos, solicitações) | ✅ concluída |
| 10 | Relatórios CSV/PDF, testes E2E, revisão de segurança, publicação | |
