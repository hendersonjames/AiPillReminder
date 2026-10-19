import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pill } from '../types';

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';
import { loadPillsFromCloud } from '../services/pillsService';
import {
  upsertPillToCloud,
  deletePillFromCloudById,
  flushOutbox,
} from '../lib/syncEngine';
import {
  saveOutboxToStorage,
  loadOutboxFromStorage,
  clearUserData,
} from '../lib/storage';
import type { OutboxEntry } from '../types';

describe('pillsService', () => {
  const mockUserId = 'user-123';
  const mockUser = { id: mockUserId };

  const createTestPill = (id: string, name: string, updatedAt?: number): Pill => ({
    id,
    name,
    dosage: '500mg',
    reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
    history: [],
    updatedAt,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('loadPillsFromCloud', () => {
    it('loads and transforms pills from database', async () => {
      const dbRows = [
        { id: 'p1', user_id: mockUserId, pill_name: 'Vitamin D', pill_data: { name: 'Vitamin D', dosage: '1000IU' }, created_at: '2024-01-01' },
        { id: 'p2', user_id: mockUserId, pill_name: 'Aspirin', pill_data: { name: 'Aspirin', dosage: '81mg' }, created_at: '2024-01-02' },
      ];

      const mockSelect = vi.fn().mockReturnThis();
      const mockOrder = vi.fn().mockResolvedValue({ data: dbRows, error: null });

      vi.mocked(supabase.from).mockReturnValue({
        select: mockSelect,
        order: mockOrder,
      } as any);

      mockSelect.mockReturnValue({ order: mockOrder });

      const result = await loadPillsFromCloud();

      expect(supabase.from).toHaveBeenCalledWith('pills');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('p1');
      expect(result[1].id).toBe('p2');
    });

    it('throws on database error', async () => {
      const mockSelect = vi.fn().mockReturnThis();
      const mockOrder = vi.fn().mockResolvedValue({ data: null, error: new Error('DB Error') });

      vi.mocked(supabase.from).mockReturnValue({
        select: mockSelect,
        order: mockOrder,
      } as any);

      mockSelect.mockReturnValue({ order: mockOrder });

      await expect(loadPillsFromCloud()).rejects.toThrow('DB Error');
    });

    it('includes updatedAt from database row', async () => {
      const dbRows = [
        { 
          id: 'p1', 
          user_id: mockUserId, 
          pill_name: 'Vitamin D', 
          pill_data: { name: 'Vitamin D', dosage: '1000IU' }, 
          created_at: '2024-01-01',
          updated_at: '2024-01-15T10:30:00.000Z'
        },
      ];

      const mockSelect = vi.fn().mockReturnThis();
      const mockOrder = vi.fn().mockResolvedValue({ data: dbRows, error: null });

      vi.mocked(supabase.from).mockReturnValue({
        select: mockSelect,
        order: mockOrder,
      } as any);

      mockSelect.mockReturnValue({ order: mockOrder });

      const result = await loadPillsFromCloud();

      expect(result[0].updatedAt).toBeDefined();
      expect(result[0].updatedAt).toBe(new Date('2024-01-15T10:30:00.000Z').getTime());
    });
  });

  describe('upsertPillToCloud', () => {
    it('updates existing pill with conditional update (tombstone protection)', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock conditional update that matches (row exists, not tombstoned)
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });

      const pill = createTestPill('p1', 'Test Pill', Date.now());
      const result = await upsertPillToCloud(pill, mockUserId);

      expect(result.success).toBe(true);
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({
          pill_name: 'Test Pill',
          pill_data: expect.objectContaining({ id: 'p1' }),
        })
      );
    });

    it('inserts new pill when row does not exist', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock conditional update that matches 0 rows
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectUpdateFn = vi.fn().mockResolvedValue({ data: [], error: null });
      
      // Mock select to check if row exists (returns null = doesn't exist)
      const selectCheckFn = vi.fn().mockReturnThis();
      const selectEqFn = vi.fn().mockReturnThis();
      const singleFn = vi.fn().mockResolvedValue({ data: null, error: null });
      
      // Mock insert
      const insertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
        select: selectCheckFn,
        insert: insertFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectUpdateFn });
      selectCheckFn.mockReturnValue({ eq: selectEqFn });
      selectEqFn.mockReturnValue({ eq: selectEqFn, single: singleFn });

      const pill = createTestPill('p1', 'Test Pill', Date.now());
      const result = await upsertPillToCloud(pill, mockUserId);

      expect(result.success).toBe(true);
      expect(insertFn).toHaveBeenCalled();
    });

    it('returns tombstoned=true when writing to tombstoned row', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock conditional update that matches 0 rows
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectUpdateFn = vi.fn().mockResolvedValue({ data: [], error: null });
      
      // Mock select to check if row exists (returns tombstoned row)
      const selectCheckFn = vi.fn().mockReturnThis();
      const selectEqFn = vi.fn().mockReturnThis();
      const singleFn = vi.fn().mockResolvedValue({ 
        data: { pill_data: { deleted: true } }, 
        error: null 
      });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
        select: selectCheckFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectUpdateFn });
      selectCheckFn.mockReturnValue({ eq: selectEqFn });
      selectEqFn.mockReturnValue({ eq: selectEqFn, single: singleFn });

      const pill = createTestPill('p1', 'Test Pill', Date.now());
      const result = await upsertPillToCloud(pill, mockUserId);

      expect(result.success).toBe(false);
      expect(result.tombstoned).toBe(true);
    });

    it('aborts if user changed', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: { id: 'wrong-user' } } as any },
        error: null,
      });

      const pill = createTestPill('p1', 'Test Pill');
      const result = await upsertPillToCloud(pill, mockUserId);

      expect(result.success).toBe(false);
      expect(result.aborted).toBe(true);
    });
  });

  describe('deletePillFromCloudById', () => {
    it('soft-deletes with minimal tombstone (no health data)', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      // Even when pill is provided, tombstone should be minimal
      const pill = createTestPill('p1', 'Test Pill');
      pill.notes = 'Secret health notes';
      pill.history = [{ id: 'h1', reminderId: 'r1', pillName: 'Test', time: '09:00', action: 'taken', timestamp: Date.now() }];
      
      const result = await deletePillFromCloudById('p1', mockUserId, pill);

      expect(result.success).toBe(true);
      
      const callArg = upsertFn.mock.calls[0][0];
      expect(callArg.pill_name).toBe('[deleted]');
      expect(callArg.pill_data.deleted).toBe(true);
      expect(callArg.pill_data.deletedAt).toBeDefined();
      // Privacy: should NOT contain health data
      expect(callArg.pill_data.name).toBe('');
      expect(callArg.pill_data.notes).toBeUndefined();
      expect(callArg.pill_data.history).toBeUndefined();
    });

    it('returns error on deletion failure', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: { message: 'Upsert failed' } });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      const result = await deletePillFromCloudById('p1', mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upsert failed');
    });

    it('creates same minimal tombstone with or without pill param', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      // Call without pill
      await deletePillFromCloudById('p1', mockUserId);

      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          user_id: mockUserId,
          pill_name: '[deleted]',
          pill_data: expect.objectContaining({
            id: 'p1',
            deleted: true,
            deletedAt: expect.any(Number),
            name: '',
            dosage: '',
          }),
        }),
        expect.objectContaining({ onConflict: 'id' })
      );
    });
  });

  describe('flushOutbox', () => {
    it('drains outbox after successful uploads', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock for conditional update (returns matched row)
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });

      // Add entries to outbox
      const pill = createTestPill('p1', 'Test', Date.now());
      const entry: OutboxEntry = {
        id: 'p1',
        type: 'upsert',
        pill,
        updatedAt: Date.now(),
        userId: mockUserId,
      };
      saveOutboxToStorage(mockUserId, [entry]);

      // Verify outbox has entry
      expect(loadOutboxFromStorage(mockUserId)).toHaveLength(1);

      // Flush
      const result = await flushOutbox(mockUserId);

      expect(result.success).toBe(true);
      // Outbox should be drained after successful sync
      expect(loadOutboxFromStorage(mockUserId)).toHaveLength(0);
    });

    it('does not drain outbox entry on failed upload', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock for conditional update that fails
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'Upload failed' } });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });

      // Add entry to outbox
      const pill = createTestPill('p1', 'Test', Date.now());
      const entry: OutboxEntry = {
        id: 'p1',
        type: 'upsert',
        pill,
        updatedAt: Date.now(),
        userId: mockUserId,
      };
      saveOutboxToStorage(mockUserId, [entry]);

      // Flush
      const result = await flushOutbox(mockUserId);

      expect(result.success).toBe(false);
      // Outbox should still have the failed entry
      expect(loadOutboxFromStorage(mockUserId)).toHaveLength(1);
    });

    it('processes delete entries from outbox (soft-delete via upsert)', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      // Add delete entry to outbox
      const pill = createTestPill('p1', 'Test Pill');
      const entry: OutboxEntry = {
        id: 'p1',
        type: 'delete',
        pill,
        updatedAt: Date.now(),
        userId: mockUserId,
      };
      saveOutboxToStorage(mockUserId, [entry]);

      // Flush
      const result = await flushOutbox(mockUserId);

      expect(result.success).toBe(true);
      // Delete uses upsert with minimal tombstone (no health data)
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          pill_name: '[deleted]',
          pill_data: expect.objectContaining({
            id: 'p1',
            deleted: true,
            deletedAt: expect.any(Number),
            name: '',
          }),
        }),
        expect.any(Object)
      );
      expect(loadOutboxFromStorage(mockUserId)).toHaveLength(0);
    });

    it('each edit uploads once (no duplicate uploads)', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      // Mock for conditional update (returns matched row)
      const updateFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockReturnThis();
      const orFn = vi.fn().mockReturnThis();
      const selectFn = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });

      vi.mocked(supabase.from).mockReturnValue({
        update: updateFn,
      } as any);
      
      updateFn.mockReturnValue({ eq: eqFn });
      eqFn.mockReturnValue({ eq: eqFn, or: orFn });
      orFn.mockReturnValue({ select: selectFn });

      // Add single entry
      const pill = createTestPill('p1', 'Test', Date.now());
      const entry: OutboxEntry = {
        id: 'p1',
        type: 'upsert',
        pill,
        updatedAt: Date.now(),
        userId: mockUserId,
      };
      saveOutboxToStorage(mockUserId, [entry]);

      // Flush twice
      await flushOutbox(mockUserId);
      await flushOutbox(mockUserId);

      // Should only have uploaded once (second flush has empty outbox)
      expect(updateFn).toHaveBeenCalledTimes(1);
    });
  });
});
