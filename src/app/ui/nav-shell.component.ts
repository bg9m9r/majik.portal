import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { ProfileService } from '../core/profile/profile.service';

@Component({
  selector: 'app-nav-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    @if (visible()) {
      <nav class="sticky top-0 z-30 flex items-center gap-6 border-b border-[color:var(--majik-line)] bg-[color:var(--majik-bg)]/90 px-6 py-3 backdrop-blur">
        <a routerLink="/lobby" class="majik-display-3 text-[color:var(--majik-accent)] tracking-wide">Majik</a>
        <a routerLink="/lobby"
           routerLinkActive="text-[color:var(--majik-accent)]"
           class="text-sm opacity-80 hover:text-[color:var(--majik-accent)]">Lobby</a>
        <a routerLink="/decks"
           routerLinkActive="text-[color:var(--majik-accent)]"
           class="text-sm opacity-80 hover:text-[color:var(--majik-accent)]">Decks</a>
        <span class="ml-auto text-sm opacity-60">{{ handle() }}</span>
      </nav>
    }
  `,
})
export class NavShellComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);

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
