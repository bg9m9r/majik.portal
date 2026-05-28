import { CardSnapshot } from '../../../core/match/match.types';

/**
 * Type-bucketed projection of a battlefield zone for the zoned layout.
 *
 *   frontline — creatures (incl. creature tokens, Artifact-Creatures,
 *               Enchantment-Creatures). Closest to the centerline.
 *   lands     — backline LEFT column.
 *   utility   — backline RIGHT column. Artifacts + Enchantments
 *               (non-creature), Planeswalkers, and any other
 *               non-creature permanent fall here.
 *
 * Bucketing is by `CardSnapshot.types`, case-insensitive `includes`.
 * Order within each bucket preserves the source array order so the
 * caller's stable @for trackBy by instanceId keeps working.
 */
export interface BattlefieldBuckets {
  frontline: CardSnapshot[];
  lands: CardSnapshot[];
  utility: CardSnapshot[];
}

function hasType(card: CardSnapshot, type: string): boolean {
  const target = type.toLowerCase();
  return (card.types ?? []).some(t => t.toLowerCase() === target);
}

export function bucketBattlefield(cards: readonly CardSnapshot[] | null | undefined): BattlefieldBuckets {
  const frontline: CardSnapshot[] = [];
  const lands: CardSnapshot[] = [];
  const utility: CardSnapshot[] = [];
  if (!cards) return { frontline, lands, utility };

  for (const c of cards) {
    // Creature wins over every other type: an Artifact-Creature or
    // Enchantment-Creature belongs on the frontline because that's
    // where it attacks/blocks from.
    if (hasType(c, 'creature')) {
      frontline.push(c);
      continue;
    }
    if (hasType(c, 'land')) {
      lands.push(c);
      continue;
    }
    // Everything else — Artifacts, Enchantments, Planeswalkers, plus
    // any future non-creature permanent — falls into the utility
    // (backline right) column.
    utility.push(c);
  }

  return { frontline, lands, utility };
}
