import { describe, expect, it } from 'vitest';
import { bucketBattlefield } from './bucket-battlefield';
import { CardSnapshot } from '../../../core/match/match.types';

function card(over: Partial<CardSnapshot> & Pick<CardSnapshot, 'instanceId' | 'types'>): CardSnapshot {
  return {
    instanceId: over.instanceId,
    name: over.name ?? over.instanceId,
    manaCost: over.manaCost ?? '',
    types: over.types,
    power: over.power ?? null,
    toughness: over.toughness ?? null,
    tapped: over.tapped ?? false,
    summoningSickness: over.summoningSickness ?? false,
    producedManaColors: over.producedManaColors ?? '',
    abilities: over.abilities,
  };
}

describe('bucketBattlefield', () => {
  it('returns empty buckets for empty / null / undefined input', () => {
    expect(bucketBattlefield([])).toEqual({ frontline: [], lands: [], utility: [] });
    expect(bucketBattlefield(null)).toEqual({ frontline: [], lands: [], utility: [] });
    expect(bucketBattlefield(undefined)).toEqual({ frontline: [], lands: [], utility: [] });
  });

  it('puts a vanilla Creature on the frontline', () => {
    const creature = card({ instanceId: 'c1', types: ['Creature'] });
    const r = bucketBattlefield([creature]);
    expect(r.frontline).toEqual([creature]);
    expect(r.lands).toEqual([]);
    expect(r.utility).toEqual([]);
  });

  it('puts a Land in the lands bucket (backline left)', () => {
    const land = card({ instanceId: 'l1', types: ['Land'] });
    const r = bucketBattlefield([land]);
    expect(r.lands).toEqual([land]);
    expect(r.frontline).toEqual([]);
    expect(r.utility).toEqual([]);
  });

  it('puts a non-creature Artifact in the utility bucket', () => {
    const art = card({ instanceId: 'a1', types: ['Artifact'] });
    const r = bucketBattlefield([art]);
    expect(r.utility).toEqual([art]);
  });

  it('puts a non-creature Enchantment in the utility bucket', () => {
    const enc = card({ instanceId: 'e1', types: ['Enchantment'] });
    const r = bucketBattlefield([enc]);
    expect(r.utility).toEqual([enc]);
  });

  it('puts a Planeswalker in the utility bucket', () => {
    const pw = card({ instanceId: 'pw1', types: ['Planeswalker'] });
    const r = bucketBattlefield([pw]);
    expect(r.utility).toEqual([pw]);
  });

  it('puts an Artifact-Creature on the frontline (creature wins)', () => {
    const ac = card({ instanceId: 'ac1', types: ['Artifact', 'Creature'] });
    const r = bucketBattlefield([ac]);
    expect(r.frontline).toEqual([ac]);
    expect(r.utility).toEqual([]);
  });

  it('puts an Enchantment-Creature on the frontline (creature wins)', () => {
    const ec = card({ instanceId: 'ec1', types: ['Enchantment', 'Creature'] });
    const r = bucketBattlefield([ec]);
    expect(r.frontline).toEqual([ec]);
    expect(r.utility).toEqual([]);
  });

  it('puts a creature token on the frontline (token-ness is irrelevant to bucketing)', () => {
    const tok = card({ instanceId: 'tok1', name: 'Treasure', types: ['Token', 'Creature'] });
    const r = bucketBattlefield([tok]);
    expect(r.frontline).toEqual([tok]);
  });

  it('matches types case-insensitively', () => {
    const a = card({ instanceId: 'a', types: ['creature'] });
    const b = card({ instanceId: 'b', types: ['LAND'] });
    const c = card({ instanceId: 'c', types: ['artifact'] });
    const r = bucketBattlefield([a, b, c]);
    expect(r.frontline).toEqual([a]);
    expect(r.lands).toEqual([b]);
    expect(r.utility).toEqual([c]);
  });

  it('preserves source order within each bucket', () => {
    const a = card({ instanceId: 'a', types: ['Creature'] });
    const b = card({ instanceId: 'b', types: ['Land'] });
    const c = card({ instanceId: 'c', types: ['Creature'] });
    const d = card({ instanceId: 'd', types: ['Artifact'] });
    const e = card({ instanceId: 'e', types: ['Land'] });
    const r = bucketBattlefield([a, b, c, d, e]);
    expect(r.frontline.map(x => x.instanceId)).toEqual(['a', 'c']);
    expect(r.lands.map(x => x.instanceId)).toEqual(['b', 'e']);
    expect(r.utility.map(x => x.instanceId)).toEqual(['d']);
  });

  it('handles a card with no types array gracefully (falls into utility)', () => {
    // Should not throw if `types` is empty — the card sinks into the
    // utility bucket as a "non-creature non-land permanent".
    const weird = card({ instanceId: 'w', types: [] });
    const r = bucketBattlefield([weird]);
    expect(r.utility).toEqual([weird]);
  });
});
