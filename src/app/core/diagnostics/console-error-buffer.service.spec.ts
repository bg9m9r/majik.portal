import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ConsoleErrorBuffer } from './console-error-buffer.service';

describe('ConsoleErrorBuffer', () => {
  let buf: ConsoleErrorBuffer;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ConsoleErrorBuffer] });
    buf = TestBed.inject(ConsoleErrorBuffer);
  });

  it('keeps most-recent-last and caps at 20', () => {
    for (let i = 0; i < 25; i++) buf.record(`err ${i}`);
    const recent = buf.recent();
    expect(recent.length).toBe(20);
    expect(recent[recent.length - 1]).toContain('err 24');
    expect(recent[0]).toContain('err 5');
  });
});
