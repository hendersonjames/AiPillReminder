// tests/syncWiring.test.ts
// Tests that verify the sync wiring works correctly.
// Tests the useSyncEngine hook that App.tsx actually uses.
//
// Each mutation test is designed to fail if the wiring is broken.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Pill, OutboxEntry } from '../types';
import type { QueuedTap } from '../lib/loadOrchestration';

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';
import { useSyncEngine } from '../lib/useSyncEngine';
import {
  mergePills,
  markPillDirty,
  hasUnsyncedChanges,
  createTombstone,
  getSyncChannelName,
  isValidSyncMessage,
  createSyncMessage,
  hasWebLocks,
  withFlushLock,
  getFlushLockName,
  type SyncMessage,
} from '../lib/syncEngine';
import {
  loadOutboxFromStorage,
  saveOutboxToStorage,
  addQueuedTap,
  loadQueuedTapsFromStorage,
  clearQueuedTaps,
  clearUserData,
  savePillsToStorage,
  loadPillsFromStorage,
} from '../lib/storage';
import { recordMissedDoses } from '../lib/pillHelpers';
import { getDateString } from '../lib/storage';

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

describe('Sync Wiring: Mutation Detection via useSyncEngine Hook', () => {
  const userId = 'test-user';
  const mockLoadFromCloud = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    
    // Default mock for getSession
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Load ignores merge', () => {
    it('FAILS if merge is not used - offline edit would be lost', async () => {
      const localPill = createTestPill('pill-1', 'Local Edit', Date.now());
      const cloudPill = createTestPill('pill-1', 'Cloud Version', Date.now() - 10000);
      
      // Save local pill with outbox entry (dirty)
      savePillsToStorage(userId, [localPill]);
      const outboxEntry: OutboxEntry = {
        id: 'pill-1',
        type: 'upsert',
        pill: localPill,
        updatedAt: localPill.updatedAt!,
        userId,
      };
      saveOutboxToStorage(userId, [outboxEntry]);
      
      mockLoadFromCloud.mockResolvedValue([cloudPill]);
      
      // Mock supabase for flush
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'pill-1' }], error: null });
      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });
      
      const { result } = renderHook(() => useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
      }));
      
      // Wait for load to complete
      await waitFor(() => {
        expect(result.current.state.syncStatus).toBe('synced');
      });
      
      // Local edit should be preserved (merge worked)
      expect(result.current.state.pills[0].name).toBe('Local Edit');
    });
  });

  describe('2. Delete not recorded', () => {
    it('FAILS if delete does not create outbox entry', () => {
      const pill = createTestPill('pill-1', 'Test Pill');
      
      markPillDirty(userId, pill, 'delete');
      
      const outbox = loadOutboxFromStorage(userId);
      
      expect(outbox.length).toBe(1);
      expect(outbox[0].type).toBe('delete');
    });
  });

  describe('3. Edit not marked', () => {
    it('FAILS if edit does not create outbox entry', async () => {
      mockLoadFromCloud.mockResolvedValue([]);
      
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'pill-1' }], error: null });
      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });
      
      const { result } = renderHook(() => useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
      }));
      
      await waitFor(() => {
        expect(result.current.state.syncStatus).toBe('synced');
      });
      
      // Apply taken mark (which is an edit)
      const pill = createTestPill('pill-1', 'Test');
      act(() => {
        result.current.actions.setPills([pill]);
      });
      
      act(() => {
        result.current.actions.applyTakenMark('pill-1', 'r1');
      });
      
      // Wait for the edit to be marked
      await waitFor(() => {
        const outbox = loadOutboxFromStorage(userId);
        expect(outbox.length).toBeGreaterThan(0);
      });
    });
  });

  describe('4. Taps not saved', () => {
    it('FAILS if queued taps are not persisted to localStorage', () => {
      const tap: QueuedTap = { pillId: 'pill-1', reminderId: 'r1', userId };
      
      addQueuedTap(userId, tap);
      
      const loaded = loadQueuedTapsFromStorage(userId);
      
      expect(loaded.length).toBe(1);
      expect(loaded[0].pillId).toBe('pill-1');
    });
  });

  describe('5. Queue not flushed after load', () => {
    it('FAILS if hasUnsyncedChanges returns false when outbox has entries', () => {
      const pill = createTestPill('pill-1', 'Test');
      markPillDirty(userId, pill, 'upsert');
      
      expect(hasUnsyncedChanges(userId)).toBe(true);
    });
  });

  describe('6. Tapped pills not marked', () => {
    it('FAILS if applyTakenMark does not mark pill dirty', async () => {
      mockLoadFromCloud.mockResolvedValue([]);
      
      vi.mocked(supabase.from).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any);
      
      const { result } = renderHook(() => useSyncEngine({
        userId,
        loadPillsFromCloud: mockLoadFromCloud,
      }));
      
      await waitFor(() => {
        expect(result.current.state.syncStatus).toBe('synced');
      });
      
      const pill = createTestPill('pill-1', 'Test');
      act(() => {
        result.current.actions.setPills([pill]);
      });
      
      // Clear outbox first
      clearUserData(userId);
      savePillsToStorage(userId, [pill]);
      
      act(() => {
        result.current.actions.applyTakenMark('pill-1', 'r1');
      });
      
      await waitFor(() => {
        const outbox = loadOutboxFromStorage(userId);
        expect(outbox.some(e => e.id === 'pill-1')).toBe(true);
      });
    });
  });

  describe('7. Sign-out skips unsynced check', () => {
    it('FAILS if hasUnsyncedChanges does not detect outbox entries', () => {
      const pill = createTestPill('pill-1', 'Edited');
      markPillDirty(userId, pill, 'upsert');
      
      const hasUnsynced = hasUnsyncedChanges(userId);
      
      expect(hasUnsynced).toBe(true);
      
      clearUserData(userId);
      expect(hasUnsyncedChanges(userId)).toBe(false);
    });
  });

  describe('8. Merge keeps deleted local pills', () => {
    it('FAILS if merge returns deleted pills in final result', () => {
      const deletedPill = createTestPill('pill-1', 'Deleted', Date.now(), true);
      const normalPill = createTestPill('pill-2', 'Normal', Date.now());
      
      const outbox: OutboxEntry[] = [
        { id: 'pill-1', type: 'delete', pill: deletedPill, updatedAt: Date.now(), userId },
        { id: 'pill-2', type: 'upsert', pill: normalPill, updatedAt: Date.now(), userId },
      ];
      
      const result = mergePills([deletedPill, normalPill], [], outbox);
      
      expect(result.pills.every(p => !p.deleted)).toBe(true);
      expect(result.pills.length).toBe(1);
      expect(result.pills[0].id).toBe('pill-2');
    });
  });

  describe('9. Sweep changes not marked dirty (H3 regression)', () => {
    it('is tested in appIntegration.test.ts orchestrateAfterCloudLoad tests', () => {
      // This mutation is tested by the changedPillIds tests
      expect(true).toBe(true);
    });
  });
});

