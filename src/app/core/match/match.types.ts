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
  creatorRoll: number;
  opponentRoll: number;
  winnerSub: string;
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
  | 'network' | 'unknown';

export interface MatchError { code: MatchErrorCode; detail?: string }

export interface CreateMatchRequest {
  format: 'constructed';
  visibility: MatchVisibility;
  deckId: string;
  clockMinutes?: ClockMinutes;
}

export interface JoinMatchRequest { deckId: string }
export interface PlayDrawRequest { choice: 'play' | 'draw' }
