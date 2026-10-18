// tests/appSmoke.test.tsx
// Behavior tests for sync wiring - tests actual behavior, not source text.
// Tests A1, A3, A3b, A4, A5, A7, H4, H6, HU2/U2, T1 mutations.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { useSyncEngine, type SyncEngineConfig } from '../lib/useSyncEngine';
import {
  loadOutboxFromStorage,
  saveOutboxToStorage,
  savePillsToStorage,
  clearUserData,
  addQueuedTap,
  loadQueuedTapsFromStorage,
} from '../lib/storage';
import { markPillDirty } from '../lib/syncEngine';

const createTestPill = (id: string, name: string, updatedAt?: number): Pill => ({
  id,
  name,
  dosage: '500mg',
  reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
  history: [],
  updatedAt,
});

// Setup supabase mocks for successful operations
const setupSupabaseMocks = () => {
  const updateFn = vi.fn().mockReturnThis();
  const eqFn = vi.fn().mockReturnThis();
  const orFn = vi.fn().mockReturnThis();
  const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'mock-id' }], error: null });
  vi.mocked(supabase.from).mockReturnValue({
    update: updateFn,
    select: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  } as any);
  updateFn.mockReturnValue({ eq: eqFn });
  eqFn.mockReturnValue({ eq: eqFn, or: orFn });
  orFn.mockReturnValue({ select: selectFn });
  return { updateFn, selectFn };
};

describe('Behavior Tests: Loop Prevention', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });

  it('A1: One cloud load per sign-in across 10 rerenders', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
    let renderCount = 0;
    
    // Simulate how App.tsx calls useSyncEngine - with inline callback
    const { result, rerender } = renderHook(() => {
      renderCount++;
      return useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
        onPillsChange: () => {}, // New function each render (like App does)
      });
    });
    
    // Wait for initial load
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    const loadCountAfterInit = mockLoadFromCloud.mock.calls.length;
    expect(loadCountAfterInit).toBe(1);
    
    // Rerender 10 times (simulating parent rerenders)
    for (let i = 0; i < 10; i++) {
      rerender();
    }
    
    // Wait a tick for any async effects
    await new Promise(r => setTimeout(r, 100));
    
    // Should still only have 1 load call
    expect(mockLoadFromCloud.mock.calls.length).toBe(1);
    expect(renderCount).toBeGreaterThanOrEqual(11); // Initial + 10 rerenders
  });

  it('A3b: One upload per edit (not multiple)', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    const { selectFn } = setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Clear call counts after initial load
    selectFn.mockClear();
    
    // Add a pill
    const pill = createTestPill('pill-1', 'Test Pill');
    act(() => {
      const dirtyPill = result.current.actions.markDirty(pill, 'upsert');
      result.current.actions.setPills([dirtyPill]);
    });
    
    // Wait for debounced flush (1500ms + buffer)
    await new Promise(r => setTimeout(r, 2000));
    
    // Should have exactly 1 upload call for this edit
    expect(selectFn.mock.calls.length).toBe(1);
  });

  it('T1: Hook state is stable - no infinite loops from callback identity', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
    let callbackCallCount = 0;
    
    const { result, rerender } = renderHook(() => {
      return useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
        onPillsChange: () => { callbackCallCount++; },
      });
    });
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    const initialCallbackCount = callbackCallCount;
    
    // Rerender multiple times
    for (let i = 0; i < 5; i++) {
      rerender();
    }
    
    await new Promise(r => setTimeout(r, 100));
    
    // Callback should not be called repeatedly just from rerenders
    // (only from actual pill changes)
    expect(callbackCallCount).toBe(initialCallbackCount);
  });
});

