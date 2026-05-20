export interface DeckCardEntry {
  name: string;
  count: number;
}

export interface Deck {
  id: string;
  ownerSub: string;
  name: string;
  mainboard: DeckCardEntry[];
  sideboard: DeckCardEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeckRequest {
  name: string;
  mainboard: DeckCardEntry[];
  sideboard: DeckCardEntry[];
}

export type UpdateDeckRequest = CreateDeckRequest;

export type DeckErrorCode =
  | 'invalid-deck'
  | 'name-taken'
  | 'deck-cap-reached'
  | 'deck-not-found'
  | 'concurrent-edit'
  | 'mongo-not-configured'
  | 'no-profile'
  | 'network'
  | 'unknown';

export interface DeckError {
  code: DeckErrorCode;
  validation?: string[];
  detail?: string;
}
