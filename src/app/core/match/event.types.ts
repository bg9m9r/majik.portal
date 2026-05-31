// Wire shape of EventDto as broadcast over the SignalR "event" channel.
// Mirrors Majik.Core.Api.Dtos.EventDto on the server. The Payload is
// type-specific (see EventPayloadBuilder.cs); each event type below
// declares the camelCase shape of its payload.
//
// SignalR's default JSON protocol serialises records with the runtime
// PropertyNamingPolicy; the inner Payload is hand-rolled with explicit
// camelCase keys, so we read camelCase here. The OUTER envelope can
// arrive as PascalCase or camelCase depending on server JSON config, so
// the normaliser below tolerates both — matching the existing pattern
// used by the prompt$ subscriber in match.ts.

export interface RawEventDto {
  eventId?: string; EventId?: string;
  type?: string; Type?: string;
  at?: string; At?: string;
  payload?: unknown; Payload?: unknown;
  // PLAN 04 — per-game monotonic sequence number. Absent on a pre-seq
  // (pre-deploy) server, in which case it normalises to 0 and the seq gates
  // degrade to the prior always-accept behaviour.
  seq?: number; Seq?: number;
}

export interface NormalisedEventDto {
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  // PLAN 04 — the event's seq (0 when the server omits it).
  seq: number;
}

export function normaliseEvent(raw: unknown): NormalisedEventDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawEventDto;
  const type = r.type ?? r.Type;
  if (!type || typeof type !== 'string') return null;
  const payload = (r.payload ?? r.Payload ?? {}) as Record<string, unknown>;
  const eventId = String(r.eventId ?? r.EventId ?? '');
  const seqRaw = r.seq ?? r.Seq;
  const seq = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? seqRaw : 0;
  return { eventId, type, payload, seq };
}

// Convenience helpers for payload reads — payload keys are camelCase on
// the wire but we accept the PascalCase variant defensively so a future
// server JSON config flip doesn't silently break patch routing.
export function pickString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k] ?? payload[k.charAt(0).toUpperCase() + k.slice(1)];
    if (typeof v === 'string') return v;
  }
  return null;
}

export function pickNumber(payload: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = payload[k] ?? payload[k.charAt(0).toUpperCase() + k.slice(1)];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

export function pickBoolean(payload: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = payload[k] ?? payload[k.charAt(0).toUpperCase() + k.slice(1)];
    if (typeof v === 'boolean') return v;
  }
  return null;
}

export function pickStringArray(payload: Record<string, unknown>, ...keys: string[]): string[] | null {
  for (const k of keys) {
    const v = payload[k] ?? payload[k.charAt(0).toUpperCase() + k.slice(1)];
    if (Array.isArray(v) && v.every(item => typeof item === 'string')) {
      return v as string[];
    }
  }
  return null;
}
