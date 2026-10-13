// tests/syncEngine.test.ts
// Tests for the sync rewrite: offline edit survival, multi-tab delete coordination,
// queued tap persistence, and user isolation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pill, OutboxEntry } from '../types';
import type { QueuedTap } from '../lib/loadOrchestration';

// Mock supabase before importing modules that use it
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';
import {
  mergePills,
  markPillDirty,
  flushOutbox,
  upsertPillToCloud,
  deletePillFromCloudById,
} from '../lib/syncEngine';
import {
  loadOutboxFromStorage,
  saveOutboxToStorage,
  addToOutbox,
  removeFromOutbox,
  clearOutbox,
  loadQueuedTapsFromStorage,
  saveQueuedTapsToStorage,
  addQueuedTap,
  clearQueuedTaps,
  savePillsToStorage,
  loadPillsFromStorage,
  clearUserData,
} from '../lib/storage';

// Helper to create test pills
const createTestPill = (
  id: string,
  name: string,
  updatedAt?: number,
  deleted?: boolean
): Pill => ({
  id,
  name,
  dosage: '500mg',
  reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
  history: [],
  updatedAt,
  deleted,
});

describe('syncEngine: Merge Logic', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('mergePills', () => {
    it('preserves local dirty changes over cloud data (offline edit survives)', () => {
      const userA = 'user-a';
      const localPill = createTestPill('pill-1', 'Local Edit', Date.now());
      const cloudPill = createTestPill('pill-1', 'Cloud Version', Date.now() - 10000);
      
      // Mark local pill as dirty (in outbox)
      const outboxEntry: OutboxEntry = {
        id: 'pill-1',
        type: 'upsert',
        pill: localPill,
        updatedAt: localPill.updatedAt!,
        userId: userA,
      };
      
      const result = mergePills([localPill], [cloudPill], [outboxEntry]);
      
      expect(result.pills).toHaveLength(1);
      expect(result.pills[0].name).toBe('Local Edit');
      expect(result.hasLocalChanges).toBe(true);
    });

    it('accepts cloud data when local is older (conflict resolution)', () => {
      const userA = 'user-a';
      const localPill = createTestPill('pill-1', 'Stale Local', Date.now() - 10000);
      const cloudPill = createTestPill('pill-1', 'Newer Cloud', Date.now());
      
      // Local is in outbox but older
      const outboxEntry: OutboxEntry = {
        id: 'pill-1',
        type: 'upsert',
        pill: localPill,
        updatedAt: localPill.updatedAt!,
        userId: userA,
      };
      saveOutboxToStorage(userA, [outboxEntry]);
      
      const result = mergePills([localPill], [cloudPill], [outboxEntry]);
      
      expect(result.pills).toHaveLength(1);
      expect(result.pills[0].name).toBe('Newer Cloud');
    });

    it('includes new cloud pills not in local', () => {
      const localPill = createTestPill('pill-1', 'Local');
      const cloudPill1 = createTestPill('pill-1', 'Cloud 1');
      const cloudPill2 = createTestPill('pill-2', 'Cloud 2');
      
      const result = mergePills([localPill], [cloudPill1, cloudPill2], []);
      
      expect(result.pills).toHaveLength(2);
      const ids = result.pills.map(p => p.id);
      expect(ids).toContain('pill-1');
      expect(ids).toContain('pill-2');
    });

    it('keeps deleted pill in outbox for sync (tombstone)', () => {
      const userA = 'user-a';
      const deletedPill = createTestPill('pill-1', 'Deleted', Date.now(), true);
      
      const outboxEntry: OutboxEntry = {
        id: 'pill-1',
        type: 'delete',
        updatedAt: Date.now(),
        userId: userA,
      };
      
      const result = mergePills([deletedPill], [], [outboxEntry]);
      
      // Deleted pill should not appear in final list
      expect(result.pills).toHaveLength(0);
      expect(result.hasLocalChanges).toBe(true);
    });

    it('does not resurrect deleted pills from stale cloud (two-tab delete)', () => {
      const userA = 'user-a';
      // Tab A deleted pill-1, it's in outbox
      const deletedPill = createTestPill('pill-1', 'Deleted', Date.now(), true);
      const outboxEntry: OutboxEntry = {
        id: 'pill-1',
        type: 'delete',
        updatedAt: Date.now(),
        userId: userA,
      };
      
      // Cloud still has the pill (stale data from tab B)
      const cloudPill = createTestPill('pill-1', 'Should Stay Deleted');
      
      const result = mergePills([deletedPill], [cloudPill], [outboxEntry]);
      
      // Should not resurrect the deleted pill
      expect(result.pills.filter(p => p.id === 'pill-1' && !p.deleted)).toHaveLength(0);
    });

    it('preserves new local pill not yet in cloud', () => {
      const userA = 'user-a';
      const newLocalPill = createTestPill('new-pill', 'New Local', Date.now());
      
      const outboxEntry: OutboxEntry = {
        id: 'new-pill',
        type: 'upsert',
        pill: newLocalPill,
        updatedAt: Date.now(),
        userId: userA,
      };
      
      const result = mergePills([newLocalPill], [], [outboxEntry]);
      
      expect(result.pills).toHaveLength(1);
      expect(result.pills[0].name).toBe('New Local');
      expect(result.hasLocalChanges).toBe(true);
    });
  });
});

