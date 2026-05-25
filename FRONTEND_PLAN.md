# Majik Frontend — Plan

## Context

`Majik.Server` exposes the engine as an authoritative game server: REST under `/games/*` + `/hubs/game` SignalR hub, OIDC bearer-token auth, OpenAPI doc at `/openapi/v1.json`. Phase 3 server work is complete (commit `4a388bc`); the engine is ready for a UI to drive it.

Goal: a 1v1 Magic: The Gathering client with **clear, readable controls** in the MTG Arena visual idiom (battlefield rows, hand fanned along the bottom, stack on the right, phase bar across the top). Explicitly **no flashy animations** — instant state transitions, restrained CSS only. Commander format deferred.

## Stack recommendation

**Confirmed:** Angular 18+ with NgRx. Brett's stated preference. No reason to push back — Angular's strict typing, DI, and RxJS pipeline fit the SignalR event stream well, and NgRx provides the predictable state shape this game needs.

Surrounding choices:

| Concern | Choice | Why |
|---|---|---|
| Framework | **Angular 18+** (standalone components, signals) | Confirmed. Standalone components avoid NgModule overhead; signals interop is solid in 18. |
| State | **NgRx 18** + `@ngrx/effects` + `@ngrx/signals` | NgRx for global game state (canonical event-sourced shape from server). `@ngrx/signals` for component-local view state where Redux ceremony is overkill. |
| WebSocket | **`@microsoft/signalr`** (official client) | Matches the server hub. TypeScript types ship with the package. |
| API client | **`ng-openapi-gen`** generating from `/openapi/v1.json` | Build-time codegen produces typed services for every endpoint added in Phase 3. Regenerate when server contract changes. |
| Styling | **Tailwind CSS** + small set of hand-written SCSS for board layout | Utility-first keeps the Arena aesthetic achievable without a heavy component library. Layout (overlap, rotation, fan) is bespoke enough that a library would fight us. |
| Icons | **Lucide** (or Tabler) via `lucide-angular` | Clean line icons for action bar, phase bar, mana symbols. |
| Mana symbols | **Mana font** by Andrew Gioia (`@mana-font`) | Free, comprehensive, used by Scryfall and MTG community tooling. |
| Card art | **Scryfall image CDN** (`https://api.scryfall.com/cards/.../image`) | Free, stable URIs, already part of the engine's card pipeline. |
| Build | Angular CLI (default Vite + esbuild backend in 18) | No customisation needed. |
| Test | Vitest (`@analogjs/vitest-angular`) for unit, Playwright for E2E | Faster than Karma; Playwright integrates with the SignalR client cleanly. |
| Lint/format | ESLint (Angular preset) + Prettier | Standard. |

**Alternative considered:** React + Redux Toolkit + TanStack Query. Slightly leaner, larger ecosystem. Not recommended here because Brett asked for Angular and the Angular + NgRx stack matches the long-form RxJS-heavy SignalR event stream more naturally than React. Stay on Angular.

## Repository layout

New sibling repo (or subfolder) `majik-web/`. **Not** in the .NET solution. Independent build, deploy, and version. Recommended subfolder for now (mono-repo simplicity); split out once frontend has its own deploy cadence.

```
majik-web/
  src/
    app/
      core/
        auth/           # OIDC bootstrap, AuthGuard, interceptor that attaches bearer token
        api/            # ng-openapi-gen output (generated, gitignored)
        signalr/        # SignalRService — connection lifecycle, typed event/prompt streams
      state/
        game/           # feature store: snapshot, events log, current prompt
        seating/        # which player slot the client owns
        connection/     # signalr connection state
      routes/
        login/
        lobby/
        game/
          components/   # Battlefield, Hand, Stack, PhaseBar, ActionBar, PromptOverlay
      ui/               # Reusable: CardView, ManaCost, ZoneCount, PlayerHud
    styles/
      tokens.scss       # Color, spacing, radii — the design system
      board.scss        # Battlefield/hand bespoke layout
  openapi.yaml          # Pulled from server's /openapi/v1.json at build time
  ng-openapi-gen.json
  angular.json
  package.json
```

