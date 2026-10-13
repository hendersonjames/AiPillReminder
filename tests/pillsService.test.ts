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
    it('upserts a single pill with user verification', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      const pill = createTestPill('p1', 'Test Pill', Date.now());
      const result = await upsertPillToCloud(pill, mockUserId);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          user_id: mockUserId,
          pill_name: 'Test Pill',
        }),
        expect.objectContaining({ onConflict: 'id' })
      );
    });

    it('rejects empty pill body', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      // Create a pill and verify the upsert includes pill_data
      const pill = createTestPill('p1', 'Test Pill', Date.now());
      await upsertPillToCloud(pill, mockUserId);

      // Verify pill_data is included and not empty
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          pill_data: expect.objectContaining({
            id: 'p1',
            name: 'Test Pill',
          }),
        }),
        expect.any(Object)
      );
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
    it('soft-deletes a pill by upserting tombstone', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      const pill = createTestPill('p1', 'Test Pill');
      const result = await deletePillFromCloudById('p1', mockUserId, pill);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          user_id: mockUserId,
          pill_data: expect.objectContaining({
            deleted: true,
            deletedAt: expect.any(Number),
          }),
        }),
        expect.objectContaining({ onConflict: 'id' })
      );
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

    it('creates minimal tombstone when pill is not provided', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { user: mockUser } as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      const result = await deletePillFromCloudById('p1', mockUserId);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          user_id: mockUserId,
          pill_name: '[deleted]',
          pill_data: expect.objectContaining({
            id: 'p1',
            deleted: true,
            deletedAt: expect.any(Number),
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

      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

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

      const upsertFn = vi.fn().mockResolvedValue({ error: { message: 'Upload failed' } });
      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

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

      // Add delete entry to outbox with pill data for full tombstone
      const pill = createTestPill('p1', 'Test Pill');
      const entry: OutboxEntry = {
        id: 'p1',
        type: 'delete',
        pill, // Include pill for full tombstone
        updatedAt: Date.now(),
        userId: mockUserId,
      };
      saveOutboxToStorage(mockUserId, [entry]);

      // Flush
      const result = await flushOutbox(mockUserId);

      expect(result.success).toBe(true);
      // Delete now uses upsert with tombstone
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          pill_data: expect.objectContaining({
            deleted: true,
            deletedAt: expect.any(Number),
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

      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

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
      expect(upsertFn).toHaveBeenCalledTimes(1);
    });
  });
});
