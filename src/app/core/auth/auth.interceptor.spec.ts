import { describe, expect, it } from 'vitest';
import { shouldAttachAuth } from './auth.interceptor';

describe('shouldAttachAuth — URL gating', () => {
  describe('with apiBase set', () => {
    const base = 'https://majik-api.onrender.com';

    it('attaches for URLs starting with apiBase', () => {
      expect(shouldAttachAuth(`${base}/decks`, base)).toBe(true);
      expect(shouldAttachAuth(`${base}/hubs/match`, base)).toBe(true);
    });

    it('does NOT attach for other origins', () => {
      expect(shouldAttachAuth('https://api.scryfall.com/cards', base)).toBe(false);
      expect(shouldAttachAuth('https://evil.example.com/steal', base)).toBe(false);
    });

    it('does NOT attach for same-origin relative paths when apiBase is set', () => {
      expect(shouldAttachAuth('/decks', base)).toBe(false);
    });
  });

  describe('with empty apiBase (same-origin SPA)', () => {
    it('attaches for paths starting with single slash', () => {
      expect(shouldAttachAuth('/api/decks', '')).toBe(true);
      expect(shouldAttachAuth('/hubs/match', '')).toBe(true);
    });

    it('does NOT attach for protocol-relative URLs (token leak guard)', () => {
      // Regression: previously `url.startsWith('/')` accepted '//evil.com/x', which the browser
      // resolves to `https://evil.com/x`. Descope would have attached the bearer token.
      expect(shouldAttachAuth('//evil.example.com/steal-token', '')).toBe(false);
      expect(shouldAttachAuth('//attacker', '')).toBe(false);
    });

    it('does NOT attach for absolute http(s) URLs', () => {
      expect(shouldAttachAuth('https://api.scryfall.com/cards/named', '')).toBe(false);
      expect(shouldAttachAuth('http://localhost:5057/decks', '')).toBe(false);
    });
  });
});
