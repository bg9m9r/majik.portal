export interface Card {
  name: string;
  manaCost: string;
  types: string[];
  power: number | null;
  toughness: number | null;
  isImplemented: boolean;
}