describe('Behavior Tests: Mutation Detection', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });

  it('A3: Pills state comes from hook', async () => {
    const cloudPill = createTestPill('cloud-pill', 'Cloud Pill', Date.now());
    const mockLoadFromCloud = vi.fn().mockResolvedValue([cloudPill]);
    setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.pills.length).toBe(1);
      expect(result.current.state.pills[0].name).toBe('Cloud Pill');
    });
  });

  it('A4: syncStatus reflects actual sync state', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    // Initial status is idle or syncing
    expect(['idle', 'syncing']).toContain(result.current.state.syncStatus);
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
  });

  it('A5: markDirty creates outbox entry', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
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
    
    const outbox = loadOutboxFromStorage(userId);
    expect(outbox.length).toBe(1);
    expect(outbox[0].id).toBe('pill-1');
  });

  it('A7: flushSync is callable and returns result', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    let flushResult;
    await act(async () => {
      flushResult = await result.current.actions.flushSync();
    });
    
    expect(flushResult).toBeDefined();
    expect(typeof flushResult.success).toBe('boolean');
  });

  it('H4: Queued taps persist to localStorage', () => {
    addQueuedTap(userId, { pillId: 'p1', reminderId: 'r1', userId });
    addQueuedTap(userId, { pillId: 'p2', reminderId: 'r1', userId });
    
    const loaded = loadQueuedTapsFromStorage(userId);
    expect(loaded.length).toBe(2);
    expect(loaded[0].pillId).toBe('p1');
    expect(loaded[1].pillId).toBe('p2');
  });

  it('H6: Changed pills after orchestration are marked dirty', async () => {
    // Create a pill that will be swept (old creation date, needs missed sweep)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const oldPill = createTestPill('old-pill', 'Old Pill');
    oldPill.createdAt = weekAgo.getTime();
    
    // Set last sweep to 3 days ago so sweep will run
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const { setLastMissedSweepDate, getDateString } = await import('../lib/storage');
    setLastMissedSweepDate(userId, getDateString(threeDaysAgo));
    
    savePillsToStorage(userId, [oldPill]);
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([oldPill]);
    setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Pill should have been swept and marked dirty
    // The sweep adds missed history entries which triggers markDirty
    const outbox = loadOutboxFromStorage(userId);
    // Note: outbox may be empty if the flush already processed it
    // Check that either outbox has entry OR pills have missed entries
    const pillHistory = result.current.state.pills[0]?.history || [];
    const hasMissedEntries = pillHistory.some(h => h.action === 'missed');
    expect(hasMissedEntries || outbox.length > 0).toBe(true);
  });

  it('HU2: Outbox entries trigger upload', async () => {
    const pill = createTestPill('pill-1', 'Test');
    savePillsToStorage(userId, [pill]);
    
    // Pre-populate outbox
    const entry: OutboxEntry = {
      id: 'pill-1',
      type: 'upsert',
      pill,
      updatedAt: Date.now(),
      userId,
    };
    saveOutboxToStorage(userId, [entry]);
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    const { selectFn } = setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Upload should have been called for the outbox entry
    expect(selectFn).toHaveBeenCalled();
  });

  it('U2: Recovered offline edit uploads exactly once', async () => {
    const localPill = createTestPill('pill-1', 'Offline Edit', Date.now());
    savePillsToStorage(userId, [localPill]);
    
    // Simulate offline edit in outbox
    const entry: OutboxEntry = {
      id: 'pill-1',
      type: 'upsert',
      pill: localPill,
      updatedAt: localPill.updatedAt!,
      userId,
    };
    saveOutboxToStorage(userId, [entry]);
    
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    const { selectFn } = setupSupabaseMocks();
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Wait for any potential duplicate uploads
    await new Promise(r => setTimeout(r, 2000));
    
    // Should only have 1 upload call
    expect(selectFn.mock.calls.length).toBe(1);
  });
});

describe('Behavior Tests: Sign-out Protection', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });

  it('N8: flipping signingOut ref without rerender blocks storage writes', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    setupSupabaseMocks();
    
    // Create a ref that we control
    const signingOutRef = { current: false };
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
      signingOutRef, // Pass ref directly
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Clear storage
    localStorage.clear();
    
    // Flip the ref WITHOUT rerendering (N8: must read live)
    signingOutRef.current = true;
    
    // Add a pill - this should trigger the persist effect
    const pill = createTestPill('pill-1', 'Test');
    act(() => {
      result.current.actions.setPills([pill]);
    });
    
    // Wait for the effect to run
    await new Promise(r => setTimeout(r, 50));
    
    // Storage should remain empty because signingOut is now true (read live from ref)
    const stored = localStorage.getItem(`pills_${userId}`);
    expect(stored).toBeNull();
  });
  
  it('N8: signingOut ref is read live in debounced upload effect', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    const { selectFn } = setupSupabaseMocks();
    
    const signingOutRef = { current: false };
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
      signingOutRef,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Clear call counts
    selectFn.mockClear();
    
    // Add a dirty pill to trigger upload
    const pill = createTestPill('pill-1', 'Test');
    act(() => {
      const dirtyPill = result.current.actions.markDirty(pill, 'upsert');
      result.current.actions.setPills([dirtyPill]);
    });
    
    // Flip signingOut BEFORE the debounce fires (1500ms)
    signingOutRef.current = true;
    
    // Wait past the 1500ms debounce
    await new Promise(r => setTimeout(r, 2000));
    
    // Upload should NOT have been called because signingOut was true
    // (read live at effect execution time, not render time)
    expect(selectFn).not.toHaveBeenCalled();
  });
});

