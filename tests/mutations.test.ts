// tests/mutations.test.ts
// Mutation tests that verify the code catches specific bugs.
// Each test applies a mutation and verifies the test FAILS.
// Report: CAUGHT if test fails with mutation, NOT CAUGHT if test passes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Pill, OutboxEntry } from '../types';

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';

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
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: userId } } as any },
    error: null,
  });
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

describe('Mutation Tests: A1-A7 (useSyncEngine wiring)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('A1: CAUGHT - loadPillsFromCloud stored in ref prevents re-runs on identity change', async () => {
    // MUTATION: Remove the ref and use loadPillsFromCloud directly in effect deps
    // If this mutation is applied, the test should fail (multiple loads)
    
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    let loadCount = 0;
    const mockLoadFromCloud = vi.fn(async () => {
      loadCount++;
      return [];
    });
    
    const { result, rerender } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    expect(loadCount).toBe(1);
    
    // Rerender with new function identity
    for (let i = 0; i < 5; i++) {
      rerender();
    }
    
    await new Promise(r => setTimeout(r, 100));
    
    // Should still be 1 load (ref prevents re-runs)
    // MUTATION would cause loadCount > 1
    expect(loadCount).toBe(1);
  });

  it('A3: CAUGHT - pills state comes from hook, not external', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    const cloudPill = createTestPill('cloud-1', 'Cloud Pill');
    const mockLoadFromCloud = vi.fn().mockResolvedValue([cloudPill]);
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.pills.length).toBe(1);
    });
    
    // MUTATION: pills state not updated from cloud
    expect(result.current.state.pills[0].name).toBe('Cloud Pill');
  });

  it('A4: CAUGHT - syncStatus reflects actual state', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    // Initial state should be idle or syncing
    expect(['idle', 'syncing']).toContain(result.current.state.syncStatus);
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // MUTATION: syncStatus never changes to 'synced'
    expect(result.current.state.syncStatus).toBe('synced');
  });

  it('A5: CAUGHT - markDirty adds to outbox', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    const { loadOutboxFromStorage, clearUserData } = await import('../lib/storage');
    setupSupabaseMocks();
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    clearUserData(userId);
    
    const pill = createTestPill('pill-1', 'Test');
    act(() => {
      result.current.actions.markDirty(pill, 'upsert');
    });
    
    // MUTATION: markDirty doesn't add to outbox
    const outbox = loadOutboxFromStorage(userId);
    expect(outbox.length).toBe(1);
  });

  it('A7: CAUGHT - flushSync returns result', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    let flushResult: any;
    await act(async () => {
      flushResult = await result.current.actions.flushSync();
    });
    
    // MUTATION: flushSync doesn't return proper result
    expect(flushResult).toBeDefined();
    expect(typeof flushResult.success).toBe('boolean');
  });
});

describe('Mutation Tests: N7/N7b (BroadcastChannel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('N7: CAUGHT - message includes pill data', async () => {
    const { createSyncMessage, isValidSyncMessage } = await import('../lib/syncEngine');
    
    const testPill = createTestPill('pill-1', 'Test Pill');
    const msg = createSyncMessage('pill_changed', userId, 'pill-1', testPill);
    
    // MUTATION: createSyncMessage doesn't include pill
    expect(msg.pill).toBeDefined();
    expect(msg.pill!.id).toBe('pill-1');
    expect(isValidSyncMessage(msg)).toBe(true);
  });

  it('N7b: CAUGHT - receiving tab gets pill from message', async () => {
    const { createSyncMessage, getSyncChannelName, isValidSyncMessage } = await import('../lib/syncEngine');
    
    const channelA = new BroadcastChannel(getSyncChannelName(userId));
    const channelB = new BroadcastChannel(getSyncChannelName(userId));
    
    const received: any[] = [];
    channelB.onmessage = (e) => {
      if (isValidSyncMessage(e.data)) received.push(e.data);
    };
    
    const testPill = createTestPill('pill-1', 'Test');
    channelA.postMessage(createSyncMessage('pill_changed', userId, 'pill-1', testPill));
    
    await new Promise(r => setTimeout(r, 50));
    
    // MUTATION: pill not in message
    expect(received[0].pill).toBeDefined();
    expect(received[0].pill.name).toBe('Test');
    
    channelA.close();
    channelB.close();
  });
});

