---
name: feature-loop
description: "Build exactly one failing feature from docs/features.json end to end: plan, implement with tests, verify, review, log evidence, commit and push the milestone branch. Manual only. Never merges."
disable-model-invocation: true
argument-hint: "[feature-id]"
---

# Feature loop

Build one feature, prove it, commit it, stop. Feature id from the arguments: `$ARGUMENTS` (empty means the next failing feature).

You may be running unattended (`claude -p`, no one to answer). Anything that would prompt is refused. If something needs Gary (a secret, production, a decision), do not work around it: log it under Known issues in PROGRESS.md and stop.

## Steps

1. **Branch.** `git branch --show-current` must be a milestone branch `m<N>-<slug>`, never `main`. If the branch for this feature's milestone does not exist, create it from the current milestone base (`git switch -c m<N>-<slug>`), `git push -u origin HEAD`, and open a draft PR with `gh pr create --draft` so CI runs on every push.
2. **Init.** Run `./scripts/init.sh`. It must end healthy (deps, local Supabase, seeded database, dev server, smoke test). If it does not, fixing the environment is the whole session: log it and stop.
3. **Pick.** Take the given id, otherwise the first feature in `docs/features.json` with `"passes": false` (the file may be an array or `{ "features": [...] }`). Read its `acceptance` steps, the matching parts of `docs/PLAN.md` and, for UI, `docs/DESIGN.md` and the mockup named in its screen table. If it depends on a feature that does not pass yet, take that one instead.
4. **Plan.** Write a short plan in your reply: files to touch, tests to add (unit, pgTAP, Playwright), risks. Stay inside this feature; do not build neighbors.
5. **Implement with tests.** Tests first where practical. Unit tests in `tests/unit/`, policy tests in `supabase/tests/database/` for any table or policy change (use the `db-change` skill), Playwright in `tests/e2e/` covering the acceptance steps at 390x844 and 1440x900. Follow the area rules in `.claude/rules/`. A new block type uses the `add-block-type` skill.
6. **Verify.** Run each check through `scripts/q.sh` (e.g. `scripts/q.sh pnpm verify`) so only failures reach you; grep the log it names for more. All must pass:
   - `pnpm verify` (typecheck, lint, unit, db).
   - `pnpm test:e2e` (both projects: phone 390x844 and desktop 1440x900).
   - UI work: `pnpm screens <route>`, then read the PNGs in `tmp/screens/` against the mockup and DESIGN.md.
7. **Review.** Spawn the `reviewer` agent with the feature id. Add `security-reviewer` when the change touches auth, data or RLS, routing or the proxy, tracking routes, tenant content, or payments. Add `design-verifier` for UI features. Fix every correctness gap and security finding, then rerun step 6.
8. **Flip and log.** In `docs/features.json` change only this feature's `"passes": false` to `true`. Never delete, reword or weaken any feature or acceptance step; you may add new features. Add a short entry at the top of `PROGRESS.md`: date, feature id, what changed, evidence (commands and results, test names, screenshot paths), next step, known issues.
9. **Commit and push.** Stage only the files you meant to change. One commit: `feat(<area>): <title> [<feature-id>]` (use `fix`, `test` or `chore` when more accurate). Then `git push`. Never `--force`, never push to `main`, never merge, never run `supabase db push` or touch production, live Stripe or other projects.
10. **Stop.** One feature per session. End with the feature id, the commit hash, and the next failing feature.

## If you cannot finish
Leave `passes` as `false`. Do not leave the tree red: `git stash push -u -m "wip <feature-id>"` the unfinished work. Add the PROGRESS.md entry with the blocker and exact next step, commit just that (`docs(progress): <feature-id> blocked`), push, and stop.
