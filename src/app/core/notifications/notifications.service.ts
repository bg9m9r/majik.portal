import { Injectable, inject } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { environment } from '../../../environments/environment';
import { AuthUserStore } from '../auth/auth-user.store';
import { ToastService } from '../../ui/toast.service';

/** Wire shape of the server's `report-delivered` push (NotificationsHub). */
export interface ReportDeliveredPayload {
  issueNumber: number;
  title: string;
  reloadRequired?: boolean;
}

/**
 * App-wide notifications channel. Connects to the user-scoped
 * `/hubs/notifications` SignalR hub (routed by the auth `sub` claim via the
 * server's SubUserIdProvider — there is NO JoinMatch / room join). Listens
 * for `report-delivered` and raises a sticky "your report is fixed and live —
 * Reload" toast so the reporter can pick up the new build on any screen.
 *
 * The connection setup mirrors {@link SignalrService}: the same
 * HubConnectionBuilder + accessTokenFactory (default cached token) +
 * withAutomaticReconnect, so a session's token is refreshed transparently.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly auth = inject(AuthUserStore);
  private readonly toast = inject(ToastService);

  private connection: HubConnection | null = null;

  /**
   * Open the notifications connection once an auth principal exists.
   * Idempotent — a second call while already connected is a no-op. Safe to
   * call on every route (the app shell does); it self-skips until the user
   * is authenticated.
   */
  async start(): Promise<void> {
    if (this.connection) return;
    if (!this.auth.isAuthenticated() || !this.auth.principal()) return;

    this.connection = new HubConnectionBuilder()
      .withUrl(environment.notificationsHubUrl, {
        // Same default-cached-token strategy as SignalrService: return the
        // cached Auth0 token; the SDK refreshes it transparently near expiry.
        accessTokenFactory: () => this.auth.getAccessToken(),
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('report-delivered', (p: ReportDeliveredPayload) =>
      this.onReportDelivered(p),
    );

    try {
      await this.connection.start();
    } catch {
      // Best-effort: a notifications-hub failure must never break the app.
      // Drop the dead connection so a later start() can retry.
      this.connection = null;
    }
  }

  /**
   * Handle a `report-delivered` push: raise a STICKY toast (no auto-dismiss)
   * whose message names the issue number and whose action reloads the page so
   * the user lands on the freshly-deployed build that carries their fix.
   * Exposed (not private) so the test can drive it without a live hub.
   */
  onReportDelivered(payload: ReportDeliveredPayload): void {
    this.toast.show(
      `Your report #${payload.issueNumber} is fixed and live`,
      {
        severity: 'info',
        sticky: true,
        action: { label: 'Reload', run: () => location.reload() },
      },
    );
  }

  /** Tear down the connection (e.g. on logout). Best-effort. */
  async stop(): Promise<void> {
    if (!this.connection) return;
    try {
      await this.connection.stop();
    } catch {
      // ignore — best-effort cleanup
    }
    this.connection = null;
  }
}