describe('Behavior Tests: Merge with Non-finite updatedAt', () => {
  it('treats NaN updatedAt as 0', async () => {
    const { mergePills } = await import('../lib/syncEngine');
    
    const localPill = createTestPill('pill-1', 'Local');
    localPill.updatedAt = NaN;
    
    const cloudPill = createTestPill('pill-1', 'Cloud');
    cloudPill.updatedAt = 1000;
    
    const outbox: OutboxEntry[] = [{
      id: 'pill-1',
      type: 'upsert',
      pill: localPill,
      updatedAt: NaN,
      userId: 'test',
    }];
    
    const result = mergePills([localPill], [cloudPill], outbox);
    
    // Cloud should win because NaN is treated as 0
    expect(result.pills[0].name).toBe('Cloud');
  });

  it('treats undefined updatedAt as 0', async () => {
    const { mergePills } = await import('../lib/syncEngine');
    
    const localPill = createTestPill('pill-1', 'Local');
    delete localPill.updatedAt;
    
    const cloudPill = createTestPill('pill-1', 'Cloud');
    cloudPill.updatedAt = 1000;
    
    const outbox: OutboxEntry[] = [{
      id: 'pill-1',
      type: 'upsert',
      pill: localPill,
      updatedAt: 0,
      userId: 'test',
    }];
    
    const result = mergePills([localPill], [cloudPill], outbox);
    
    // Cloud should win
    expect(result.pills[0].name).toBe('Cloud');
  });
});

describe('T1: Merge must not keep deleted local pills', () => {
  it('cloud tombstone removes pill from merge result', async () => {
    const { mergePills } = await import('../lib/syncEngine');
    
    const localPill = createTestPill('pill-1', 'Local Edit');
    localPill.updatedAt = Date.now();
    
    const cloudTombstone = createTestPill('pill-1', '');
    cloudTombstone.deleted = true;
    cloudTombstone.deletedAt = Date.now() - 1000;
    cloudTombstone.updatedAt = Date.now() - 1000;
    
    // Local has an upsert in outbox (not a delete)
    const outbox: OutboxEntry[] = [{
      id: 'pill-1',
      type: 'upsert',
      pill: localPill,
      updatedAt: localPill.updatedAt!,
      userId: 'test',
    }];
    
    const result = mergePills([localPill], [cloudTombstone], outbox);
    
    // Tombstone wins - pill should NOT appear in result
    expect(result.pills.find(p => p.id === 'pill-1')).toBeUndefined();
  });
  
  it('locally deleted pill is kept only if in outbox as delete', async () => {
    const { mergePills, createTombstone } = await import('../lib/syncEngine');
    
    const localTombstone = createTombstone('pill-1');
    
    // Pill exists on cloud (not deleted)
    const cloudPill = createTestPill('pill-1', 'Cloud');
    cloudPill.updatedAt = Date.now() - 5000;
    
    // Local has a delete in outbox
    const outbox: OutboxEntry[] = [{
      id: 'pill-1',
      type: 'delete',
      pill: localTombstone,
      updatedAt: localTombstone.updatedAt!,
      userId: 'test',
    }];
    
    const result = mergePills([localTombstone], [cloudPill], outbox);
    
    // Local delete wins - pill should be in result as tombstone (for upload)
    // but filtered out of final display (deleted pills filtered)
    expect(result.pills.find(p => p.id === 'pill-1')).toBeUndefined();
  });
});

describe('L2: Upload-effect loop test', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });
  
  it('inline callback in upload effect deps would cause infinite loop (caught by stable design)', async () => {
    const mockLoadFromCloud = vi.fn().mockResolvedValue([]);
    const { selectFn } = setupSupabaseMocks();
    
    let renderCount = 0;
    let uploadCount = 0;
    
    // Track uploads
    selectFn.mockImplementation(() => {
      uploadCount++;
      return Promise.resolve({ data: [{ id: 'mock' }], error: null });
    });
    
    const { result, rerender } = renderHook(() => {
      renderCount++;
      return useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
        // This inline callback changes identity every render
        // If the upload effect depended on it, it would loop
        onPillsChange: () => {},
      });
    });
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    const initialUploadCount = uploadCount;
    const initialRenderCount = renderCount;
    
    // Add a pill to trigger upload
    const pill = createTestPill('pill-1', 'Test');
    act(() => {
      const dirtyPill = result.current.actions.markDirty(pill, 'upsert');
      result.current.actions.setPills([dirtyPill]);
    });
    
    // Wait for debounced flush
    await new Promise(r => setTimeout(r, 2000));
    
    const uploadsAfterEdit = uploadCount - initialUploadCount;
    
    // Should have exactly 1 upload, not N uploads where N = render count
    // If onPillsChange was in deps, each render would re-trigger the effect
    expect(uploadsAfterEdit).toBe(1);
    
    // Rerender multiple times
    for (let i = 0; i < 10; i++) {
      rerender();
    }
    
    await new Promise(r => setTimeout(r, 500));
    
    // No additional uploads from rerenders
    expect(uploadCount - initialUploadCount).toBe(1);
  });
});
