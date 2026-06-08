# Majik Frontend — Plan

The product target: a 1v1 Magic: The Gathering client with clear, readable controls in the MTG Arena visual idiom (battlefield rows, hand fanned along the bottom, stack on the right, phase bar across the top). Explicitly **no flashy animations** — instant state transitions, restrained CSS only. Commander format deferred.

This document is the high-level shape of the app. The README covers how to build/run/test it.

## Stack

| Concern | Choice |
|---|---|
| Framework | Angular 21, standalone components, signals |
| State | NgRx Signals for the global match store; component-local signals where ceremony is overkill |
| WebSocket | `@microsoft/signalr` against `Majik.Server`'s `/hubs/match` |
| API client | `ng-openapi-gen` from `Majik.Server`'s `/openapi/v1.json` (gitignored, regen with `npm run openapi`) |
| Styling | Tailwind v4 + a small set of hand-written SCSS for board layout (overlap, rotation, fan are bespoke enough that a component library would fight us) |
| Mana symbols | Mana font by Andrew Gioia |
| Card art | Scryfall image CDN |
| Test | Vitest for unit, Playwright for end-to-end |
| Lint/format | ESLint (Angular preset) + Prettier |

## Repository layout

```
majik.portal/
  src/
    app/
      app.config.ts, app.routes.ts, app.ts
      core/
        api/            # ng-openapi-gen output (gitignored)
        signalr/        # SignalR connection lifecycle + typed event/prompt streams
        ...             # shared cross-cutting services
      routes/
        login/          # sign-in landing
        onboarding/     # first-time handle picker
        lobby/          # match list, deck picker, create-match wizard
        decks/          # deck list / editor
        match/          # the heart of the app — board, hand, stack, prompts
          components/   # board, action bar, prompt overlay, bot decisions panel, ...
      ui/               # reusable primitives: CardView, ManaCost, PlayerHud
    styles/
      tokens.scss       # palette + spacing
      board.scss        # bespoke battlefield/hand layout
  openapi.json          # pulled from server at build time (gitignored)
  ng-openapi-gen.json
  angular.json, package.json
```

## State shape (NgRx Signals store `GameStore`)

> The shipped store is an NgRx **Signals** `signalStore`, not a classic
> reducer/action feature. Source of truth: `src/app/core/match/game.store.ts`
> (`GameStoreState`). The shape below is a condensed view — read the file for the
> authoritative, commented definition.

```ts
type GameStoreState = {
  state: GameState | null;       // latest engine snapshot
  prompt: PromptEnvelope | null; // active decision prompt (null when not ours)
  stateVersion: number;          // bumps on every setState/patch (freshness marker)
  selfPlayerIds: string[];       // engine player ids the viewer owns
  recentDecisions: BotDecision[];// capped ring buffer of bot decisions (SignalR)
  phaseStops: PhaseStops;        // per-step stop toggles
  landsPlayedThisTurn: number;   // client-derived land-drop count (CR 305.2)
  lastAnnouncement: string;      // aria-live text …
  lastAnnouncementSeq: number;   // … + seq so screen readers re-announce
  fullControl: boolean;          // MTGO-style Full Control toggle
  clockAnchor: ClockAnchor | null;   // local clock anchor, re-stamped per snapshot
  lastStackMutatedAt: number | null; // stack-display timing (server-contract ref)
  lastStackSig: string;          // cheap stack signature to detect mutation
  tick: number; autoPassTick: number; // 1Hz heartbeats (withHooks interval)
};
```

The store exposes mutations via `withMethods` (e.g. `patchGameState`,
`applyEvent`, `setPrompt`, `pushBotDecision`) and derived view models via `withComputed`, rather
than reducer actions. SignalR + REST feed the store through the match services;
`withHooks` drives the clock tick. Components stay dumb — they read computed
signals and call methods.

## Component hierarchy (match route)

```
<match-page>
  <phase-bar>                       — top strip: turn, phase, active player
  <player-hud opponent>             — opp life/mana/library/graveyard count
  <board>
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
- **Card view:** Scryfall art crop, name strip, mana cost (Mana font), power/toughness pip bottom-right. Hover (>200ms) opens a larger detail card anchored to the right side — appears instantly, no animation.
- **Tap indicator:** rotate the whole card 90° + slightly dimmed (`opacity: 0.85`). Use a double-click on a tappable land to fire its mana ability; for multicolour lands, a small colour picker appears.
- **Targeting:** when a prompt is active, eligible targets get a 2px gold outline; ineligible cards desaturate to grey. Click = pick.
- **Casting:** drag a card from the hand onto the stack panel (or click + confirm) to cast. The action bar mirrors the same options for keyboard users.
- **Phase bar:** linear list (Untap -> Upkeep -> Draw -> Main1 -> ...) with current phase boxed.
- **Stack panel:** newest on top, controller portrait + card name + targets summary. Resolution = item removed instantly (no fade).
- **Motion budget:** card 90° tap rotation (100ms), hover zoom card appear (instant), stack item insert/remove (instant). Everything else snaps.

## Server-side dependencies to watch

The frontend may surface gaps in these as it lands:

- **Action submission via SignalR.** Today every command POSTs `/matches/{id}/commands`. A hub-side `Submit` method would be lower-latency; add it server-side if HTTP-per-action proves laggy.
- **Per-player event payload masking.** Only relevant once events carry data that opponents shouldn't see (e.g. a draw event with the drawn card name). The frontend will need the masked variant when the engine adds it.
- **CORS.** Production frontend is hosted on a different origin from the API; the server must keep its `Cors__AllowedOrigins__0` env var pointed at the portal's host.

## Verification

- Build: `npm run build` produces a static bundle in `dist/majik-portal/browser/`.
- Unit tests: `npm test`.
- E2E: `npm run e2e` (needs a real `Majik.Server` reachable at `$MAJIK_API`).
- Manual: `npm start` against a local server; sanity-check lobby -> match flow.
