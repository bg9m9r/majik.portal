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
export interface CardSnapshot {
  instanceId: string;
  name: string;
  manaCost: string;
  types: string[];
  power: number | null;
  toughness: number | null;
  tapped: boolean;
  summoningSickness: boolean;
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

export interface StackItem { id: string; kind: string; description: string }

export interface GameState {
  gameId?: string;
  phase: string;
  turnNumber: number;
  activePlayerId: string;
  players: GamePlayer[];
  stack: StackItem[];
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
  | ChooseCardsToBottomCommand;

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