describe('syncEngine: Dirty Tracking', () => {
  const userA = 'user-a';

  beforeEach(() => {
    localStorage.clear();
  });

  it('markPillDirty adds pill to outbox', () => {
    const pill = createTestPill('pill-1', 'Test');
    
    const dirtyPill = markPillDirty(userA, pill, 'upsert');
    
    expect(dirtyPill.updatedAt).toBeDefined();
    expect(dirtyPill.deleted).toBeUndefined();
    
    const outbox = loadOutboxFromStorage(userA);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].id).toBe('pill-1');
    expect(outbox[0].type).toBe('upsert');
  });

  it('markPillDirty for delete sets tombstone', () => {
    const pill = createTestPill('pill-1', 'Test');
    
    const dirtyPill = markPillDirty(userA, pill, 'delete');
    
    expect(dirtyPill.deleted).toBe(true);
    
    const outbox = loadOutboxFromStorage(userA);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].type).toBe('delete');
  });

  it('outbox entries are user-scoped', () => {
    const userB = 'user-b';
    const pillA = createTestPill('pill-a', 'User A Pill');
    const pillB = createTestPill('pill-b', 'User B Pill');
    
    markPillDirty(userA, pillA, 'upsert');
    markPillDirty(userB, pillB, 'upsert');
    
    const outboxA = loadOutboxFromStorage(userA);
    const outboxB = loadOutboxFromStorage(userB);
    
    expect(outboxA).toHaveLength(1);
    expect(outboxA[0].id).toBe('pill-a');
    expect(outboxB).toHaveLength(1);
    expect(outboxB[0].id).toBe('pill-b');
  });
});

describe('syncEngine: Queued Tap Persistence', () => {
  const userA = 'user-a';

  beforeEach(() => {
    localStorage.clear();
  });

  it('queued taps persist to localStorage', () => {
    const tap: QueuedTap = { pillId: 'pill-1', reminderId: 'r1', userId: userA };
    
    addQueuedTap(userA, tap);
    
    const loaded = loadQueuedTapsFromStorage(userA);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(tap);
  });

  it('queued taps survive simulated reload', () => {
    const tap: QueuedTap = { pillId: 'pill-1', reminderId: 'r1', userId: userA };
    
    addQueuedTap(userA, tap);
    
    // Simulate reload: clear in-memory state, read from storage
    const loaded = loadQueuedTapsFromStorage(userA);
    
    expect(loaded).toHaveLength(1);
    expect(loaded[0].pillId).toBe('pill-1');
  });

  it('clearQueuedTaps removes all taps for user', () => {
    addQueuedTap(userA, { pillId: 'pill-1', reminderId: 'r1', userId: userA });
    addQueuedTap(userA, { pillId: 'pill-2', reminderId: 'r1', userId: userA });
    
    clearQueuedTaps(userA);
    
    const loaded = loadQueuedTapsFromStorage(userA);
    expect(loaded).toHaveLength(0);
  });

  it('queued taps are user-scoped', () => {
    const userB = 'user-b';
    
    addQueuedTap(userA, { pillId: 'pill-a', reminderId: 'r1', userId: userA });
    addQueuedTap(userB, { pillId: 'pill-b', reminderId: 'r1', userId: userB });
    
    const tapsA = loadQueuedTapsFromStorage(userA);
    const tapsB = loadQueuedTapsFromStorage(userB);
    
    expect(tapsA).toHaveLength(1);
    expect(tapsA[0].pillId).toBe('pill-a');
    expect(tapsB).toHaveLength(1);
    expect(tapsB[0].pillId).toBe('pill-b');
  });
});

