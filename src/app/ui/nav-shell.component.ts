import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthUserStore } from '../core/auth/auth-user.store';

@Component({
  selector: 'app-nav-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (visible()) {
      <nav class="sticky top-0 z-30 flex items-center gap-3 border-b border-[color:var(--majik-line)] bg-[color:var(--majik-bg)]/90 px-3 py-3 backdrop-blur sm:gap-6 sm:px-6">
        <a routerLink="/lobby" class="majik-display-3 text-[color:var(--majik-accent)] tracking-wide">Majik</a>
        <a routerLink="/lobby"
           routerLinkActive="text-[color:var(--majik-accent)]"
           class="text-sm opacity-80 hover:text-[color:var(--majik-accent)]">Lobby</a>
        <a routerLink="/decks"
           routerLinkActive="text-[color:var(--majik-accent)]"
           class="text-sm opacity-80 hover:text-[color:var(--majik-accent)]">Decks</a>
        <span class="ml-auto hidden truncate text-sm opacity-60 sm:inline">{{ handle() }}</span>
        <button type="button"
                class="rounded border border-[color:var(--majik-line)] px-3 py-1 text-xs uppercase tracking-wider opacity-80 hover:border-[color:var(--majik-accent)] hover:opacity-100"
                aria-label="Log out"
                (click)="onLogout()">Log out</button>
      </nav>
    }
  `,
})
export class NavShellComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthUserStore);
  private readonly profile = this.auth;

  onLogout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  private readonly url = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => (e as NavigationEnd).urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly visible = computed(() => {
    const u = this.url();
    if (u.startsWith('/login')) return false;
    if (u.startsWith('/onboarding')) return false;
    if (u.startsWith('/match/')) return false;
    return true;
  });

  readonly handle = computed(() => this.profile.handle() ?? this.auth.principal()?.sub ?? '');
}