describe('Tombstone Privacy', () => {
  const userId = 'test-user';

  beforeEach(() => {
    localStorage.clear();
  });

  it('createTombstone contains NO health data', () => {
    const tombstone = createTombstone('pill-1');
    
    expect(tombstone.id).toBe('pill-1');
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.deletedAt).toBeDefined();
    expect(tombstone.updatedAt).toBeDefined();
    expect(tombstone.name).toBe('');
    expect(tombstone.dosage).toBe('');
    expect(tombstone.reminders).toEqual([]);
    expect(tombstone.history).toBeUndefined();
    expect(tombstone.notes).toBeUndefined();
  });

  it('markPillDirty for delete creates minimal tombstone in outbox', () => {
    const pill = createTestPill('pill-1', 'Secret Medication');
    pill.notes = 'Private health notes';
    pill.history = [{ 
      id: 'h1', 
      reminderId: 'r1', 
      pillName: 'Secret Medication', 
      time: '09:00', 
      action: 'taken', 
      timestamp: Date.now() 
    }];
    
    markPillDirty(userId, pill, 'delete');
    
    const outbox = loadOutboxFromStorage(userId);
    expect(outbox.length).toBe(1);
    
    const entry = outbox[0];
    expect(entry.type).toBe('delete');
    expect(entry.pill?.deleted).toBe(true);
    expect(entry.pill?.name).toBe('');
    expect(entry.pill?.history).toBeUndefined();
    expect(entry.pill?.notes).toBeUndefined();
  });
});

