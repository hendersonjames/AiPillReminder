import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pill } from '../types';

// Mock supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(),
  },
}));

import { supabase } from '../lib/supabase';
import { loadPillsFromCloud, syncPillsToCloud, savePillToCloud, deletePillFromCloud } from '../services/pillsService';

describe('pillsService', () => {
  const mockUser = { id: 'user-123' };

  const createTestPill = (id: string, name: string): Pill => ({
    id,
    name,
    dosage: '500mg',
    reminders: [{ id: 'r1', time: '09:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], taken: false }],
    history: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPillsFromCloud', () => {
    it('loads and transforms pills from database', async () => {
      const dbRows = [
        { id: 'p1', user_id: mockUser.id, pill_name: 'Vitamin D', pill_data: { name: 'Vitamin D', dosage: '1000IU' }, created_at: '2024-01-01' },
        { id: 'p2', user_id: mockUser.id, pill_name: 'Aspirin', pill_data: { name: 'Aspirin', dosage: '81mg' }, created_at: '2024-01-02' },
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
  });

  describe('syncPillsToCloud', () => {
    beforeEach(() => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: mockUser as any },
        error: null,
      });
    });

    it('upserts local pills and deletes removed ones', async () => {
      const localPills = [createTestPill('p1', 'Vitamin D'), createTestPill('p3', 'New Pill')];
      const existingCloudIds = new Set(['p1', 'p2']); // p2 was deleted locally

      const upsertFn = vi.fn().mockResolvedValue({ error: null });
      const deleteFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => ({
        upsert: upsertFn,
        delete: deleteFn,
        eq: eqFn,
      } as any));

      deleteFn.mockReturnValue({ eq: eqFn });

      const result = await syncPillsToCloud(localPills, existingCloudIds);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledTimes(2); // 2 pills to upsert
      expect(deleteFn).toHaveBeenCalled(); // p2 should be deleted
    });

    it('returns error when not authenticated', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await syncPillsToCloud([createTestPill('p1', 'Test')], new Set());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not authenticated');
    });

    it('collects errors from failed operations', async () => {
      const localPills = [createTestPill('p1', 'Vitamin D')];

      const upsertFn = vi.fn().mockResolvedValue({ error: { message: 'Upsert failed' } });

      vi.mocked(supabase.from).mockImplementation((table: string) => ({
        upsert: upsertFn,
      } as any));

      const result = await syncPillsToCloud(localPills, new Set());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Upsert failed');
    });
  });

  describe('savePillToCloud', () => {
    it('upserts a single pill', async () => {
      vi.mocked(supabase.auth.getUser).mockResolvedValue({
        data: { user: mockUser as any },
        error: null,
      });

      const upsertFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        upsert: upsertFn,
      } as any);

      const pill = createTestPill('p1', 'Test Pill');
      const result = await savePillToCloud(pill);

      expect(result.success).toBe(true);
      expect(upsertFn).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          user_id: mockUser.id,
          pill_name: 'Test Pill',
        }),
        expect.objectContaining({ onConflict: 'id' })
      );
    });
  });

  describe('deletePillFromCloud', () => {
    it('deletes a pill by ID', async () => {
      const deleteFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockResolvedValue({ error: null });

      vi.mocked(supabase.from).mockReturnValue({
        delete: deleteFn,
      } as any);

      deleteFn.mockReturnValue({ eq: eqFn });

      const result = await deletePillFromCloud('p1');

      expect(result.success).toBe(true);
      expect(deleteFn).toHaveBeenCalled();
      expect(eqFn).toHaveBeenCalledWith('id', 'p1');
    });

    it('returns error on deletion failure', async () => {
      const deleteFn = vi.fn().mockReturnThis();
      const eqFn = vi.fn().mockResolvedValue({ error: { message: 'Delete failed' } });

      vi.mocked(supabase.from).mockReturnValue({
        delete: deleteFn,
      } as any);

      deleteFn.mockReturnValue({ eq: eqFn });

      const result = await deletePillFromCloud('p1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });
});
