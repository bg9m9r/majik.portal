import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';
import { ToastService } from '../../ui/toast.service';

describe('NotificationsService', () => {
  it('report-delivered → sticky toast with Reload action', () => {
    const toast = TestBed.inject(ToastService);
    const spy = vi.spyOn(toast, 'show');
    const svc = TestBed.inject(NotificationsService);
    // Simulate the hub callback (the service exposes onReportDelivered for
    // the .on handler) without standing up a live SignalR connection.
    svc.onReportDelivered({ issueNumber: 50, title: 'wedge', reloadRequired: true });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('#50'),
      expect.objectContaining({
        sticky: true,
        action: expect.objectContaining({ label: expect.stringMatching(/reload/i) }),
      }),
    );
  });
});
