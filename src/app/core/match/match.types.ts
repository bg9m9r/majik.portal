export type MatchState =
  | 'Open' | 'Joined' | 'Starting' | 'Rolling'
  | 'Playing' | 'Completed' | 'Abandoned';

export type MatchVisibility = 'Public' | 'Invite';

export type ClockMinutes = 15 | 20 | 25 | 30;

export interface MatchPlayer {
  sub: string;
  handle: string;
  deckId: string;
}

export interface MatchRoll {
  creatorRoll: number | null;
  opponentRoll: number | null;
  winnerSub: string | null;
}

export interface Match {
  id: string;
  state: MatchState;
  visibility: MatchVisibility;
  format: 'constructed';
  clockMinutes: ClockMinutes;
  creator: MatchPlayer;
  opponent: MatchPlayer | null;
  roll: MatchRoll | null;
  firstChoice: 'play' | 'draw' | null;
  gameId: string | null;
  creatorMillisRemaining: number;
  opponentMillisRemaining: number;
  priorityHolderSub: string | null;
  priorityStartedAt: string | null;
  winnerSub: string | null;
  timeoutLoserSub: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MatchErrorCode =
  | 'match-not-found' | 'invalid-request' | 'invalid-clock-minutes'
  | 'self-join-forbidden' | 'match-not-open' | 'not-rolling'
  | 'invalid-choice' | 'not-roll-winner' | 'cannot-concede'
  | 'match-in-progress' | 'forbidden' | 'no-profile'
  | 'private-match' | 'game-not-started' | 'mongo-not-configured'
  | 'not-a-player' | 'network' | 'unknown';

export interface MatchError { code: MatchErrorCode; detail?: string }

export interface CreateMatchRequest {
  format: 'constructed';
  visibility: MatchVisibility;
  deckId: string;
  clockMinutes?: ClockMinutes;
  botOpponent?: { archetype: string };
}

export interface JoinMatchRequest { deckId: string }
export interface PlayDrawRequest { choice: 'play' | 'draw' }

// Replay log — server-side capture of the EventDto + BotDecision stream
// for a match. Returned by GET /matches/:id/replay. The portal treats
// the payload as opaque JSON for download purposes; entries[] carries
// the shape defined in Majik.Server/Matches/MatchReplayDto.cs.
export interface MatchReplay {
  matchId: string;
  sealedAt: string | null;
  truncated: boolean;
  entryCount: number;
  entries: unknown[];
}

// Game-state shapes — kept structurally compatible with the engine's
// GameStateDto (see ng-openapi-gen output under core/api/models). The
// duplicate definition here exists for two reasons:
//   1) generated DTOs widen numerics to (number | string), which would
//      ripple typing churn into every UI consumer;
//   2) the prompt envelope is delivered over SignalR and has no
//      OpenAPI binding, so its shape lives here too.
export interface Ability {
  kind: string;
  description: string;
  // Nullable — absent on older server builds that predate AbilityDto.Id.
  // Mirrors the youPlayerId nullable pattern: undefined/null both mean
  // "id not yet supplied by the server"; code that consumes this field
  // must guard for null/undefined before using it.
  id: string | null;
}

export interface CardSnapshot {
  instanceId: string;
  name: string;
  manaCost: string;
  types: string[];
  power: number | null;
  toughness: number | null;
  tapped: boolean;
  summoningSickness: boolean;
  producedManaColors: string;
  // Activated (and other) abilities on this permanent as reported by the
  // engine's AbilityDto snapshot. Present on battlefield permanents once
  // the companion core PR deploys; absent (undefined) on older snapshots.
  abilities?: Ability[];
  // PLAN 04 / PLAN 07 — counters on this permanent keyed by counter-type
  // name ("+1/+1", "Loyalty", "Charge", …) → count. Populated from the
  // engine's CardSnapshotDto.Counters. The reducer's patchCounterAdded arm
  // bumps this map for a display-only badge; authoritative P/T still come
  // from the next snapshot. Absent (undefined) on older server builds.
  counters?: Record<string, number>;
  // Cards exiled WITH this permanent — e.g. creatures imprinted under
  // Agatha's Soul Cauldron (engine CardSnapshotDto.imprintedCards). These
  // grant the host its abilities; the board renders their names beneath
  // the permanent so the player sees the source. Empty/undefined for
  // ordinary permanents, and absent on older server builds.
  imprintedCards?: CardSnapshot[];
}

export interface ZoneSnapshot { cards: CardSnapshot[] }

export interface ManaPool {
  white: number; blue: number; black: number;
  red: number; green: number; colorless: number; generic: number;
}

export interface GamePlayer {
  id: string;
  name: string;
  life: number;
  hasLost?: boolean;
  mana: ManaPool;
  hand: ZoneSnapshot;
  library: ZoneSnapshot;
  graveyard: ZoneSnapshot;
  exile: ZoneSnapshot;
  battlefield: ZoneSnapshot;
}

export interface StackItem {
  id: string;
  kind: string;
  description: string;
  // Controlling player's seat id (engine StackObjectDto.ControllerId).
  // Lets the UI distinguish the opponent's spells/abilities from the
  // viewer's own so a cast the player must respond to is visually loud.
  // Null/undefined on older server builds (and for ownerless objects) —
  // consumers degrade to "no controller highlight".
  controllerId?: string | null;
  // Human-readable source-card name when the stack object is a spell or a
  // card-sourced ability (engine StackObjectPayload.CardName). Preferred
  // over the raw kind/description in the callout. Absent on snapshots and
  // on older server builds.
  cardName?: string | null;
}

export interface GameState {
  gameId?: string;
  phase: string;
  turnNumber: number;
  activePlayerId: string;
  players: GamePlayer[];
  stack: StackItem[];
  // Authoritative seat id stamped by the server on the /state DTO.
  // When present, the store derives selfPlayerIds from this field
  // instead of the client-side name-match heuristic. Null for
  // spectators and for snapshots fetched from older server versions.
  youPlayerId: string | null;
  // PLAN 04 — per-game monotonic sequence number stamped by the server on
  // the /state DTO (equals the seq of the last event folded into this
  // snapshot). The store drops a snapshot whose seq is older than its
  // current state and uses event contiguity (seq == current+1) to detect
  // gaps. Optional: `normaliseStateSnapshot` always populates it (0 when the
  // server omits it, pre-deploy), and the store's seq gates only engage when
  // BOTH sides are > 0, so an absent/undefined seq degrades cleanly to the
  // prior always-accept behaviour. Optional here keeps hand-built test
  // fixtures (and any other GameState literal) valid without a churn of
  // seq: 0 everywhere.
  seq?: number;
}

// Prompt envelope as sent by MatchFacadeBridge on the "prompt" SignalR
// channel. Mirrors server-side Majik.Core.Api.Dtos.PromptDto. No OpenAPI
// schema (SignalR-only), so the shape is hand-mirrored here.
export interface PromptEnvelope {
  gameId: string;
  playerId: string;
  expectedKinds: string[];
  // Optional human-readable description — present on some prompts to
  // hint about the choice context. Not part of the wire DTO yet but
  // tolerated here so we can surface server-side annotations later
  // without another portal change.
  description?: string;
  // Library-search prompts (CR 701.19a — Green Sun's Zenith, Path to
  // Exile, Mystical Tutor, …) carry the engine-pre-filtered candidate
  // card list here. The library is otherwise hidden in GameState under
  // CR 706 — without these snapshots the portal has no safe way to
  // render a picker. Null on every other prompt kind. The companion
  // `label` is a human-readable description of the search predicate
  // ("green creature card with mana value 2 or less" etc.) sourced
  // from the engine's `kindLabel`.
  candidates?: CardSnapshot[];
  label?: string;
  // CR 701.19a — full library snapshot (top-to-bottom order) sent when the
  // companion core PR is deployed. `candidates` remains the eligible subset
  // (their instanceIds are a strict subset of libraryView's). When present,
  // the overlay renders the full library grid with eligible cards highlighted
  // and ineligible cards muted. When absent (older server build or non-search
  // prompts), the overlay falls back to the flat candidates list.
  libraryView?: CardSnapshot[];
  // CR 701.42 — surveil prompts (DSK surveil-land cycle ETB, Brainstorm-
  // style "surveil N" effects). The engine peeks the top N cards of the
  // surveilling player's library and ships them here in top-to-bottom
  // order. Null on every other prompt kind. The portal surfaces each card
  // with two choices ("to graveyard" / "keep on top") and assembles a
  // ChooseSurveilCommand partitioning the set. Privacy: per-recipient
  // SignalR routing — the opponent never sees these cards.
  surveilView?: CardSnapshot[];
  // CR 117.x / 605.1 — Yes/No "may" prompts (shock-land "pay 2 life?"
  // is the seed caller). Carries the question text + optional source-card
  // label so the modal can be titled by the triggering permanent;
  // yesLabel / noLabel default to "Yes" / "No" on the engine side when
  // the binder doesn't override. Null on every other prompt kind.
  yesNoView?: {
    question: string;
    yesLabel?: string;
    noLabel?: string;
    sourceCardName?: string | null;
  };
  // CR 701.15 — reveal-and-choose prompts (Malevolent Rumble, Impulse,
  // Sleight of Hand, See the Unwritten, …). Ships the full revealed
  // pile + the engine-filtered eligible InstanceIds + the optional
  // flag. The portal highlights eligible cards / mutes non-eligibles
  // and exposes Done + (when optional) Decline buttons. Null on every
  // other prompt kind. Privacy: per-recipient SignalR routing.
  revealView?: {
    revealed: CardSnapshot[];
    eligibleInstanceIds: string[];
    optional: boolean;
    label: string;
  };
  // London mulligan — number of cards to put on the bottom (= mulligans
  // taken). Drives the "Bottom N card(s)" label + exact-N confirm gate.
  // Absent on non-mulligan prompts and on older server builds.
  bottomCount?: number;
  // CR 700.6 / 701.x — generic declarative-choice descriptor (Yawgmoth's
  // "Sacrifice another creature" cost, Grist, MDFC/Gift/Sungold Sentinel,
  // Suppression Ray, Serra's Emissary, …). Non-null ONLY on the generic
  // ChoiceCommand prompt; null on every other kind. The pickable cards
  // ride on the existing `candidates` field. `kind` is the engine's
  // ChoiceKind enum name ("PickOne" / "PickN"); the portal enforces the
  // min..max selection bounds and echoes `kind` back verbatim in its
  // ChoiceCommand response. Without this descriptor the portal had nothing
  // to render and the player wedged holding priority (core PR #2959).
  choiceView?: {
    kind: string;
    min: number;
    max: number;
  };
}

// Polymorphic GameCommand wire envelope — matches
// Majik.Core.Api.Commands.GameCommand on the server. Tagged via the
// "$type" discriminator (the JsonPolymorphic attribute names).
export type GameCommand =
  | PassPriorityCommand
  | PlayLandCommand
  | CastSpellCommand
  | MulliganCommand
  | ChooseTargetsCommand
  | ChooseXCommand
  | ChooseModeCommand
  | DeclareAttackersCommand
  | DeclareBlockersCommand
  | ChooseCardsToBottomCommand
  | ActivateManaAbilityCommand
  | ActivateAbilityCommand
  | ActivateLoyaltyAbilityCommand
  | ChooseManaCommand
  | CancelCastCommand
  | ChooseLibraryPickCommand
  | ChooseSurveilCommand
  | ChooseYesNoCommand
  | ChooseFromRevealedCommand
  | ChoiceCommand;

interface CmdBase { playerId?: string }
export interface PassPriorityCommand extends CmdBase { $type: 'pass' }
export interface PlayLandCommand extends CmdBase { $type: 'play-land'; landInstanceId: string }
export interface CastSpellCommand extends CmdBase {
  $type: 'cast';
  cardInstanceId: string;
  targetInstanceIds: string[];
  xValue: number | null;
  modeIndex: number | null;
}
export interface MulliganCommand extends CmdBase { $type: 'mulligan'; keep: boolean }
export interface ChooseTargetsCommand extends CmdBase {
  $type: 'targets';
  targetInstanceIds: string[];
}
export interface ChooseXCommand extends CmdBase { $type: 'x'; x: number }
export interface ChooseModeCommand extends CmdBase { $type: 'mode'; modeIndex: number }
export interface DeclareAttackersCommand extends CmdBase {
  $type: 'attackers';
  attackers: { attackerInstanceId: string; defenderId: string }[];
}
export interface DeclareBlockersCommand extends CmdBase {
  $type: 'blockers';
  blockers: { attackerInstanceId: string; blockerInstanceId: string }[];
}
export interface ChooseCardsToBottomCommand extends CmdBase {
  $type: 'bottom';
  cardInstanceIds: string[];
}
export interface ActivateManaAbilityCommand extends CmdBase {
  $type: 'activateManaAbility';
  permanentInstanceId: string;
  color: string;
}
export interface ActivateAbilityCommand extends CmdBase {
  $type: 'activateAbility';
  permanentInstanceId: string;
  abilityId: string;
}
// CR 606 — activate a planeswalker's loyalty ability (engine PR #2585).
// The AbilityDto entries with kind === 'Loyalty' carry the signed cost
// in `description` ("+1", "−2", "−5") and a stable `id`. The server only
// advertises loyalty abilities when they're legal (sorcery speed, once
// per turn, payable), but the UI gates defensively on affordability too.
// `playerId` identifies the activating seat; mirrors the server's
// ActivateLoyaltyAbilityCommand fields.
export interface ActivateLoyaltyAbilityCommand extends CmdBase {
  $type: 'activateLoyaltyAbility';
  permanentInstanceId: string;
  loyaltyAbilityId: string;
}
export interface ChooseManaCommand extends CmdBase {
  $type: 'mana';
  sourceInstanceIds: string[];
}
export interface CancelCastCommand extends CmdBase { $type: 'cancelCast' }
// CR 701.19a — response to a library-search prompt. `selectedInstanceId`
// is the InstanceId of the picked candidate, or `null` to model
// "find nothing" (a legal choice — the player may decline to choose).
// Server rejects ids outside the offered candidate set.
export interface ChooseLibraryPickCommand extends CmdBase {
  $type: 'chooseLibraryPick';
  selectedInstanceId: string | null;
}
// CR 701.42 — response to a surveil prompt. The engine peeked N cards
// (shipped on PromptEnvelope.surveilView in top-to-bottom order); the
// client partitions them into two disjoint lists: which to send to the
// graveyard and which to keep on top (in the order the player wants
// them, where index 0 becomes the new top of library). Server rejects
// payloads that don't cover the peeked set exactly once.
export interface ChooseSurveilCommand extends CmdBase {
  $type: 'chooseSurveil';
  toGraveyardInstanceIds: string[];
  topOrderInstanceIds: string[];
}
// CR 117.x / 605.1 — response to a Yes/No "may" prompt (shock-land
// "pay 2 life?" is the seed caller). The bool answer is the only payload;
// the server's binder-chain holds the per-prompt context (which land,
// which cost) so the client doesn't need to echo it back.
export interface ChooseYesNoCommand extends CmdBase {
  $type: 'chooseYesNo';
  answer: boolean;
}
// CR 701.15 — response to a reveal-and-choose prompt (Malevolent Rumble,
// Impulse, Sleight of Hand, See the Unwritten, …). `instanceId` is the
// picked eligible card or `null` to decline (only legal when the
// prompt's revealView.optional flag is true OR no eligible cards exist).
// Server coerces out-of-set ids to decline + logs rather than throwing
// so a stale or malicious pick can't crash a live match.
export interface ChooseFromRevealedCommand extends CmdBase {
  $type: 'chooseFromRevealed';
  instanceId: string | null;
}
// CR 700.6 / 701.x — response to a generic declarative-choice prompt
// (Yawgmoth's "Sacrifice another creature" cost, Grist, MDFC/Gift/Sungold
// Sentinel, Suppression Ray, Serra's Emissary, …). The server's unified
// choice sink (PromptDto.ChoiceView, core PR #2959) drives this. `kind` is
// the ChoiceKind enum name echoed back verbatim off the prompt's choiceView;
// `selectedInstanceIds` are the picked candidate ids (1 for PickOne, min..max
// for PickN). `yesNo` is only meaningful for the YesNo kind (a dedicated
// ChooseYesNoCommand path already handles "may" prompts), so it's left
// false here. Mirrors Majik.Core.Api.Commands.ChoiceCommand ("$type": "choice").
export interface ChoiceCommand extends CmdBase {
  $type: 'choice';
  kind: string;
  selectedInstanceIds: string[];
  yesNo: boolean;
}

// Bot decision envelope — mirrors server-side
// Majik.Bot.Diagnostics.BotDecision. Arrives on the SignalR
// "bot-decision" channel (group broadcast — there's no per-viewer
// masking on this surface; bot decisions describe the bot's own seat
// and carry no opponent-hidden info beyond names already on the
// battlefield/stack via existing engine events).
//
// Shape is deliberately small: a short DecisionType tag, the chosen
// action label + score, up to ~3 losing candidates with their scores
// (descending), and a free-form context flag bag for diagnostics
// (mana-available, manaScrew, phase, turn, etc.).
export interface BotDecisionAlternative { name: string; score: number }
export interface BotDecision {
  decisionType: string;
  chosen: string;
  chosenScore: number;
  alternatives: BotDecisionAlternative[];
  context: Record<string, string>;
  // Client-only field: timestamp the panel uses for relative ordering
  // when the recent-decisions ring is rendered. Stamped on receive so
  // server-clock skew doesn't matter for the UI.
  receivedAt: number;
}

// SignalR event payloads
export interface StateChangedPayload { matchId: string; state: MatchState; transitionedAt: string }
export interface OpponentJoinedPayload { matchId: string; opponent: MatchPlayer }
export interface RolledPayload { matchId: string; roll: MatchRoll }
export interface PlayDrawChosenPayload { matchId: string; choice: 'play' | 'draw'; firstPlayerSub: string }
export interface ClockUpdatePayload { matchId: string; creatorMs: number; opponentMs: number; holder: string; startedAt: string }
export interface TimedOutPayload { matchId: string; loserSub: string; winnerSub: string }
export interface PlayerRolledPayload { matchId: string; sub: string; roll: number }
export interface BotThinkingPayload { matchId: string; thinking: boolean }