describe('syncEngine: User Isolation', () => {
  const userA = 'user-a';
  const userB = 'user-b';

  beforeEach(() => {
    localStorage.clear();
  });

  it('user A pills never appear in user B storage', () => {
    const pillA = createTestPill('pill-a', 'User A Pill');
    const pillB = createTestPill('pill-b', 'User B Pill');
    
    savePillsToStorage(userA, [pillA]);
    savePillsToStorage(userB, [pillB]);
    
    const loadedA = loadPillsFromStorage(userA);
    const loadedB = loadPillsFromStorage(userB);
    
    expect(loadedA.map(p => p.id)).toEqual(['pill-a']);
    expect(loadedB.map(p => p.id)).toEqual(['pill-b']);
  });

  it('user A outbox never contains user B entries', () => {
    const pillA = createTestPill('pill-a', 'User A Pill');
    const pillB = createTestPill('pill-b', 'User B Pill');
    
    markPillDirty(userA, pillA, 'upsert');
    markPillDirty(userB, pillB, 'upsert');
    
    const outboxA = loadOutboxFromStorage(userA);
    const outboxB = loadOutboxFromStorage(userB);
    
    expect(outboxA.every(e => e.userId === userA)).toBe(true);
    expect(outboxB.every(e => e.userId === userB)).toBe(true);
  });

  it('clearUserData only affects target user', () => {
    const pillA = createTestPill('pill-a', 'User A Pill');
    const pillB = createTestPill('pill-b', 'User B Pill');
    
    savePillsToStorage(userA, [pillA]);
    savePillsToStorage(userB, [pillB]);
    markPillDirty(userA, pillA, 'upsert');
    markPillDirty(userB, pillB, 'upsert');
    addQueuedTap(userA, { pillId: 'pill-a', reminderId: 'r1', userId: userA });
    addQueuedTap(userB, { pillId: 'pill-b', reminderId: 'r1', userId: userB });
    
    clearUserData(userA);
    
    // User A data should be cleared
    expect(loadPillsFromStorage(userA)).toHaveLength(0);
    expect(loadOutboxFromStorage(userA)).toHaveLength(0);
    expect(loadQueuedTapsFromStorage(userA)).toHaveLength(0);
    
    // User B data should be preserved
    expect(loadPillsFromStorage(userB)).toHaveLength(1);
    expect(loadOutboxFromStorage(userB)).toHaveLength(1);
    expect(loadQueuedTapsFromStorage(userB)).toHaveLength(1);
  });
});

describe('syncEngine: Cloud Operations', () => {
  const userA = 'user-a';
  const mockUser = { id: userA };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('flushOutbox', () => {
    it('processes all entries in outbox', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      const deleteFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const eqFn2 = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockImplementation(() => ({
        upsert: upsertFn,
        delete: deleteFn,
      } as any));
      
      deleteFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn2 });

      // Add entries to outbox
      const pill1 = createTestPill('pill-1', 'Test 1', Date.now());
      const pill2 = createTestPill('pill-2', 'Test 2', Date.now());
      addToOutbox(userA, {
        id: 'pill-1',
        type: 'upsert',
        pill: pill1,
        updatedAt: Date.now(),
        userId: userA,
      });
      addToOutbox(userA, {
        id: 'pill-2',
        type: 'delete',
        updatedAt: Date.now(),
        userId: userA,
      });

      const result = await flushOutbox(userA);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledTimes(1);
      expect(deleteFn).toHaveBeenCalledTimes(1);
      
      // Outbox should be empty after successful flush
      const outbox = loadOutboxFromStorage(userA);
      expect(outbox).toHaveLength(0);
    });

    it('aborts on user change', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: { id: 'different-user' } } as any },
        error: null,
      });

      const pill = createTestPill('pill-1', 'Test', Date.now());
      addToOutbox(userA, {
        id: 'pill-1',
        type: 'upsert',
        pill,
        updatedAt: Date.now(),
        userId: userA,
      });

      const result = await flushOutbox(userA);

      expect(result.success).toBe(false);
      expect(result.aborted).toBe(true);
      
      // Outbox should still have the entry
      const outbox = loadOutboxFromStorage(userA);
      expect(outbox).toHaveLength(1);
    });

    it('only processes entries for the specified user', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      vi.mocked(supabase.from).mockImplementation(() => ({
        upsert: upsertFn,
      } as any));

      // Add entry for different user to userA's outbox (should not happen, but testing safety)
      const userB = 'user-b';
      const pillA = createTestPill('pill-a', 'User A', Date.now());
      addToOutbox(userA, {
        id: 'pill-a',
        type: 'upsert',
        pill: pillA,
        updatedAt: Date.now(),
        userId: userA,
      });
      
      // Manually inject a cross-user entry (simulating bug)
      const outbox = loadOutboxFromStorage(userA);
      outbox.push({
        id: 'pill-b',
        type: 'upsert',
        pill: createTestPill('pill-b', 'User B', Date.now()),
        updatedAt: Date.now(),
        userId: userB,  // Different user!
      });
      saveOutboxToStorage(userA, outbox);

      const result = await flushOutbox(userA);

      // Should only process userA's entry
      expect(upsertFn).toHaveBeenCalledTimes(1);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pill-a' }),
        expect.any(Object)
      );
    });
  });
});

