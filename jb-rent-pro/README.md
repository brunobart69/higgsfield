# JB RENT PRO

**Sua frota, seu patrimônio, seu controle.**

Plataforma SaaS de gestão de aluguel de veículos para operação na Espanha (EUR · Europe/Madrid),
em português brasileiro e espanhol da Espanha.

- Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · componentes no padrão shadcn/ui · Lucide · Recharts
- Supabase: PostgreSQL com RLS, Auth, Storage privado
- PWA instalável (Android e iPhone)

## Documentação

- [Arquitetura, banco de dados, permissões e plano de fases](docs/ARCHITECTURE.md)
- [Instalação, credenciais e publicação](docs/SETUP.md)

## Início rápido

```bash
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Scripts

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `npm start` | Build e execução de produção |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:db` | Migrations + testes de RLS, conflitos e cálculos em PostgreSQL local |
| `npm run typecheck` / `npm run lint` | Verificação de tipos e lint |
| `node scripts/generate-icons.mjs` | Regenera os ícones PNG do PWA |

## Estado atual

**Fase 1 concluída** — identidade visual, login, recuperação e alteração de senha, dashboard com dados
reais do banco, idiomas PT/ES, PWA e núcleo do banco de dados (com RLS, auditoria e bloqueio de reservas
conflitantes). Os módulos das próximas fases aparecem no menu marcados com a fase em que serão liberados.
