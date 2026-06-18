import { Component, HostListener, computed, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CardPopoverService } from './card-popover.service';

@Component({
  selector: 'app-card-detail-popover',
  standalone: true,
  template: `
    @if (popover.current(); as p) {
      <div
        role="tooltip"
        class="pointer-events-none fixed z-50 w-[280px] max-h-[calc(100vh-16px)] overflow-y-auto rounded border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] p-3 shadow-[var(--shadow-modal)]"
        [style.left.px]="position().left"
        [style.top.px]="position().top">
        <img class="mb-2 w-full rounded"
             [src]="imageUrl(p.card.name)"
             [alt]="p.card.name"
             referrerpolicy="no-referrer" />
        <div class="flex flex-col gap-1">
          <p class="majik-h3 opacity-80">{{ p.card.name }}</p>
          @if (p.card.manaCost) {
            <p class="font-mono text-xs opacity-70">{{ p.card.manaCost }}</p>
          }
          <p class="text-xs opacity-70">{{ p.card.types.join(' ') }}</p>
          @if (p.card.oracleText) {
            <p class="whitespace-pre-line text-xs opacity-80">{{ p.card.oracleText }}</p>
          }
          @if (p.card.power !== null && p.card.toughness !== null) {
            <p class="font-mono text-xs opacity-70">{{ p.card.power }}/{{ p.card.toughness }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class CardDetailPopoverComponent {
  readonly popover = inject(CardPopoverService);
  private readonly router = inject(Router);

  /**
   * Document-level click dismissal is only armed one event-loop tick AFTER the
   * popover opens. This prevents the SAME click that opened it (the context-menu
   * "View details" click, which calls popover.show() during its own click event,
   * and the desktop long-press preview) from immediately closing it — that click
   * is still in flight / bubbling when current() flips truthy, so without this
   * guard the document:click listener would fire on it and self-dismiss.
   */
  private clickArmed = false;

  constructor() {
    // Arm/disarm the click-anywhere dismissal as the popover opens/closes.
    effect(() => {
      if (this.popover.current()) {
        this.clickArmed = false;
        setTimeout(() => {
          // Only arm if still open after the tick (opening click has settled).
          if (this.popover.current()) this.clickArmed = true;
        }, 0);
      } else {
        this.clickArmed = false;
      }
    });

    // Leaving the current view (e.g. match → lobby) must always clear the
    // popover; CardPopoverService is a root singleton whose state would
    // otherwise survive router navigation.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.popover.hide());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.popover.current()) return;
    this.popover.hide();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (!this.clickArmed) return;
    if (!this.popover.current()) return;
    this.popover.hide();
  }

  readonly position = computed(() => {
    const cur = this.popover.current();
    if (!cur) return { left: 0, top: 0 };
    const r = cur.rect;
    const popoverWidth = 280;
    // Approximate height — covers card image + meta. Used only to clamp the
    // popover inside the viewport; the actual element auto-sizes to content.
    const popoverHeight = 460;
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
    let left = r.right + margin;
    if (left + popoverWidth > vw) {
      left = r.left - popoverWidth - margin;
    }
    if (left < margin) left = margin;
    let top = r.top;
    if (top + popoverHeight > vh - margin) {
      top = vh - margin - popoverHeight;
    }
    if (top < margin) top = margin;
    return { left, top };
  });

  imageUrl(name: string): string {
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name).replace(/%20/g, '+')}&format=image&version=normal`;
  }
}