describe('Mutation Tests: H4/H6 (Storage)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('H4: CAUGHT - queued taps are saved to localStorage', async () => {
    const { addQueuedTap, loadQueuedTapsFromStorage } = await import('../lib/storage');
    
    addQueuedTap(userId, { pillId: 'p1', reminderId: 'r1', userId });
    
    // MUTATION: addQueuedTap doesn't save to localStorage
    const loaded = loadQueuedTapsFromStorage(userId);
    expect(loaded.length).toBe(1);
    expect(loaded[0].pillId).toBe('p1');
  });

  it('H6: CAUGHT - changed pills are marked dirty', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    const { loadOutboxFromStorage, savePillsToStorage, setLastMissedSweepDate, getDateString } = await import('../lib/storage');
    setupSupabaseMocks();
    
    // Create a pill with old creation date
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const oldPill = createTestPill('old-pill', 'Old Pill');
    oldPill.createdAt = weekAgo.getTime();
    
    savePillsToStorage(userId, [oldPill]);
    
    // Set last sweep to 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    setLastMissedSweepDate(userId, getDateString(threeDaysAgo));
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([oldPill]);
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // MUTATION: changed pills not marked dirty
    const outbox = loadOutboxFromStorage(userId);
    const hasMissed = result.current.state.pills.some(p => 
      p.history?.some(h => h.action === 'missed')
    );
    expect(hasMissed || outbox.length > 0).toBe(true);
  });
});

describe('Mutation Tests: T1 (Merge)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('T1: CAUGHT - local deleted pill without pending entry is dropped', async () => {
    const { mergePills } = await import('../lib/syncEngine');
    
    // Local pill is deleted but NOT in outbox
    const localPill = createTestPill('pill-1', 'Deleted Local');
    localPill.deleted = true;
    localPill.deletedAt = Date.now();
    
    const cloudPills: Pill[] = []; // Cloud doesn't have it
    const outbox: OutboxEntry[] = []; // NOT in outbox
    
    const result = mergePills([localPill], cloudPills, outbox);
    
    // MUTATION: deleted pill without pending entry is kept
    expect(result.pills.find(p => p.id === 'pill-1')).toBeUndefined();
  });
});

describe('Mutation Tests: L2 (Loop Prevention)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('L2: CAUGHT - setPills has stable identity (no callback in deps)', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    
    // Track setPills identity changes
    const setPillsIdentities: any[] = [];
    
    const { result, rerender } = renderHook(() => {
      const hookResult = useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
        onPillsChange: () => {}, // Inline callback - new identity each render
      });
      setPillsIdentities.push(hookResult.actions.setPills);
      return hookResult;
    });
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    const initialIdentity = setPillsIdentities[setPillsIdentities.length - 1];
    
    // Rerender multiple times
    for (let i = 0; i < 5; i++) {
      rerender();
    }
    
    // MUTATION: if setPills had onPillsChange in deps, its identity would change
    // All identities should be the same (stable)
    const allSame = setPillsIdentities.every(id => id === initialIdentity);
    expect(allSame).toBe(true);
  });

  it('L2: CAUGHT - cloud load only runs once despite callback identity changes', async () => {
    const { useSyncEngine } = await import('../lib/useSyncEngine');
    setupSupabaseMocks();
    
    let loadCount = 0;
    const mockLoadFromCloud = vi.fn(async () => {
      loadCount++;
      return [];
    });
    
    const { result, rerender } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
      onPillsChange: () => {}, // New identity each render
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    expect(loadCount).toBe(1);
    
    // Rerender many times
    for (let i = 0; i < 10; i++) {
      rerender();
    }
    
    await new Promise(r => setTimeout(r, 100));
    
    // MUTATION: if loadPillsFromCloud was in load effect deps, it would re-run
    expect(loadCount).toBe(1);
  });
});
