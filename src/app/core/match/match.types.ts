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
}

export interface JoinMatchRequest { deckId: string }
export interface PlayDrawRequest { choice: 'play' | 'draw' }

// Minimal game-state types (engine integration ships in a later sub-project;
// these stand-ins keep the board/prompt components compilable with no generated DTOs.)
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
  mana: ManaPool;
  hand: ZoneSnapshot;
  library: ZoneSnapshot;
  graveyard: ZoneSnapshot;
  exile: ZoneSnapshot;
  battlefield: ZoneSnapshot;
}

export interface StackItem { id: string; kind: string; description: string }

export interface GameState {
  phase: string;
  turnNumber: number;
  activePlayerId: string;
  players: GamePlayer[];
  stack: StackItem[];
}

// SignalR event payloads
export interface StateChangedPayload { matchId: string; state: MatchState; transitionedAt: string }
export interface OpponentJoinedPayload { matchId: string; opponent: MatchPlayer }
export interface RolledPayload { matchId: string; roll: MatchRoll }
export interface PlayDrawChosenPayload { matchId: string; choice: 'play' | 'draw'; firstPlayerSub: string }
export interface ClockUpdatePayload { matchId: string; creatorMs: number; opponentMs: number; holder: string; startedAt: string }
export interface TimedOutPayload { matchId: string; loserSub: string; winnerSub: string }
export interface PlayerRolledPayload { matchId: string; sub: string; roll: number }
