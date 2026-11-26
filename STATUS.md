# HYDLNK status

The short, current picture. Read this first; `PROGRESS.md` is the full session log (newest first) and holds the evidence. Update this file in the same commit whenever a line below stops being true. Keep it under 60 lines.

Last updated: 2026-11-26.

## Production

- `main` is live at hydlnk.com (last release: PR #30, the proving pass, 2026-10-11). 323 of 338 features pass.
- Production changes go only through `/release`, with Gary.

## In flight

| Branch / PR                      | What                                                                                                                                                            | State    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `m16-content` / #32 (draft)      | Content model: pages and posts as entries. Stages 0 and 1a proven; stage 1b-1 (the page move) built, CI green at 4d51ff2, rows M15-05 to M15-17 not yet flipped | Active   |
| `chore/agent-harness`            | This file, `docs/FEATURE_MAP.md`, `docs/KNOWLEDGE.md`, `scripts/cloud-init.sh`, the harness-docs test                                                           | Draft PR |
| `plan/pdp-landing-builder` / #33 | A separate product's plan, parked. Never merge                                                                                                                  | Parked   |

## Next, in order (Gary, 2026-11-26)

1. Launch gates: custom SMTP, DKIM and the Google OAuth app. Gary reports these done; evidence still to be recorded (M5-22, M5-25).
2. Finish the page move and per-page publishing (M15-05 to M15-17), then the blog: public post pages and the Posts editor.
3. Email capture and contact form block (new scope, approved 2026-11-26).
4. MCP content tools.
5. Scheduled links and scheduled publishing.
6. Team access for Studio.

## Waiting on Gary

- M15-08: the content-move dry run needs a local copy of production.
- M4-06, M4-07, M14-04: Stripe sandbox key in `.env.local`.
- M11-12: decide on a Vercel WAF rate rule for tenant hosts.
- M5-26 (spend alerts), M5-27 (two weeks live), M9-10 (Sentry DSN), M8-04 step 6 (Vercel-only proof).
- Every release: migrations and the merge to `main`.