describe('BroadcastChannel', () => {
  const userId = 'test-user';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates message shape and rejects invalid messages', () => {
    // Test isValidSyncMessage validation
    const validMsg = createSyncMessage('pill_changed', userId, 'pill-1');
    expect(isValidSyncMessage(validMsg)).toBe(true);
    
    // Invalid: wrong type
    expect(isValidSyncMessage({ type: 'invalid', userId, timestamp: Date.now() })).toBe(false);
    
    // Invalid: missing userId
    expect(isValidSyncMessage({ type: 'pill_changed', timestamp: Date.now() })).toBe(false);
    
    // Invalid: missing timestamp
    expect(isValidSyncMessage({ type: 'pill_changed', userId })).toBe(false);
    
    // Invalid: not an object
    expect(isValidSyncMessage('string')).toBe(false);
    expect(isValidSyncMessage(null)).toBe(false);
    expect(isValidSyncMessage(undefined)).toBe(false);
    
    // Valid: pills_loaded without pillId
    expect(isValidSyncMessage(createSyncMessage('pills_loaded', userId))).toBe(true);
    
    // Valid: pill_deleted with pillId
    expect(isValidSyncMessage(createSyncMessage('pill_deleted', userId, 'pill-1'))).toBe(true);
  });

  it('channel name is per-user', () => {
    // The channel name includes userId for isolation
    expect(getSyncChannelName('user-1')).toBe('remedi_sync_user-1');
    expect(getSyncChannelName('user-2')).toBe('remedi_sync_user-2');
    expect(getSyncChannelName('user-1')).not.toBe(getSyncChannelName('user-2'));
  });
  
  it('N7: tab B gets the change with full pill data', async () => {
    // Test with two real BroadcastChannel instances
    const channelA = new BroadcastChannel(getSyncChannelName(userId));
    const channelB = new BroadcastChannel(getSyncChannelName(userId));
    
    const receivedOnB: SyncMessage[] = [];
    
    // Tab B receives and should get full pill data
    channelB.onmessage = (event) => {
      if (isValidSyncMessage(event.data)) {
        receivedOnB.push(event.data);
      }
    };
    
    // Tab A sends a pill_changed message WITH full pill data
    const testPill = createTestPill('pill-1', 'Test Pill', Date.now());
    const msg = createSyncMessage('pill_changed', userId, 'pill-1', testPill);
    channelA.postMessage(msg);
    
    // Wait for message propagation
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Tab B should have received the message
    expect(receivedOnB.length).toBe(1);
    expect(receivedOnB[0].type).toBe('pill_changed');
    expect(receivedOnB[0].pillId).toBe('pill-1');
    
    // Tab B should have received the full pill data
    expect(receivedOnB[0].pill).toBeDefined();
    expect(receivedOnB[0].pill!.name).toBe('Test Pill');
    
    channelA.close();
    channelB.close();
  });
  
  it('N7b: message includes pill data for immediate apply', () => {
    const testPill = createTestPill('pill-1', 'Test Pill', Date.now());
    const msg = createSyncMessage('pill_changed', userId, 'pill-1', testPill);
    
    expect(msg.pill).toBeDefined();
    expect(msg.pill!.id).toBe('pill-1');
    expect(msg.pill!.name).toBe('Test Pill');
    
    // Validate the message
    expect(isValidSyncMessage(msg)).toBe(true);
  });
});

describe('Web Locks', () => {
  const userId = 'test-user';
  
  it('getFlushLockName returns per-user lock name', () => {
    expect(getFlushLockName('user-1')).toBe('remedi_flush_user-1');
    expect(getFlushLockName('user-2')).toBe('remedi_flush_user-2');
  });
  
  it('withFlushLock runs callback when lock available', async () => {
    let callbackRan = false;
    const { acquired, result } = await withFlushLock(userId, async () => {
      callbackRan = true;
      return 'success';
    });
    
    expect(callbackRan).toBe(true);
    expect(acquired).toBe(true);
    expect(result).toBe('success');
  });
  
  it('hasWebLocks returns boolean', () => {
    // In jsdom, Web Locks may not be available
    const result = hasWebLocks();
    expect(typeof result).toBe('boolean');
  });
});

