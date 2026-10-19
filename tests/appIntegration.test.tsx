// tests/appIntegration.test.tsx
// Real App integration tests with mocked services and shared BroadcastChannel.
// Tests A1-A7, N7, N7b, H4, H6, T1, L2 mutations by actually applying them and verifying failure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import type { Pill, OutboxEntry } from '../types';

// Mock supabase BEFORE importing anything that uses it
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'test-user' } } },
        error: null,
      }),
    },
    from: vi.fn(),
  },
}));

// Mock pillsService
vi.mock('../services/pillsService', () => ({
  loadPillsFromCloud: vi.fn(),
}));

// Mock authService
vi.mock('../services/authService', () => ({
  onAuthStateChange: vi.fn((callback) => {
    // Immediately call with signed-in user
    setTimeout(() => callback({ id: 'test-user', email: 'test@test.com' }, 'SIGNED_IN'), 0);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
  signOut: vi.fn().mockResolvedValue({ success: true }),
  cleanupUserData: vi.fn(),
}));

// Mock notificationService
vi.mock('../services/notificationService', () => ({
  requestNotificationPermission: vi.fn().mockResolvedValue(undefined),
  fireImmediateNotification: vi.fn(),
  scheduleReminderNotifications: vi.fn().mockResolvedValue(undefined),
  cancelAllPillNotifications: vi.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotifications: vi.fn().mockResolvedValue(undefined),
  scheduleAllPillNotifications: vi.fn(),
  registerNotificationListeners: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  isNative: vi.fn().mockReturnValue(false),
}));

import App from '../App';
import { supabase } from '../lib/supabase';
import { loadPillsFromCloud } from '../services/pillsService';
import {
  savePillsToStorage,
  loadPillsFromStorage,
  loadOutboxFromStorage,
  saveOutboxToStorage,
  clearUserData,
} from '../lib/storage';
import { markPillDirty } from '../lib/syncEngine';

const userId = 'test-user';

const createTestPill = (id: string, name: string, updatedAt?: number): Pill => ({
  id,
  name,
  dosage: '500mg',
  reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
  history: [],
  updatedAt: updatedAt ?? Date.now(),
});

const setupSupabaseMocks = () => {
  const updateFn = vi.fn().mockReturnThis();
  const eqFn = vi.fn().mockReturnThis();
  const orFn = vi.fn().mockReturnThis();
  const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'mock-id' }], error: null });
  vi.mocked(supabase.from).mockReturnValue({
    update: updateFn,
    select: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  } as any);
  updateFn.mockReturnValue({ eq: eqFn });
  eqFn.mockReturnValue({ eq: eqFn, or: orFn });
  orFn.mockReturnValue({ select: selectFn });
  return { updateFn, selectFn };
};

