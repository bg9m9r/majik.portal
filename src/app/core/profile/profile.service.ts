import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { Profile, ProfileError } from './profile.types';

interface ProfileDtoWire {
  sub: string;
  handle: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileErrorWire {
  error: string;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly _profile = signal<Profile | null>(null);
  private readonly _ready = signal<boolean>(false);

  readonly profile = this._profile.asReadonly();
  readonly isReady = this._ready.asReadonly();
  readonly handle = computed(() => this._profile()?.handle ?? null);

  async bootstrap(): Promise<void> {
    if (this.auth.isStub && !this.mongoLikelyConfigured()) {
      // Stub auth + Mongo expected absent: synthesize immediately, no GET.
      this.synthesize();
      this._ready.set(true);
      return;
    }
    // Skip the `GET /me` entirely when the user isn't authenticated. The
    // auth guard will redirect to /login; firing the request would 401
    // anyway and (pre-fix) cause the onboarding guard to redirect to
    // /onboarding instead.
    if (!this.auth.isAuthenticated()) {
      this._ready.set(true);
      return;
    }
    try {
      const dto = await firstValueFrom(
        this.http.get<ProfileDtoWire>(`${environment.apiBaseUrl}/me`));
      this._profile.set({ ...dto });
      this._ready.set(true);
    } catch (err) {
      const e = err as HttpErrorResponse;
      if (e.status === 404) {
        // Authenticated but no row yet — legitimate onboarding case.
        this._profile.set(null);
        this._ready.set(true);
      } else if (e.status === 503) {
        this.synthesize();
        this._ready.set(true);
      } else if (e.status === 401 || e.status === 0) {
        // Auth not ready (token exchange still in flight) or transport
        // failure. DO NOT mark ready — leaving `_ready=false` keeps the
        // onboarding guard from sending an already-onboarded user to
        // /onboarding on a transient error. The auth guard / route
        // navigation will surface the real state once auth settles.
        this._profile.set(null);
      } else {
        // Unknown server error — surface as "no profile, ready" so the
        // user isn't stuck on a blank screen; they'll land on /onboarding
        // and any subsequent save will retry against the live API.
        this._profile.set(null);
        this._ready.set(true);
      }
    }
  }

  async update(handle: string): Promise<{ ok: true; profile: Profile } | { ok: false; error: ProfileError }> {
    try {
      const dto = await firstValueFrom(
        this.http.put<ProfileDtoWire>(`${environment.apiBaseUrl}/me`, { handle }));
      const profile: Profile = { ...dto };
      this._profile.set(profile);
      return { ok: true, profile };
    } catch (err) {
      const e = err as HttpErrorResponse;
      const body = e.error as ProfileErrorWire | undefined;
      const code = body?.error;
      if (e.status === 400 && code === 'invalid-handle') {
        return { ok: false, error: { code: 'invalid-handle', detail: body?.detail } };
      }
      if (e.status === 409 && code === 'handle-taken') {
        return { ok: false, error: { code: 'handle-taken' } };
      }
      if (e.status === 503) {
        return { ok: false, error: { code: 'mongo-not-configured' } };
      }
      if (e.status === 0) {
        return { ok: false, error: { code: 'network' } };
      }
      return { ok: false, error: { code: 'unknown', detail: e.message } };
    }
  }

  /** Client-side fallback for 503/stub-without-mongo: derive a profile
   *  from the auth sub so the rest of the UI works. */
  private synthesize(): void {
    const sub = this.auth.principal()?.sub ?? 'unknown';
    const now = new Date().toISOString();
    this._profile.set({
      sub,
      handle: sub,
      createdAt: now,
      updatedAt: now,
      synthetic: true,
    });
  }

  private mongoLikelyConfigured(): boolean {
    // Heuristic for stub mode only: assume Mongo is configured when
    // apiBaseUrl is set (real backend); otherwise synthesize.
    return !!environment.apiBaseUrl;
  }
}
