# Contributing to majik.portal

Thanks for your interest. This repo holds the Angular 21 web client for [Majik](https://github.com/bg9m9r/majik) — live at [majik.tech](https://majik.tech). All gameplay logic is server-authoritative; this is the UI.

## Before you start

- Read [`README.md`](./README.md) for stack, routes, and local dev.
- Read [`FRONTEND_PLAN.md`](./FRONTEND_PLAN.md) for the visual direction and design tokens.
- The server (`Majik.Server`) lives in [`bg9m9r/majik`](https://github.com/bg9m9r/majik). Run it locally before doing UI work that touches the API.

## Development setup

```bash
# 1. Install
npm ci

# 2. Generate the API client (server must be running on http://localhost:5057)
npm run openapi

# 3. Dev server
npm run start            # http://localhost:4200
```

The generated client (`src/app/core/api/`) is gitignored — regenerate after every server-side DTO change.

## Tests

```bash
npm test                 # Vitest unit tests
npm run e2e:install      # one-time Playwright browser install
npm run e2e              # Playwright e2e tests
```

## Conventions

From the Majik design system:

- **MTG vocabulary is exact** — "tapped", "summoning sickness", "stack", "priority", "mulligan", "library", "graveyard", "exile", "battlefield".
- **Sentence case** for buttons + dialogs (`Pass priority`, `Create match`).
- **UPPERCASE + tracking** only for small section labels (`SEATS`, `EVENT LOG`, `SERVER`).
- **lowercase** for status pills (`hub: open`, `reachable`, `checking…`).
- **WUBRG order** for mana: White, Blue, Black, Red, Green.
- **No exclamation marks. No emoji.** Anywhere in copy.
- **Hairline rims, no drop shadows** on panels.
- **Two motions only** in the live UI: 100ms `transform: rotate(90deg)` on card tap, instant card-detail hover. Everything else snaps.
- **Desktop ≥1280px.** Mobile / tablet is out of scope for v1.

## PR conventions

- Branch from `main`.
- Conventional Commits style for titles (`feat:`, `fix:`, `chore:`, `feat(lobby):`, etc.).
- Keep PRs focused — one feature or fix per PR.
- CI must be green (unit tests + Playwright e2e + production build) before merge.

## Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). Every commit must carry a `Signed-off-by` trailer asserting you have the right to submit the change under the project's Apache-2.0 license.

```bash
git commit -s -m "your message"      # the -s adds the trailer
```

The trailer looks like:

```
Signed-off-by: Your Name <your.email@example.com>
```

If you forget, amend the last commit:

```bash
git commit --amend -s --no-edit
```

For a branch with several commits, rebase and sign all of them:

```bash
git rebase --signoff main
```

By signing off you confirm:

- The contribution was created in whole or part by you, **or**
- You have permission to submit it under the open-source license indicated, **or**
- The contribution was provided to you by someone who certified one of the above, and you have not modified it.

## Licensing of contributions

Per Apache-2.0 §5, any contribution you submit is licensed under the same Apache-2.0 terms as the rest of the project. You retain copyright in your work; you grant the project the rights set out in the license. No separate CLA.

## Magic: The Gathering Fan Content

majik.portal exists under the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Contributions must not push the project outside that policy:

- No monetisation, ads, paywalls, or commercial branding.
- Don't ship Wizards artwork — the engine references Scryfall image URLs, the client renders them; it does not redistribute them.
- The brand mark in `public/logo/` is part of the Majik design system; don't modify it to imply Wizards endorsement.

## Reporting issues

Use GitHub issues on this repo for UI bugs. Engine, rules, server, or card-data bugs go to [`bg9m9r/majik`](https://github.com/bg9m9r/majik).
