# majik.portal

Web client for [Majik](https://github.com/bg9m9r/majik) — the open-source Magic: The Gathering rules engine. Free, 1v1, desktop. Live at [majik.tech](https://majik.tech).

Pairs with [`bg9m9r/majik`](https://github.com/bg9m9r/majik) (engine + server). This is the Angular UI; all gameplay logic is server-authoritative.

## Stack

- **Angular 21** standalone components, signals, lazy routes
- **NgRx Signals** for store
- **SignalR** client (`@microsoft/signalr`) against `Majik.Server`'s `/hubs/match`
- **Tailwind v4** + design tokens in `src/styles/tokens.scss`
- **Vitest** for unit tests, **Playwright** for e2e
- **ng-openapi-gen** — typed API client generated from `Majik.Server`'s `/openapi/v1.json` (gitignored, regen with `npm run openapi`)

Visual direction documented in [`FRONTEND_PLAN.md`](./FRONTEND_PLAN.md) and the Majik design system (`/skill majik-design` if installed).

## Routes

| Route | Component | Auth |
|---|---|---|
| `/login` | landing + sign-in | anonymous |
| `/onboarding` | first-time handle picker | auth |
| `/lobby` | match list, deck picker, create-match wizard | auth + profile |
| `/decks` | deck list / editor | auth + profile |
| `/match/:id` | game board (phase bar, HUDs, battlefield, stack, prompts) | auth + profile |

## Local development

```bash
# 1. Install
npm ci

# 2. Generate the API client (server must be running locally)
npm run openapi          # fetches http://localhost:5057/openapi/v1.json, generates src/app/core/api/

# 3. Dev server
npm run start            # http://localhost:4200
```

`environment.ts` defaults assume the local server at `http://localhost:5057`. The server's card pool is embedded inside the `Majik.Core` assembly, so no separate seed step is needed — `dotnet run --project Majik.Server` is enough.

## Tests

```bash
npm test                 # Vitest unit tests
npm run e2e:install      # one-time Playwright browser install
npm run e2e              # Playwright e2e tests
```

## Build

```bash
npm run build            # production build → dist/majik-portal/browser/
```

Production build uses Angular's `fileReplacements` to swap `environment.ts` → `environment.production.ts`. On Render the heredoc in `render.yaml`'s `buildCommand` writes the resolved env values (e.g. `MAJIK_API_URL`) into `environment.production.ts` before `ng build`.

## Deploy

Render Blueprint in [`render.yaml`](./render.yaml). Static site bound to [majik.tech](https://majik.tech).

Build pipeline on Render:
1. `npm ci`
2. `npm run openapi` against `$MAJIK_API_URL/openapi/v1.json` — regenerates the typed API client.
3. Heredoc-writes `environment.production.ts` with the resolved env vars.
4. `ng build` — produces the static bundle.
5. Render serves `dist/majik-portal/browser/` with SPA rewrite `/* → /index.html`.

Env var contract: see [`docs/RENDER_ENV.md`](https://github.com/bg9m9r/majik.project/blob/main/docs/RENDER_ENV.md) in the umbrella repo.

## Conventions

From the Majik design system (`/skill majik-design`):

- **MTG vocabulary is exact** — "tapped", "summoning sickness", "stack", "priority", "mulligan", "library", "graveyard", "exile", "battlefield".
- **Sentence case** for buttons + dialogs (`Pass priority`, `Create match`).
- **UPPERCASE + tracking** only for the small section labels (`SEATS`, `EVENT LOG`, `SERVER`).
- **lowercase** for status pills (`hub: open`, `reachable`, `checking…`).
- **WUBRG order** for mana is fixed: White, Blue, Black, Red, Green.
- **No exclamation marks. No emoji.** Anywhere in copy.
- **Hairline rims, no drop shadows** on panels. Depth via `rgba(0,0,0,0.20–0.40)` tinted fills.
- **Two motions only** in the live UI: `transform: rotate(90deg)` on card tap (100ms), instant card-detail hover. Everything else snaps.
- **Desktop ≥1280px.** Mobile / tablet is out of scope for v1.

## License

Open source. Brand mark in `public/logo/` is part of the Majik design system — use as-is if you fork.