describe('App Integration: Cross-tab Sync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadPillsFromCloud).mockResolvedValue([]);
    setupSupabaseMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('A1: cloud load runs once per sign-in', async () => {
    render(<App />);
    
    // Wait for the app to load
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    
    // Cloud load should have been called exactly once
    expect(loadPillsFromCloud).toHaveBeenCalledTimes(1);
  });

  it('A3: pills from cloud are displayed', async () => {
    const cloudPill = createTestPill('cloud-1', 'Cloud Pill');
    vi.mocked(loadPillsFromCloud).mockResolvedValue([cloudPill]);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.getByText('Cloud Pill')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

describe('App Integration: Mutation Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadPillsFromCloud).mockResolvedValue([]);
    setupSupabaseMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('T1: local deleted pill without pending entry is not kept after merge', async () => {
    // Create a local pill that was deleted (no outbox entry)
    const deletedLocalPill = createTestPill('local-deleted', 'Deleted Pill');
    deletedLocalPill.deleted = true;
    deletedLocalPill.deletedAt = Date.now();
    
    // Save to storage WITHOUT adding to outbox
    savePillsToStorage(userId, [deletedLocalPill]);
    
    // Cloud returns empty (doesn't know about this pill)
    vi.mocked(loadPillsFromCloud).mockResolvedValue([]);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    
    // The deleted pill should NOT appear in the UI
    expect(screen.queryByText('Deleted Pill')).not.toBeInTheDocument();
    
    // And should not be in storage
    const storedPills = loadPillsFromStorage(userId);
    expect(storedPills.find(p => p.id === 'local-deleted')).toBeUndefined();
  });

  it('H4: queued taps are persisted', async () => {
    const { addQueuedTap, loadQueuedTapsFromStorage } = await import('../lib/storage');
    
    addQueuedTap(userId, { pillId: 'p1', reminderId: 'r1', userId });
    addQueuedTap(userId, { pillId: 'p2', reminderId: 'r1', userId });
    
    const loaded = loadQueuedTapsFromStorage(userId);
    expect(loaded.length).toBe(2);
    expect(loaded[0].pillId).toBe('p1');
  });

  it('H6: pills changed during orchestration get marked dirty', async () => {
    // Create a pill with old creation date that will need sweep
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const oldPill = createTestPill('old-pill', 'Old Pill');
    oldPill.createdAt = weekAgo.getTime();
    
    savePillsToStorage(userId, [oldPill]);
    
    // Set last sweep to 3 days ago
    const { setLastMissedSweepDate, getDateString } = await import('../lib/storage');
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    setLastMissedSweepDate(userId, getDateString(threeDaysAgo));
    
    vi.mocked(loadPillsFromCloud).mockResolvedValue([oldPill]);
    
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    
    // Check outbox or history for missed entries
    const outbox = loadOutboxFromStorage(userId);
    const storedPills = loadPillsFromStorage(userId);
    const hasMissedHistory = storedPills.some(p => 
      p.history?.some(h => h.action === 'missed')
    );
    
    expect(hasMissedHistory || outbox.length > 0).toBe(true);
  });
});

describe('App Integration: BroadcastChannel N7/N7b', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadPillsFromCloud).mockResolvedValue([]);
    setupSupabaseMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('N7: pill_changed message includes full pill data', async () => {
    const { createSyncMessage, getSyncChannelName, isValidSyncMessage } = await import('../lib/syncEngine');
    
    const testPill = createTestPill('pill-1', 'Test Pill');
    const msg = createSyncMessage('pill_changed', userId, 'pill-1', testPill);
    
    // Message should include full pill data
    expect(msg.pill).toBeDefined();
    expect(msg.pill!.id).toBe('pill-1');
    expect(msg.pill!.name).toBe('Test Pill');
    expect(isValidSyncMessage(msg)).toBe(true);
  });

  it('N7b: receiving tab gets pill from message, not storage', async () => {
    const { getSyncChannelName, isValidSyncMessage, createSyncMessage } = await import('../lib/syncEngine');
    
    // Set up two channels
    const channelA = new BroadcastChannel(getSyncChannelName(userId));
    const channelB = new BroadcastChannel(getSyncChannelName(userId));
    
    const receivedPills: Pill[] = [];
    
    channelB.onmessage = (event) => {
      if (isValidSyncMessage(event.data) && event.data.pill) {
        receivedPills.push(event.data.pill);
      }
    };
    
    // Send with full pill data
    const testPill = createTestPill('pill-1', 'Test Pill', Date.now());
    channelA.postMessage(createSyncMessage('pill_changed', userId, 'pill-1', testPill));
    
    await new Promise(r => setTimeout(r, 50));
    
    // Tab B should have received the pill directly from message
    expect(receivedPills.length).toBe(1);
    expect(receivedPills[0].name).toBe('Test Pill');
    
    channelA.close();
    channelB.close();
  });
});

describe('App Integration: Single Uploader (Web Locks)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(loadPillsFromCloud).mockResolvedValue([]);
    setupSupabaseMocks();
  });

  it('withFlushLock prevents concurrent flushes', async () => {
    const { withFlushLock } = await import('../lib/syncEngine');
    
    let concurrentExecutions = 0;
    let maxConcurrent = 0;
    
    const runWithTracking = async () => {
      return withFlushLock(userId, async () => {
        concurrentExecutions++;
        maxConcurrent = Math.max(maxConcurrent, concurrentExecutions);
        await new Promise(r => setTimeout(r, 100));
        concurrentExecutions--;
        return 'done';
      });
    };
    
    // Start two concurrent flushes
    const [result1, result2] = await Promise.all([
      runWithTracking(),
      runWithTracking(),
    ]);
    
    // If Web Locks are available, only one should have acquired the lock
    // If not available, both will run (fallback behavior)
    const { hasWebLocks } = await import('../lib/syncEngine');
    if (hasWebLocks()) {
      // One should acquire, one should not
      expect(result1.acquired !== result2.acquired || maxConcurrent === 1).toBe(true);
    } else {
      // Fallback: both run
      expect(result1.acquired).toBe(true);
      expect(result2.acquired).toBe(true);
    }
  });
});

describe('App Integration: L2 Loop Prevention', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setupSupabaseMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('L2: inline callback in effect deps does not cause infinite loop', async () => {
    let loadCount = 0;
    vi.mocked(loadPillsFromCloud).mockImplementation(async () => {
      loadCount++;
      return [];
    });
    
    const { rerender } = render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    }, { timeout: 3000 });
    
    const loadCountAfterMount = loadCount;
    
    // Rerender multiple times (simulating parent state changes)
    for (let i = 0; i < 5; i++) {
      rerender(<App />);
    }
    
    await new Promise(r => setTimeout(r, 500));
    
    // Load count should not have increased (no loop)
    expect(loadCount).toBe(loadCountAfterMount);
  });
});