## State shape (NgRx feature `game`)

```ts
interface GameState {
  id: string | null;          // current game guid
  selfPlayerId: string | null;
  opponentPlayerId: string | null;
  snapshot: GameStateDto | null;     // last /state response
  events: EventDto[];                 // append-only event log (capped)
  currentPrompt: PromptDto | null;   // null when not our turn to choose
  connection: 'idle' | 'connecting' | 'open' | 'closed';
  error: string | null;
}
```

Reducers respond to:

- `gameCreated`, `gameJoined`, `seatClaimed`, `gameStarted`
- `snapshotReceived` (REST GET /state response)
- `eventReceived` (SignalR `event`)
- `promptReceived` (SignalR `prompt`)
- `commandSubmitted`, `commandAccepted`, `commandRejected`
- `connectionStateChanged`

Effects:

- `SignalrEffects` — connect on game-page enter, disconnect on leave, dispatch `eventReceived` / `promptReceived` from hub messages.
- `CommandEffects` — listen for `submitCommand` action, POST through generated client, dispatch result.
- `SnapshotPollEffects` — refresh snapshot on `connectionRestored` (recovery after WS drop).

Selectors expose derived view models (one per zone), keeping components dumb.

## Component hierarchy (game route)

```
<game-page>
  <phase-bar>                       — top strip: turn, phase, active player
  <player-hud opponent>             — opp life/mana/library/graveyard count
  <battlefield>
    <battlefield-row opponent>      — opp creatures + lands
    <battlefield-row self>          — your creatures + lands
  <stack-panel>                     — right rail; bottom-up order
  <hand-row>                        — bottom: fanned cards, hover to zoom
  <action-bar>                      — pass priority / declare done buttons
  <player-hud self>                 — your life/mana/library/graveyard count
  <prompt-overlay *ngIf="prompt">   — modal: choose target / X / mode / mulligan
```

Two-row battlefield avoids Arena's diagonal lanes (which need animations to read). Tap = `transform: rotate(90deg)` with a 100ms ease-out. Summoning sickness = subtle dotted outline, no swirl.

## Visual design notes

- **Palette:** deep desaturated background (`#0f1722`), warm parchment for cards (`#d6c39a`), accent gold for active player (`#caa75a`). Hidden information uses a slate placeholder card (`#3a4458`).
- **Card view:** Scryfall art crop, name strip, mana cost (Mana font), power/toughness pip bottom-right. Hover (>200ms) opens a larger detail card anchored to the right side — never animates in, just appears.
- **Tap indicator:** rotate the whole card 90° + slightly dimmed (`opacity: 0.85`).
- **Targeting:** when a prompt is active, eligible targets get a 2px gold outline; ineligible cards desaturate to grey. Click = pick.
- **Phase bar:** linear list (Untap → Upkeep → Draw → Main1 → ...) with current phase boxed. Click a phase to "pass until here" once that engine command exists (deferred).
- **Stack panel:** newest on top, controller portrait + card name + targets summary. Resolution = item slides out at the top (no fade, instant remove).
- **No motion design beyond:** card 90° tap rotation (100ms), hover zoom card appear (instant), stack item insert/remove (instant). Everything else snaps.

## Routing flow

1. `/login` — landing + sign-in. On success, navigate to `/lobby`.
2. `AuthGuard` protects `/lobby` and `/game/:id`.
3. `/lobby` — list active games (GET /games returns count; future enhancement adds search), button to create new. Once created, route to `/game/:newId`.
4. `/game/:id` — claim seat on enter (POST /games/{id}/seat); both seats must be claimed before start. "Start game" button calls POST /games/{id}/start?mode=full when both seats are filled.

## Phased roadmap (frontend slices, mirror server cadence)

**Each slice ships standalone**, mirroring how the engine + server were built. Estimate is rough — adjust as the design lands.

