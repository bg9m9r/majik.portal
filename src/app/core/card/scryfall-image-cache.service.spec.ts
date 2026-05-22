import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScryfallImageCache } from './scryfall-image-cache.service';

function flush(ms = 200): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ScryfallImageCache', () => {
  let svc: ScryfallImageCache;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
    fetchMock = vi.fn();
    // jsdom exposes fetch on globalThis; assign our mock.
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    TestBed.configureTestingModule({ providers: [ScryfallImageCache] });
    svc = TestBed.inject(ScryfallImageCache);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('get returns null for unknown name', () => {
    expect(svc.get('Nonexistent')).toBeNull();
  });

  it('request resolves image_uris.normal and bumps version', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { name: 'Lightning Bolt', image_uris: { normal: 'https://img/bolt.png' } },
      ],
      not_found: [],
    }));

    const v0 = svc.version();
    svc.request(['Lightning Bolt']);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.scryfall.com/cards/collection');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ identifiers: [{ name: 'Lightning Bolt' }] });
    expect(svc.get('Lightning Bolt')).toBe('https://img/bolt.png');
    expect(svc.version()).toBeGreaterThan(v0);
  });

  it('falls back to card_faces[0].image_uris.normal for double-faced cards', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        {
          name: 'Delver of Secrets // Insectile Aberration',
          card_faces: [
            { image_uris: { normal: 'https://img/delver-front.png' } },
            { image_uris: { normal: 'https://img/delver-back.png' } },
          ],
        },
      ],
      not_found: [],
    }));

    svc.request(['Delver of Secrets']);
    await flush();

    expect(svc.get('Delver of Secrets')).toBe('https://img/delver-front.png');
  });

  it('rejects non-https image URLs from Scryfall responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        { name: 'Sketchy Card', image_uris: { normal: 'javascript:alert(1)' } },
      ],
      not_found: [],
    }));

    svc.request(['Sketchy Card']);
    await flush();

    expect(svc.get('Sketchy Card')).toBeNull();
  });

  it('drops non-https entries when loading the persisted cache', () => {
    const STORAGE_KEY = 'majik:scryfall-img-cache:v1';
    // Install an in-memory localStorage shim if the test env doesn't provide one.
    const store = new Map<string, string>();
    const shim: Storage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      key: (i) => Array.from(store.keys())[i] ?? null,
      removeItem: (k) => { store.delete(k); },
      setItem: (k, v) => { store.set(k, String(v)); }
    };
    const g = globalThis as unknown as { localStorage: Storage };
    const original = g.localStorage;
    g.localStorage = shim;

    try {
      shim.setItem(STORAGE_KEY, JSON.stringify({
        'Evil Card': 'javascript:alert(1)',
        'Good Card': 'https://img/good.png',
      }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });

      // Fresh injector so a new instance loads from localStorage.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [ScryfallImageCache] });
      const fresh = TestBed.inject(ScryfallImageCache);

      expect(fresh.get('Evil Card')).toBeNull();
      expect(fresh.get('Good Card')).toBe('https://img/good.png');
      expect(warn).toHaveBeenCalled();

      // Persisted storage should be rewritten without the bad entry.
      const after = JSON.parse(shim.getItem(STORAGE_KEY) ?? '{}');
      expect(after['Evil Card']).toBeUndefined();
      expect(after['Good Card']).toBe('https://img/good.png');
    } finally {
      g.localStorage = original;
    }
  });

  it('splits batches larger than 75 into multiple requests', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { identifiers: Array<{ name: string }> };
      return jsonResponse({
        data: body.identifiers.map((i) => ({
          name: i.name,
          image_uris: { normal: `https://img/${encodeURIComponent(i.name)}.png` },
        })),
        not_found: [],
      });
    });

    const names = Array.from({ length: 80 }, (_, i) => `Card ${i}`);
    svc.request(names);
    await flush(500);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatch = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    const secondBatch = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(firstBatch.identifiers).toHaveLength(75);
    expect(secondBatch.identifiers).toHaveLength(5);
    expect(svc.get('Card 0')).toBe('https://img/Card%200.png');
    expect(svc.get('Card 79')).toBe('https://img/Card%2079.png');
  });
});
