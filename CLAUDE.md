# HYDLNK

Multi-tenant link-in-bio platform (a Linktree alternative) that wins on design control: block layouts, a tenant theme-token system, saved themes. Open but unadvertised signup; most users are on phones.
Stack: Next.js 16 App Router + TypeScript on Vercel, Supabase (Auth, Postgres + RLS, Storage, pg_cron), Stripe Checkout + hosted portal (sandbox only), Zod, dnd-kit, pnpm 10, Node 24.
Next.js 16 differs from older versions (`proxy.ts`, no `next lint`, `updateTag`): read `node_modules/next/dist/docs/` before writing Next code (see AGENTS.md).

## Commands
- `./scripts/init.sh`: start of every session, safe to rerun. Installs, starts local Supabase, writes `.env.local`, resets and seeds the db, starts the dev server, runs the smoke test.
- `pnpm dev`: dev server on :3000. `pnpm verify`: typecheck + lint + unit + db tests.
- `pnpm test` (Vitest unit), `pnpm test:db` (pgTAP RLS), `pnpm test:e2e` (Playwright: phone 390x844 and desktop 1440x900), `pnpm test:e2e:prod` (production smoke, release only).
- `pnpm screens <route> [--host app|<handle>]`: screenshots at both viewports into `tmp/screens/`.
- `pnpm db:reset`: migrations + seed. `pnpm db:types`: regenerate `src/lib/supabase/database.types.ts`.
- Plain `pnpm ...` works in Claude Code sessions: the SessionStart hook `pin-node.sh` puts Node 24 (from `.nvmrc`) and corepack's pnpm 10 on the Bash tool's PATH. In your own terminal, or any shell outside Claude Code, run `source ~/.nvm/nvm.sh && nvm use` first (the default node is older).
- Interactive browsing: gstack `/browse`, never `mcp__claude-in-chrome__*`. Playwright is the test runner only.

## Repo map
- `src/proxy.ts`, `src/lib/routing/`: host routing (marketing, `app.*`, `{handle}.*`, custom domains).
- `src/app/`: route groups `(marketing)`, `(editor)/app/` (app host only), `(share)/app/share` (the private draft link on the app host, its own root layout), `(tenant)/t/[handle]` and `(tenant)/sites/[pageId]` (tenant pages by handle and by custom domain). `r/`, `api/` (click redirect, beacon, Stripe webhook) and `auth/callback` arrive in later milestones.
- `src/lib/theme/`: tenant token types, resolver, CSS variables. `src/lib/document/`: the page document (Zod draft and publish schemas, limits, URL and embed rules, block defaults, `toPublishForm`). `src/lib/schemas/`: the handle rule.
- `src/lib/supabase/` (server, browser, admin clients, generated types), `src/lib/env/` (Zod-validated server and client env).
- `supabase/`: `migrations/`, `seed.sql` (local demo tenant `mara`), `tests/database/` (pgTAP), `config.toml`.
- `tests/unit/`, `tests/e2e/`, `tests/e2e-prod/`; `scripts/` (init.sh, screens.ts); `.github/workflows/ci.yml`.
- `docs/` (PLAN, DESIGN, features.json), `design/mockups/`, `.claude/` (rules, agents, skills, hooks).
- Local hosts: `localhost:3000` marketing, `app.localhost:3000` editor, `mara.localhost:3000` demo tenant. Chrome and Firefox resolve `*.localhost`; Safari may need `/etc/hosts` entries.

## Invariants
- **RLS is the permission system.** Anything RLS allows, a user can do with the publishable key and curl. Server code that writes with the secret key checks ownership itself.
- **Published only.** Public reads return `published` only, never `draft`, through server-only queries.
- **Secret key stays on the server.** It never reaches client code.
- **RLS everywhere.** Every table has RLS on. Every new table ships with policies and a policy test in the same change.
- **Limits on write.** Plan limits (pages, saved themes, domains, upload bytes) are enforced on write, in the database or server-only code, never only in the UI.
- **Tenant content is untrusted.** Validate URLs (http/https only), escape all text, and allow embeds only from an allowlist (YouTube, Spotify).
- **Two token systems.** HYDLNK UI tokens and tenant theme tokens never mix.
- **Auth on `app.*` only.** Auth cookies live there, and tenant subdomains never see them.
- **Production only through `release`.** Production changes go through the `release` skill, with Gary's approval. Unattended sessions never touch production, live Stripe or other projects.
- **Mobile first.** Nothing passes until it works at 390px, with touch targets of at least 44px.