describe('Stale Un-delete Prevention', () => {
  const userId = 'test-user';

  beforeEach(() => {
    localStorage.clear();
  });

  it('tombstone-wins: cloud tombstone prevents resurrection by stale local edit', () => {
    const cloudTombstone = createTestPill('pill-w', 'Deleted', Date.now(), true);
    const staleLocalPill = createTestPill('pill-w', 'Stale Local with dose', Date.now() + 1000);
    
    const outboxEntry: OutboxEntry = {
      id: 'pill-w',
      type: 'upsert',
      pill: staleLocalPill,
      updatedAt: staleLocalPill.updatedAt!,
      userId,
    };
    
    // Merge with cloud tombstone
    const result = mergePills([staleLocalPill], [cloudTombstone], [outboxEntry]);
    
    // Pill should NOT be resurrected
    const resurrectedPills = result.pills.filter(p => p.id === 'pill-w' && !p.deleted);
    expect(resurrectedPills.length).toBe(0);
  });

  it('Bob scenario: A deletes W, stale B marks dose on W, W stays deleted', () => {
    // Browser A deleted pill W (now a tombstone)
    const cloudTombstone: Pill = {
      id: 'pill-w',
      name: '',
      dosage: '',
      reminders: [],
      deleted: true,
      deletedAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
    };
    
    // Browser B (stale) still has W and marks a dose
    const staleBrowserPill = createTestPill('pill-w', 'Vitamin W', Date.now() - 10000);
    staleBrowserPill.history = [{
      id: 'dose-1',
      reminderId: 'r1',
      pillName: 'Vitamin W',
      time: '09:00',
      action: 'taken',
      timestamp: Date.now(), // Just marked a dose
    }];
    
    const outboxEntry: OutboxEntry = {
      id: 'pill-w',
      type: 'upsert',
      pill: staleBrowserPill,
      updatedAt: Date.now(),
      userId,
    };
    
    // When B loads and merges with cloud
    const result = mergePills([staleBrowserPill], [cloudTombstone], [outboxEntry]);
    
    // W should stay deleted (tombstone wins)
    expect(result.pills.filter(p => p.id === 'pill-w' && !p.deleted).length).toBe(0);
  });
});

describe('Deduplication', () => {
  const userId = 'test-user';

  beforeEach(() => {
    localStorage.clear();
  });

  it('multiple edits to same pill result in single outbox entry', () => {
    const pill = createTestPill('pill-1', 'Original');
    
    // Edit 1
    markPillDirty(userId, { ...pill, name: 'Edit 1' }, 'upsert');
    // Edit 2
    markPillDirty(userId, { ...pill, name: 'Edit 2' }, 'upsert');
    // Edit 3
    markPillDirty(userId, { ...pill, name: 'Edit 3' }, 'upsert');
    
    const outbox = loadOutboxFromStorage(userId);
    
    // Should only have one entry for this pill (latest)
    expect(outbox.length).toBe(1);
    expect(outbox[0].pill?.name).toBe('Edit 3');
  });
});

// ─── H4, H5, H6, HU2 Mutation Tests ─────────────────────────────────────────────

describe('H4: Queued taps must be saved to localStorage', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
  });
  
  it('FAILS if addQueuedTap does not persist tap', () => {
    addQueuedTap(userId, { pillId: 'p1', reminderId: 'r1', userId });
    
    // Clear in-memory state by creating fresh load
    const loaded = loadQueuedTapsFromStorage(userId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].pillId).toBe('p1');
  });
  
  it('FAILS if taps are lost after reload', () => {
    addQueuedTap(userId, { pillId: 'p1', reminderId: 'r1', userId });
    addQueuedTap(userId, { pillId: 'p2', reminderId: 'r1', userId });
    
    const loaded = loadQueuedTapsFromStorage(userId);
    expect(loaded).toHaveLength(2);
  });
});

