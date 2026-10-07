import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are available before vi.mock hoisting
const {
  mockCancelAllScheduledNotifications,
  mockSignOut,
  mockForceRemoveSession,
  mockHasSessionInStorage,
  mockWipeLocalUserData,
} = vi.hoisted(() => ({
  mockCancelAllScheduledNotifications: vi.fn(),
  mockSignOut: vi.fn(),
  mockForceRemoveSession: vi.fn(),
  mockHasSessionInStorage: vi.fn(),
  mockWipeLocalUserData: vi.fn(),
}));

// Mock notification service
vi.mock('../services/notificationService', () => ({
  cancelAllScheduledNotifications: mockCancelAllScheduledNotifications,
}));

// Mock supabase module
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: mockSignOut,
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
  forceRemoveSession: mockForceRemoveSession,
  hasSessionInStorage: mockHasSessionInStorage,
}));

// Mock storage
vi.mock('../lib/storage', () => ({
  wipeLocalUserData: mockWipeLocalUserData,
}));

import { signOut } from '../services/authService';

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signOut', () => {
    it('clears session and user data on successful sign-out', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const result = await signOut('user-123');

      expect(mockCancelAllScheduledNotifications).toHaveBeenCalled();
      expect(mockSignOut).toHaveBeenCalled();
      expect(mockWipeLocalUserData).toHaveBeenCalledWith('user-123');
      expect(result.success).toBe(true);
      expect(result.localOnly).toBe(false);
    });

    it('force-removes session on network error (B1 fix)', async () => {
      // Simulate network error on global sign-out
      mockSignOut.mockResolvedValue({
        error: new Error('Network error'),
      });
      // Session should be gone after force remove
      mockHasSessionInStorage.mockReturnValue(false);

      const result = await signOut('user-123');

      // Should have called forceRemoveSession to directly remove from storage
      expect(mockForceRemoveSession).toHaveBeenCalled();
      // User data should still be wiped
      expect(mockWipeLocalUserData).toHaveBeenCalledWith('user-123');
      // Should succeed (locally)
      expect(result.success).toBe(true);
      expect(result.localOnly).toBe(true);
      expect(result.requiresReload).toBe(true);
    });

    it('writes stay blocked when sign-out fails', async () => {
      // Simulate network error that somehow doesn't clear session
      mockSignOut.mockResolvedValue({
        error: new Error('Network error'),
      });
      // Session still exists after force remove attempt (edge case)
      mockHasSessionInStorage.mockReturnValue(true);

      const result = await signOut('user-123');

      // Should report failure
      expect(result.success).toBe(false);
      expect(result.requiresReload).toBe(true);
    });

    it('flushes pending sync before clearing data', async () => {
      mockSignOut.mockResolvedValue({ error: null });
      
      const flushCallback = vi.fn().mockResolvedValue(undefined);
      
      const result = await signOut('user-123', flushCallback);

      // Flush should be called BEFORE wipeLocalUserData
      const flushCallOrder = flushCallback.mock.invocationCallOrder[0];
      const wipeCallOrder = mockWipeLocalUserData.mock.invocationCallOrder[0];
      
      expect(flushCallback).toHaveBeenCalled();
      expect(flushCallOrder).toBeLessThan(wipeCallOrder);
      expect(result.success).toBe(true);
    });

    it('cancels notifications before sign-out', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      await signOut('user-123');

      // Notifications should be cancelled
      expect(mockCancelAllScheduledNotifications).toHaveBeenCalled();
      
      // Cancel should happen before signOut call
      const cancelOrder = mockCancelAllScheduledNotifications.mock.invocationCallOrder[0];
      const signOutOrder = mockSignOut.mock.invocationCallOrder[0];
      expect(cancelOrder).toBeLessThan(signOutOrder);
    });
  });
});
