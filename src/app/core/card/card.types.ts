export interface Card {
  name: string;
  manaCost: string;
  types: string[];
  power: number | null;
  toughness: number | null;
  isImplemented: boolean;
  cmc: number | null;
  colors: string[];
  oracleText: string | null;
}

export interface CardFilters {
  colors?: string[];
  types?: string[];
  cmc?: number[];
}
