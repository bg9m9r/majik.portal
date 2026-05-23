import { describe, expect, it } from 'vitest';
import { SignalrService } from './signalr.service';

// Pure tests for the static wire→DTO normaliser. Standing up a live
// HubConnection in vitest would require a network double; the routing
// from connection event → Subject is one line of glue, so we test the
// mapping function directly and trust the .on('bot-decision', ...)
// wiring stays simple.
describe('SignalrService.normaliseBotDecision', () => {
  const baseCamel = {
    decisionType: 'Priority',
    chosen: 'CastSpell:Lightning Bolt',
    chosenScore: 4.2,
    alternatives: [
      { name: 'Pass', score: 0 },
      { name: 'PlayLand:Mountain', score: 1 },
    ],
    context: { turn: '3', phase: 'PreCombatMain' },
  };

  const basePascal = {
    DecisionType: 'Priority',
    Chosen: 'CastSpell:Lightning Bolt',
    ChosenScore: 4.2,
    Alternatives: [
      { Name: 'Pass', Score: 0 },
      { Name: 'PlayLand:Mountain', Score: 1 },
    ],
    Context: { turn: '3', phase: 'PreCombatMain' },
  };

  it('decodes a camelCase wire payload', () => {
    const d = SignalrService.normaliseBotDecision(baseCamel);
    expect(d).not.toBeNull();
    expect(d!.decisionType).toBe('Priority');
    expect(d!.chosen).toBe('CastSpell:Lightning Bolt');
    expect(d!.chosenScore).toBeCloseTo(4.2);
    expect(d!.alternatives).toHaveLength(2);
    expect(d!.alternatives[0]).toEqual({ name: 'Pass', score: 0 });
    expect(d!.context['turn']).toBe('3');
  });

  it('decodes a PascalCase wire payload', () => {
    // System.Text.Json default serialization is PascalCase; the
    // normaliser must accept it without route-specific config.
    const d = SignalrService.normaliseBotDecision(basePascal);
    expect(d).not.toBeNull();
    expect(d!.decisionType).toBe('Priority');
    expect(d!.alternatives[1].name).toBe('PlayLand:Mountain');
    expect(d!.alternatives[1].score).toBe(1);
  });

  it('stamps a client-side receivedAt timestamp', () => {
    const before = Date.now();
    const d = SignalrService.normaliseBotDecision(baseCamel)!;
    const after = Date.now();
    expect(d.receivedAt).toBeGreaterThanOrEqual(before);
    expect(d.receivedAt).toBeLessThanOrEqual(after);
  });

  it('returns null when DecisionType is missing', () => {
    // Required-field gate: drop the envelope rather than render a
    // half-populated card on the panel.
    expect(SignalrService.normaliseBotDecision({ chosen: 'X' })).toBeNull();
  });

  it('returns null when Chosen is missing', () => {
    expect(SignalrService.normaliseBotDecision({ decisionType: 'Priority' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(SignalrService.normaliseBotDecision(null)).toBeNull();
    expect(SignalrService.normaliseBotDecision(undefined)).toBeNull();
    expect(SignalrService.normaliseBotDecision('not a decision')).toBeNull();
    expect(SignalrService.normaliseBotDecision(42)).toBeNull();
  });

  it('skips alternative entries that have no name', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
      alternatives: [
        { score: 1 }, // no name — drop
        { name: 'Real', score: 2 },
        null,
        'not-an-object',
      ],
    })!;
    expect(d.alternatives).toHaveLength(1);
    expect(d.alternatives[0]).toEqual({ name: 'Real', score: 2 });
  });

  it('coerces non-string context values to strings', () => {
    // Server BotDecision.Context is IReadOnlyDictionary<string,string>
    // already, but other producers may slip a number through; coerce
    // defensively so the template can render values directly.
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
      context: { turn: 3, manaScrew: true, missing: null },
    })!;
    expect(d.context['turn']).toBe('3');
    expect(d.context['manaScrew']).toBe('true');
    // null coerces to empty string — better than the literal "null".
    expect(d.context['missing']).toBe('');
  });

  it('defaults alternatives to an empty array when omitted', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
    })!;
    expect(d.alternatives).toEqual([]);
  });

  it('defaults context to an empty object when omitted', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 0,
    })!;
    expect(d.context).toEqual({});
  });

  it('coerces a non-finite ChosenScore to 0 rather than NaN', () => {
    const d = SignalrService.normaliseBotDecision({
      decisionType: 'Priority',
      chosen: 'Pass',
      chosenScore: 'not a number',
    })!;
    expect(d.chosenScore).toBe(0);
  });
});