## Definition of done (every feature)
- Acceptance steps pass in Playwright at 390 and 1440.
- Unit and db tests are added.
- `verify` is green.
- `reviewer` reports no correctness gaps.
- Screenshots are checked against the mockup.
- `passes: true`, with evidence in PROGRESS.md.
- One commit.

## Session ritual
- Start: `./scripts/init.sh`, read the top of PROGRESS.md and take the next feature with `passes: false` in `docs/features.json` (the SessionStart hook prints both). `/feature-loop` runs the whole cycle for one feature.
- End: `pnpm verify`; flip `passes` with evidence; add a PROGRESS.md entry (newest first); commit `feat(<area>): <title> [<feature-id>]`; push the milestone branch.
- **features.json rule:** once committed, features are only ever added, or have `passes` flipped to true with evidence. Never delete, reword or weaken a feature or its acceptance steps.
- When compacting, always preserve the current feature id, modified files and test commands.

## Git workflow
- One branch per milestone: `m<N>-<slug>` (for example `m1-foundation`). Open a draft PR with `gh pr create --draft` as soon as the branch exists, so CI runs on every push.
- Conventional commits, one per feature, feature id in the message. Never force push; never push to `main`.
- Orchestrated waves (Gary's fast track, 2026-10-01): parallel agents build feature groups; one commit per feature group with every id in the message; only the integration agent flips `passes` in features.json, after running the tests itself; security-reviewer runs once per wave that touches auth, data, routing or payments. `tmp/orchestrating` pauses the Stop hook during a wave and is removed before release.
- Test bar from Wave C on (Gary, 2026-10-02): full tests for security, auth, payments, RLS/limits and other users' data; elsewhere one phone + one desktop smoke per screen or flow (renders, main interaction works, no horizontal scroll); no exhaustive pixel/copy or axe assertions; full browser suite at release. `passes` flips only when every acceptance step is proven, so lightly tested features stay false and are listed in PROGRESS as built.
- CI (Gary, 2026-10-03): every push runs only the fast job (typecheck, lint, unit, db, integration). The full browser suite runs nightly, from the Actions tab, or on a PR labelled `full-ci`; label release PRs that change screens.
- Unattended sessions never merge. Merging to `main` deploys production, so it goes only through `/release`, which asks Gary.

## Unattended runs
`claude -p "/feature-loop" --permission-mode dontAsk`
- `dontAsk` refuses every command that isn't on the project allow list, so production commands (`supabase db push`, `gh pr merge`, `vercel`, `stripe`, the Supabase, Vercel and Stripe connectors) never run unattended. There is no ask list (Gary, 2026-10-02: interactive sessions run in bypass mode and release with his standing approval). `auto` and `bypassPermissions` cannot come from project settings; the mode comes from the command line.
- Run `claude` once interactively in this repo and accept the trust dialog first: in a never-trusted folder `claude -p` ignores the project's `permissions.allow` rules.
- Node: `pin-node.sh` pins Node 24 for every Bash call, so no prefix is needed. If it reports it could not (Node 24 missing), `source ~/.nvm/nvm.sh >/dev/null && nvm use >/dev/null && pnpm ...` is also allowed.
- Skills, subagents and the settings hooks work in `-p` mode. Needs Gary (secret, production, decision)? Log it in PROGRESS.md and stop.

## Area rules, agents, skills
- `.claude/rules/` load by path: `supabase-migrations.md` (`supabase/**`), `tenant-pages.md` (`src/app/(tenant)/**`, `src/lib/theme/**`), `editor-app.md` (`src/app/(editor)/**`), `routing.md` (`src/proxy.ts`, `src/lib/routing/**`).
- Agents: `reviewer` (correctness against acceptance), `security-reviewer` (auth, data, routing, payments), `design-verifier` (screens vs mockups).
- Skills: `/feature-loop`, `/release`, `/add-block-type`, `/db-change`.
- Stripe: HYDLNK sandbox only; the Stripe CLI always takes `--project-name hydlnk`. Never read or print `.env*` or secret keys. If a bare `supabase` command stalls on a docker image, run `source scripts/lib/docker-env.sh` first (it works around Docker Desktop's hanging credential helper; init.sh and `pnpm db:types` already do).

## Where to look
- `docs/PLAN.md`: scope, architecture, data model and access rules, tenant tokens, analytics, milestones. Decides scope and behavior.
- `docs/DESIGN.md`: HYDLNK UI tokens, responsive rules, components, screens. Decides UI values; docs win over mockups.
- `design/mockups/*.dc.html`: layout, copy and states as annotated HTML (cannot be run).
- `docs/features.json`: the feature list. `PROGRESS.md`: the session log. `KICKOFF_PROMPT.md`: the original brief.