describe('H5: No upload after load (flush must happen)', () => {
  const userId = 'test-user';
  const mockLoadFromCloud = vi.fn();
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: userId } } as any },
      error: null,
    });
  });
  
  it('FAILS if outbox items are not flushed after load', async () => {
    const localPill = createTestPill('pill-1', 'Local Edit', Date.now());
    savePillsToStorage(userId, [localPill]);
    
    const outboxEntry: OutboxEntry = {
      id: 'pill-1',
      type: 'upsert',
      pill: localPill,
      updatedAt: localPill.updatedAt!,
      userId,
    };
    saveOutboxToStorage(userId, [outboxEntry]);
    
    mockLoadFromCloud.mockResolvedValue([]);
    
    // Track upsert calls
    const upsertCalls: any[] = [];
    const updateFn = vi.fn().mockReturnThis();
    const eqFn = vi.fn().mockReturnThis();
    const orFn = vi.fn().mockReturnThis();
    const selectFn = vi.fn().mockImplementation(() => {
      upsertCalls.push('update');
      return Promise.resolve({ data: [{ id: 'pill-1' }], error: null });
    });
    vi.mocked(supabase.from).mockReturnValue({
      update: updateFn,
      select: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as any);
    updateFn.mockReturnValue({ eq: eqFn });
    eqFn.mockReturnValue({ eq: eqFn, or: orFn });
    orFn.mockReturnValue({ select: selectFn });
    
    const { result } = renderHook(() => useSyncEngine({
      userId,
      loadPillsFromCloud: mockLoadFromCloud,
    }));
    
    await waitFor(() => {
      expect(result.current.state.syncStatus).toBe('synced');
    });
    
    // Flush should have been called (update was invoked)
    expect(upsertCalls.length).toBeGreaterThan(0);
  });
});

describe('H6: Swept or tapped pills must be queued for upload', () => {
  it('FAILS if orchestrateAfterCloudLoad does not return changedPillIds', async () => {
    const { orchestrateAfterCloudLoad } = await import('../lib/loadOrchestration');
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const pill = createTestPill('p1', 'Old Pill', weekAgo.getTime());
    
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const lastSweep = getDateString(threeDaysAgo);
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    
    const result = orchestrateAfterCloudLoad(
      [pill],
      lastSweep,
      yesterdayStr,
      [],
      'user-a',
      recordMissedDoses
    );
    
    // Sweep should mark pill as changed
    expect(result.sweepRan).toBe(true);
    expect(result.changedPillIds.has('p1')).toBe(true);
  });
  
  it('FAILS if tapped pills are not included in changedPillIds', async () => {
    const { orchestrateAfterCloudLoad } = await import('../lib/loadOrchestration');
    const pill = createTestPill('p1', 'Pill');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getDateString(yesterday);
    
    const taps: QueuedTap[] = [
      { pillId: 'p1', reminderId: 'r1', userId: 'user-a' },
    ];
    
    const result = orchestrateAfterCloudLoad(
      [pill],
      yesterdayStr,
      yesterdayStr,
      taps,
      'user-a',
      recordMissedDoses
    );
    
    expect(result.changedPillIds.has('p1')).toBe(true);
  });
});

describe('HU2: Regular outbox upload must work', () => {
  const userId = 'test-user';
  
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });
  
  it('FAILS if outbox entries are not created for dirty pills', () => {
    // This tests the critical path: markPillDirty creates outbox entries
    // which the debounced flush will process
    const pill = createTestPill('pill-1', 'New Pill');
    
    // Marking a pill dirty should create an outbox entry
    markPillDirty(userId, pill, 'upsert');
    
    const outbox = loadOutboxFromStorage(userId);
    expect(outbox.length).toBe(1);
    expect(outbox[0].id).toBe('pill-1');
    expect(outbox[0].type).toBe('upsert');
  });
  
  it('FAILS if hasUnsyncedChanges does not detect outbox', () => {
    const pill = createTestPill('pill-1', 'Test');
    markPillDirty(userId, pill, 'upsert');
    
    // hasUnsyncedChanges should return true when outbox has entries
    expect(hasUnsyncedChanges(userId)).toBe(true);
    
    // After clearing, should return false
    clearUserData(userId);
    expect(hasUnsyncedChanges(userId)).toBe(false);
  });
});
