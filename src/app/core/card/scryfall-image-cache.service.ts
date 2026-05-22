import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const STORAGE_KEY = 'majik:scryfall-img-cache:v1';
const BATCH_SIZE = 75;
const DEBOUNCE_MS = 50;
const BATCH_SPACING_MS = 120;
const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';

interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
}

interface ScryfallCardFace {
  image_uris?: ScryfallImageUris;
}

interface ScryfallCard {
  name?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
}

interface ScryfallCollectionResponse {
  data?: ScryfallCard[];
  not_found?: Array<{ name?: string }>;
}

@Injectable({ providedIn: 'root' })
export class ScryfallImageCache {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  readonly version = signal(0);

  constructor() {
    this.load();
  }

  get(name: string): string | null {
    return this.cache.get(this.key(name)) ?? null;
  }

  request(names: string[]): void {
    if (!this.isBrowser) return;
    for (const raw of names) {
      const name = this.key(raw);
      if (!name) continue;
      if (this.cache.has(name)) continue;
      if (this.inFlight.has(name)) continue;
      if (this.pending.has(name)) continue;
      this.pending.add(name);
    }
    if (this.pending.size === 0) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private key(name: string): string {
    return (name ?? '').trim();
  }

  private async flush(): Promise<void> {
    const names = Array.from(this.pending);
    this.pending = new Set<string>();
    if (names.length === 0) return;
    for (const n of names) this.inFlight.add(n);

    const batches: string[][] = [];
    for (let i = 0; i < names.length; i += BATCH_SIZE) {
      batches.push(names.slice(i, i + BATCH_SIZE));
    }

    let changed = false;
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) await this.sleep(BATCH_SPACING_MS);
      try {
        const batch = batches[i];
        const res = await fetch(COLLECTION_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
        });
        if (!res.ok) {
          console.warn(`ScryfallImageCache: collection request failed (${res.status})`);
          for (const n of batch) this.inFlight.delete(n);
          continue;
        }
        const body = (await res.json()) as ScryfallCollectionResponse;
        const returnedNames = new Set<string>();
        for (const card of body.data ?? []) {
          const name = card.name ? this.key(card.name) : '';
          const url = this.pickImageUrl(card);
          // Try to match against the requested batch by case-insensitive name.
          const matched = this.matchBatchName(batch, name);
          if (matched && url) {
            this.cache.set(matched, url);
            returnedNames.add(matched);
            changed = true;
          } else if (name && url) {
            this.cache.set(name, url);
            returnedNames.add(name);
            changed = true;
          }
        }
        for (const n of batch) this.inFlight.delete(n);
      } catch (err) {
        console.warn('ScryfallImageCache: collection request errored', err);
        for (const n of batches[i]) this.inFlight.delete(n);
      }
    }

    if (changed) {
      this.persist();
      this.version.update((v) => v + 1);
    }
  }

  private matchBatchName(batch: string[], scryfallName: string): string | null {
    if (!scryfallName) return null;
    const lower = scryfallName.toLowerCase();
    for (const candidate of batch) {
      if (candidate.toLowerCase() === lower) return candidate;
    }
    // Double-faced cards return names like "Front // Back". Try the front half.
    const front = lower.split(' // ')[0];
    for (const candidate of batch) {
      if (candidate.toLowerCase() === front) return candidate;
    }
    return null;
  }

  private pickImageUrl(card: ScryfallCard): string | null {
    const direct = card.image_uris?.normal;
    if (direct) return direct;
    const face = card.card_faces?.[0]?.image_uris?.normal;
    if (face) return face;
    return null;
  }

  private load(): void {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') this.cache.set(k, v);
        }
      }
    } catch (err) {
      console.warn('ScryfallImageCache: failed to load cache', err);
    }
  }

  private persist(): void {
    if (!this.isBrowser) return;
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.cache) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
      console.warn('ScryfallImageCache: failed to persist; clearing key', err);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
