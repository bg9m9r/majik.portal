# majik.portal

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=bg9m9r_majik.portal&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=bg9m9r_majik.portal)

Web client for [Majik](https://github.com/bg9m9r/majik) — the open-source Magic: The Gathering rules engine. Free, 1v1, desktop. Live at [majik.tech](https://majik.tech).

This is the Angular UI. All gameplay logic is server-authoritative; the portal subscribes to engine events over SignalR and dispatches player intents back.

## Stack

- **Angular 21** — standalone components, signals, lazy routes.
- **NgRx Signals** — global state.
- **`@microsoft/signalr`** — live match feed against `Majik.Server`'s `/hubs/match`.
- **Tailwind v4** + design tokens in `src/styles/tokens.scss`, board layout in `src/styles/board.scss`.
- **`ng-openapi-gen`** — typed API client generated from `Majik.Server`'s `/openapi/v1.json` into `src/app/core/api/` (gitignored — regen with `npm run openapi`).
- **Vitest** for unit tests, **Playwright** for e2e.

## Local development

```bash
npm install
npm run openapi            # fetches $MAJIK_API/openapi/v1.json (defaults to localhost:5057), generates src/app/core/api/
npm start                  # ng serve -> http://localhost:4200
```

`npm run openapi` needs a running `Majik.Server` to pull the OpenAPI doc from. See [`majik.core`'s README](https://github.com/bg9m9r/majik/blob/main/README.md) for how to start it.

## Tests

```bash
npm test                   # unit tests
npm run e2e:install        # one-time Playwright browser install
npm run e2e                # Playwright end-to-end tests
```

## Build

```bash
npm run build              # production build -> dist/majik-portal/browser/
```

Production build uses Angular's `fileReplacements` to swap `environment.ts` -> `environment.production.ts`. On Render the heredoc in `render.yaml`'s `buildCommand` writes the resolved env values (e.g. `MAJIK_API_URL`) into `environment.production.ts` before `ng build`.

## Where things live

- `src/app/routes/` — one folder per top-level route (`login/`, `onboarding/`, `lobby/`, `decks/`, `match/`). Each is lazy-loaded; see `src/app/app.routes.ts`.
- **`src/app/routes/match/`** is the heart of the app — board, hand, stack, prompts, action bar, bot-decision panel. Components under `match/components/`.
- `src/app/core/` — cross-cutting infrastructure: SignalR connection (`core/signalr/`), generated API client (`core/api/`, gitignored), shared services.
- `src/app/ui/` — reusable visual primitives (card view, mana cost, player HUD).
- `src/styles/tokens.scss` — palette + spacing tokens. `board.scss` — bespoke battlefield/hand layout.

## Routes

| Route | Page |
|---|---|
| `/login` | sign-in |
| `/onboarding` | first-time handle picker |
| `/lobby` | match list, deck picker, create-match wizard |
| `/decks` | deck list / editor |
| `/match/:id` | game board (phase bar, HUDs, battlefield, stack, prompts) |

## Deploy

Render Blueprint in [`render.yaml`](./render.yaml). Static site bound to [majik.tech](https://majik.tech). Build pipeline on Render:

1. `npm ci`
2. `npm run openapi` against `$MAJIK_API_URL/openapi/v1.json` — regenerates the typed API client.
3. Heredoc-writes `environment.production.ts` with the resolved env vars.
4. `ng build` — produces the static bundle.
5. Render serves `dist/majik-portal/browser/` with SPA rewrite `/* -> /index.html`.

Env var contract: see [`docs/RENDER_ENV.md`](https://github.com/bg9m9r/majik.project/blob/main/docs/RENDER_ENV.md) in the umbrella repo.

## Conventions

From the Majik design system (`/skill majik-design`):

- **MTG vocabulary is exact** — "tapped", "summoning sickness", "stack", "priority", "mulligan", "library", "graveyard", "exile", "battlefield".
- **Sentence case** for buttons + dialogs (`Pass priority`, `Create match`).
- **UPPERCASE + tracking** only for the small section labels (`SEATS`, `EVENT LOG`, `SERVER`).
- **lowercase** for status pills (`hub: open`, `reachable`, `checking…`).
- **WUBRG** order for mana is fixed: White, Blue, Black, Red, Green.
- **No exclamation marks. No emoji.** Anywhere in copy.
- **Hairline rims, no drop shadows** on panels. Depth via `rgba(0,0,0,0.20–0.40)` tinted fills.
- **Two motions only** in the live UI: `transform: rotate(90deg)` on card tap (100ms), instant card-detail hover. Everything else snaps.
- **Desktop ≥1280px.** Mobile / tablet is out of scope for v1.

## Rules authority

The engine cites `MagicCompRules 20251114.txt` (2025-11-14 Comp Rules) as the source of truth. When the UI surfaces wording (prompts, tooltips, etc.), match the rules text. Cite rule numbers (e.g. `Rule 704.5j`) in code and reviews.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). All commits must carry a DCO `Signed-off-by` trailer (`git commit -s`).

## License

Source code is licensed under the [Apache License, Version 2.0](./LICENSE). Third-party attributions in [`NOTICE`](./NOTICE).

Brand mark in `public/logo/` is part of the Majik design system — use as-is if you fork; do not modify it to imply endorsement.

### Magic: The Gathering Fan Content

majik.portal is unofficial Fan Content permitted under the [Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved or endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC.

"Magic: The Gathering" and all related card names, mana symbols, set symbols, and rules text rendered by this client are trademarks and/or copyrighted material of Wizards of the Coast LLC.
