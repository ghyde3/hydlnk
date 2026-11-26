# HYDLNK knowledge

Facts and decisions an agent cannot infer from the code. Short entries, newest first inside each section. Decisions about scope and behavior live in `docs/PLAN.md` under "Decided"; this file holds the working knowledge around them. If an entry here can become a test, lint rule, type or hook, do that and delete the entry.

## The constraint pyramid (strongest first)
1. **Architecture.** RLS, column grants and SQL triggers (the HL0xx codes) refuse bad writes whatever the caller does. `server-only` keeps secrets out of the browser.
2. **Types and schemas.** Zod draft and publish schemas in `src/lib/document/`; generated Supabase types.
3. **Static tests.** Tests that read the source tree and fail on a banned pattern, for example `tests/unit/dependencies-policy.test.ts` (libraries, licenses, remote hosts) and `tests/unit/harness-docs.test.ts` (these docs).
4. **Hooks.** `.claude/hooks/`: `guard-files.sh` (committed migrations and env files cannot be edited), `format-and-lint.sh` (after every edit), `stop-checks.sh` (typecheck, lint and unit before an agent may stop), `stripe-guard.sh`.
5. **CI.** Verify on every push; the full browser suite nightly or on a PR labelled `full-ci`.
6. **Prose.** `CLAUDE.md`, `.claude/rules/`, this file. Last resort.

A correction from Gary or a reviewer goes in at the highest level that can hold it.

## Footguns without a guard yet
Each line is a candidate for a deterministic check. Remove the line when the check lands.
- **Skipping or weakening a test to get green.** Never. A flaky test is fixed or reported, not skipped. (Candidate: fail CI on new `.skip` or `.only` outside `tests/e2e/manual/`.)
- **A test that passes without asserting its step.** Reviewers found request filters that exempt a call without counting it. Count allowed requests exactly.
- **Reading `passes: true` as proof.** The proof is in `PROGRESS.md`. A row flips only when every acceptance step has a named test or recorded evidence.
- **Building on an unverified claim** (from a doc, a PROGRESS entry or another agent). Re-check against the code or a command before acting on it.
- **Catch-all routes on tenant hosts.** Banned (`.claude/rules/routing.md`); `tests/unit/m8-render-graph.test.ts` holds part of it.
- **Running two db test runs at once.** The local Supabase stack is one database; parallel `pnpm test:db` or `db:reset` runs corrupt each other.

## Environment facts
- **Cloud containers** have Node 22 and no Supabase CLI or running Docker daemon. `scripts/cloud-init.sh` fixes all three, then `./scripts/init.sh` works (verified 2026-11-26: init PASS in 75 s).
- **Supabase images**: `public.ecr.aws` refuses anonymous pulls from shared cloud IPs ("Data limit exceeded"). The same tags exist on `ghcr.io/supabase/*`; the script pulls and retags them. The environment's network policy must allow `ghcr.io` and `pkg-containers.githubusercontent.com`. A later command that needs another tag (`pnpm db:types` pulls its own postgres-meta) is fixed with `scripts/cloud-init.sh image <name:tag>`.
- **Supabase CLI telemetry** times out in a locked-down container and makes a passing `pnpm test:db` exit 1 ("Timeout while shutting down PostHog"). `supabase telemetry disable` fixes it; `scripts/cloud-init.sh` runs it.
- **DNS lookups** (dig, DNS over HTTPS) do not work from cloud containers, so DKIM, SPF and custom-domain DNS evidence comes from Gary's machine.
- **Local sign-up under parallel load** can fail with "Database error creating new user"; `pnpm test --retry 2` covers that known flake.
- **CI shards** can fail at the production build when Google Fonts rate-limits `next/font`; rerun the shard.

## How verification runs
- One agent builds. A different, fresh agent checks: `reviewer` against the acceptance steps, `adversarial-verifier` assuming the change is broken, `security-reviewer` for auth, data, routing or payments, `design-verifier` for screens.
- A checker reports only what it can show (a probe, a failing test, a file and line). The builder fixes; the orchestrator reruns the tests itself before any `passes` flip.
- Runtime checks use `docs/FEATURE_MAP.md`, Playwright (`pnpm test:e2e <spec>`) and `pnpm screens`.

## Scaling the loop (later, not now)
Today: one strong loop per feature (`/feature-loop`) plus independent verification. When that is boring and reliable, scale in this order:
1. **Coordinator and executors.** The coordinator plans, assigns disjoint file sets, integrates and is the only one to flip `passes`. Executors build one work package each in their own worktree and run only their own tests. This already exists informally as "orchestrated waves" in `CLAUDE.md`.
2. **Playbooks as skills.** Route by task type to a skill with fixed steps and exit evidence, as `/feature-loop`, `/db-change`, `/add-block-type` and `/release` do now. Add one only after the same sequence has been done by hand three times.
3. **Loops and swarms.** Recurring checks (`/loop`) and wide fan-outs come last, and only for work whose result a test can judge. More agents never replace evidence.