1. **Scaffold + auth** — Angular 18 standalone app, Tailwind, AuthGuard, dummy `/lobby` and `/game/:id` routes. ~1 day.
2. **API client + healthz** — wire `ng-openapi-gen`, generate typed services from `/openapi/v1.json`. Hit /whoami and render the principal. ~½ day.
3. **Lobby** — create game form (alice/bob names), redirect to `/game/:id`. ~½ day.
4. **Seat claim UI** — both players visit /game/:id, claim their slot. Shows "waiting for opponent" until both claimed. ~½ day.
5. **SignalR connection** — `SignalrEffects`, dispatch `eventReceived` / `promptReceived`. Show raw event log for debugging. ~1 day.
6. **Battlefield + hand layout (read-only)** — render snapshot. Two-row battlefield, fanned hand, opponent hand as count placeholders. Card art from Scryfall. ~2 days.
7. **Phase bar + player HUD** — top strip + HUD for both players. ~½ day.
8. **Action bar — pass priority** — single button, sends PassPriorityCommand. Disabled when not prompted. ~½ day.
9. **Play land + cast simple instants/sorceries** — click hand card → if it matches the current prompt, dispatch PlayLand or CastSpell. ~1–2 days.
10. **Target prompt overlay** — when ChooseTargets prompt arrives, dim ineligible, gold-outline eligible, click to pick. ~1 day.
11. **X / mode / mulligan prompts** — modal variants of the prompt overlay. ~1 day.
12. **Stack panel + resolution rendering** — render Stack from snapshot, update on `StackObjectAddedEvent` / `StackObjectResolvedEvent`. ~1 day.
13. **Combat UI** — declare attackers / blockers prompts. Drag-or-click assignment, then confirm. ~2 days.
14. **End-to-end smoke** — Playwright test driving two browser contexts through a real game against a running server. ~1 day.
15. **Polish + accessibility audit** — keyboard navigation (Tab through hand, Enter to cast), screen-reader labels on every interactive card, contrast pass. ~1 day.

Total rough estimate: 12–15 dev days for a playable v1.

## Open decisions

The implementation plan can answer these as their slices land:

- **Card image cache** — proxy through the server vs. hit Scryfall directly from the browser. Direct is simpler; revisit if CORS / rate-limit becomes an issue.
- **Mobile / tablet support** — out of scope for v1. Design for desktop ≥1280px. Tablet-friendly layout adapts later.
- **Spectator view** — server can support it (StateSnapshotter has a no-viewer "spectator" mode), but no UI for now. v1 = players only.
- **Deck builder** — out of scope. v1 uses hardcoded test decks loaded server-side; deck construction is a separate sub-project once gameplay is solid.
- **Replay** — server has the action log (`ActionLog`) but no /replay endpoint yet. Defer until v1 ships and we know what shape replay needs.

## Critical files (will exist post-implementation)

- `majik-web/src/app/core/signalr/signalr.service.ts` — single connection, typed `event$` and `prompt$` observables.
- `majik-web/src/app/state/game/game.effects.ts` — bridge SignalR to NgRx.
- `majik-web/src/app/state/game/game.selectors.ts` — derives per-zone view models.
- `majik-web/src/app/routes/game/components/battlefield.component.ts` — main board.
- `majik-web/src/app/routes/game/components/prompt-overlay.component.ts` — every choice modal lives here, switched by `currentPrompt.expectedKinds`.

## Server-side dependencies still pending

The frontend will exercise these as it lands, and may surface gaps:

- **Action submission via SignalR** — currently every command POSTs `/games/{id}/commands`. For low-latency UX a hub-side `Submit` method would be cleaner. Add as a later server slice if HTTP-per-action proves laggy.
- **Per-player event payload masking** — engine-side deferred per Phase 3 plan; only relevant once events carry data that opponents shouldn't see (e.g. a draw event carrying the drawn card name to the drawer). Frontend will need the masked variant when the engine adds it.
- **CORS** — server doesn't currently enable CORS. When the frontend is hosted on a different origin from the API, add `AddCors` + an explicit allowed-origins policy on the server.

## Verification

- Build: `npm run build` produces a static bundle.
- Unit tests: `npm test` runs Vitest suites for selectors + effects.
- E2E: `npm run e2e` boots a real `Majik.Server` instance + spins two browser contexts (alice + bob), drives a full short game, asserts the winner UI renders.
- Manual: `npm start` against a local server; sanity-check the lobby → game flow.