describe('syncEngine: Offline Edit Survives Reload', () => {
  const userA = 'user-a';

  beforeEach(() => {
    localStorage.clear();
  });

  it('offline edit persists through simulated reload and merge', () => {
    // User makes an edit while offline
    const originalPill = createTestPill('pill-1', 'Original', Date.now() - 5000);
    savePillsToStorage(userA, [originalPill]);
    
    // User edits the pill
    const editedPill = createTestPill('pill-1', 'Edited Offline', Date.now());
    markPillDirty(userA, editedPill, 'upsert');
    savePillsToStorage(userA, [editedPill]);
    
    // Simulate reload: read from storage
    const localPills = loadPillsFromStorage(userA);
    const outbox = loadOutboxFromStorage(userA);
    
    // Cloud returns older version
    const cloudPill = createTestPill('pill-1', 'Old Cloud', Date.now() - 10000);
    
    // Merge should preserve local edit
    const result = mergePills(localPills, [cloudPill], outbox);
    
    expect(result.pills).toHaveLength(1);
    expect(result.pills[0].name).toBe('Edited Offline');
    expect(result.hasLocalChanges).toBe(true);
  });
});

describe('syncEngine: Two-Tab Delete Coordination', () => {
  const userA = 'user-a';

  beforeEach(() => {
    localStorage.clear();
  });

  it('delete in tab A stays deleted even if tab B has stale data', () => {
    // Tab A deletes a pill
    const deletedPill = createTestPill('pill-1', 'To Delete', Date.now(), true);
    const deleteEntry: OutboxEntry = {
      id: 'pill-1',
      type: 'delete',
      updatedAt: Date.now(),
      userId: userA,
    };
    saveOutboxToStorage(userA, [deleteEntry]);
    
    // Tab B's stale cloud data still has the pill
    const stalePill = createTestPill('pill-1', 'Stale Version');
    
    // When Tab A merges, it should not resurrect the deleted pill
    const result = mergePills([deletedPill], [stalePill], [deleteEntry]);
    
    // The pill should not appear in the merged result
    const visiblePills = result.pills.filter(p => !p.deleted);
    expect(visiblePills).toHaveLength(0);
  });

  it('delete outbox entry leads to explicit cloud delete, not bulk rewrite', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userA } } as any },
      error: null,
    });

    const deleteFn = vi.fn().mockReturnThis();
    const eqIdFn = vi.fn().mockReturnThis();
    const eqUserFn = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(supabase.from).mockImplementation(() => ({
      delete: deleteFn,
    } as any));
    
    deleteFn.mockReturnValue({ eq: eqIdFn });
    eqIdFn.mockReturnValue({ eq: eqUserFn });

    // Verify deletePillFromCloudById uses explicit ID delete
    const result = await deletePillFromCloudById('pill-1', userA);

    expect(result.success).toBe(true);
    expect(deleteFn).toHaveBeenCalled();
    expect(eqIdFn).toHaveBeenCalledWith('id', 'pill-1');
    expect(eqUserFn).toHaveBeenCalledWith('user_id', userA);
  });
});
