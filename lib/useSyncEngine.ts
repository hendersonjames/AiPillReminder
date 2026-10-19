// lib/useSyncEngine.ts
// Custom hook that encapsulates sync wiring for testability.
// App.tsx uses this hook, and tests can verify the wiring works correctly.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Pill } from '../types';
import type { QueuedTap } from './loadOrchestration';
import {
  loadPillsFromStorage,
  savePillsToStorage,
  loadOutboxFromStorage,
  loadQueuedTapsFromStorage,
  clearQueuedTaps,
  addQueuedTap,
  getLastMissedSweepDate,
  setLastMissedSweepDate,
  getDateString,
  setPendingSync,
} from './storage';
import {
  mergePills,
  markPillDirty,
  flushOutbox,
  hasUnsyncedChanges,
  withFlushLock,
  type FlushResult,
} from './syncEngine';
import {
  orchestrateAfterCloudLoad,
  shouldQueueTap,
  applyTakenMarkToPill,
} from './loadOrchestration';
import { recordMissedDoses, enhancePillsWithDerivedStatus } from './pillHelpers';

export interface SyncEngineConfig {
  userId: string;
  loadPillsFromCloud: () => Promise<Pill[]>;
  signingOutRef?: React.RefObject<boolean>; // Pass ref for live reads (N8)
  onPillsChange?: (pills: Pill[]) => void;
  onSyncStatusChange?: (status: 'idle' | 'syncing' | 'synced' | 'error') => void;
}

export interface SyncEngineState {
  pills: Pill[];
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  cloudLoadSucceeded: boolean;
}

export interface SyncEngineActions {
  markDirty: (pill: Pill, type: 'upsert' | 'delete') => Pill;
  queueTap: (pillId: string, reminderId: string) => void;
  applyTakenMark: (pillId: string, reminderId: string) => void;
  markReminderTaken: (pillId: string, reminderId: string) => void;
  flushSync: () => Promise<FlushResult>;
  hasUnsynced: () => boolean;
  setPills: (action: Pill[] | ((prev: Pill[]) => Pill[])) => void;
}

export interface UseSyncEngineResult {
  state: SyncEngineState;
  actions: SyncEngineActions;
}

export const useSyncEngine = (config: SyncEngineConfig): UseSyncEngineResult => {
  const { userId, loadPillsFromCloud, signingOutRef } = config;
  
  const [pills, setPillsInternal] = useState<Pill[]>([]);
  const [syncStatus, setSyncStatusInternal] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  
  const cloudLoadSucceededRef = useRef(false);
  const loadedForUserIdRef = useRef<string | null>(null);
  const pendingTapsRef = useRef<QueuedTap[]>([]);
  const justFlushedRef = useRef(false);
  const pillsRef = useRef<Pill[]>([]);
  const loadPillsFromCloudRef = useRef(loadPillsFromCloud);
  
  // Helper to read signingOut live (N8 fix - read at call time, not render time)
  const isSigningOut = (): boolean => signingOutRef?.current ?? false;
  
  // Keep loadPillsFromCloud ref in sync
  useEffect(() => { loadPillsFromCloudRef.current = loadPillsFromCloud; }, [loadPillsFromCloud]);
  
  // Store callbacks in refs to avoid effect re-runs
  const onPillsChangeRef = useRef(config.onPillsChange);
  const onSyncStatusChangeRef = useRef(config.onSyncStatusChange);
  useEffect(() => { onPillsChangeRef.current = config.onPillsChange; }, [config.onPillsChange]);
  useEffect(() => { onSyncStatusChangeRef.current = config.onSyncStatusChange; }, [config.onSyncStatusChange]);
  
  // Stable setPills that doesn't change identity
  const setPills = useCallback((action: Pill[] | ((prev: Pill[]) => Pill[])) => {
    setPillsInternal(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      return next;
    });
  }, []);
  
  // Stable setSyncStatus
  const setSyncStatus = useCallback((status: 'idle' | 'syncing' | 'synced' | 'error') => {
    setSyncStatusInternal(status);
    onSyncStatusChangeRef.current?.(status);
  }, []);
  
  // Call onPillsChange when pills change (via separate effect, not in state updater)
  useEffect(() => {
    pillsRef.current = pills;
    onPillsChangeRef.current?.(pills);
  }, [pills]);
  
  // ─── Core Actions ─────────────────────────────────────────────────────────────
  
  const markDirty = useCallback((pill: Pill, type: 'upsert' | 'delete'): Pill => {
    return markPillDirty(userId, pill, type);
  }, [userId]);
  
  const queueTap = useCallback((pillId: string, reminderId: string) => {
    if (shouldQueueTap(cloudLoadSucceededRef.current)) {
      const tap = { pillId, reminderId, userId };
      pendingTapsRef.current.push(tap);
      addQueuedTap(userId, tap);
    }
  }, [userId]);
  
  const applyTakenMark = useCallback((pillId: string, reminderId: string) => {
    setPills(prevPills => prevPills.map(pill => {
      if (pill.id === pillId) {
        const updated = applyTakenMarkToPill(pill, reminderId);
        if (updated !== pill) {
          return markPillDirty(userId, updated, 'upsert');
        }
      }
      return pill;
    }));
  }, [userId, setPills]);
  
  const markReminderTaken = useCallback((pillId: string, reminderId: string) => {
    if (shouldQueueTap(cloudLoadSucceededRef.current)) {
      const tap = { pillId, reminderId, userId };
      pendingTapsRef.current.push(tap);
      addQueuedTap(userId, tap);
      return;
    }
    applyTakenMark(pillId, reminderId);
  }, [userId, applyTakenMark]);
  
  const flushSync = useCallback(async (): Promise<FlushResult> => {
    if (!cloudLoadSucceededRef.current) {
      return { success: false, error: 'Cloud load not complete' };
    }
    if (loadedForUserIdRef.current !== userId) {
      return { success: false, error: 'User mismatch' };
    }
    
    // Use Web Locks to ensure only one tab flushes at a time
    const { acquired, result } = await withFlushLock(userId, async () => {
      const currentOutbox = loadOutboxFromStorage(userId);
      if (currentOutbox.length === 0) {
        return { success: true } as FlushResult;
      }
      return await flushOutbox(userId);
    });
    
    if (!acquired || !result) {
      // Another tab is flushing
      return { success: true };
    }
    
    // L-b fix: remove tombstoned pills from state
    if (result.tombstonedIds && result.tombstonedIds.length > 0) {
      setPillsInternal(prev => prev.filter(p => !result.tombstonedIds!.includes(p.id)));
    }
    
    if (result.success) {
      setPendingSync(userId, false);
    }
    
    return result;
  }, [userId]);
  
  const hasUnsynced = useCallback((): boolean => {
    return hasUnsyncedChanges(userId);
  }, [userId]);
  
  // ─── Load from cloud on mount ─────────────────────────────────────────────────
  // Track if load is in progress to prevent duplicate loads (StrictMode, etc.)
  const loadInProgressRef = useRef(false);
  
  useEffect(() => {
    let cancelled = false;
    
    const loadCloud = async () => {
      // Prevent duplicate loads
      if (loadInProgressRef.current) return;
      loadInProgressRef.current = true;
      
      cloudLoadSucceededRef.current = false;
      loadedForUserIdRef.current = null;
      
      // Load persisted taps
      const persistedTaps = loadQueuedTapsFromStorage(userId);
      pendingTapsRef.current = [...persistedTaps];
      
      // Load local pills for immediate UI
      const localPills = loadPillsFromStorage(userId);
      if (localPills.length > 0 && !cancelled) {
        setPillsInternal(enhancePillsWithDerivedStatus(localPills));
      }
      
      try {
        setSyncStatusInternal('syncing');
        const cloudPills = await loadPillsFromCloudRef.current();
        
        if (cancelled) return;
        
        // MERGE cloud with local dirty changes
        const outbox = loadOutboxFromStorage(userId);
        const { pills: mergedPills, hasLocalChanges } = mergePills(
          localPills,
          cloudPills,
          outbox
        );
        
        cloudLoadSucceededRef.current = true;
        loadedForUserIdRef.current = userId;
        
        // Run orchestration
        const lastSweep = getLastMissedSweepDate(userId);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getDateString(yesterday);
        
        const tapsToApply = [...pendingTapsRef.current];
        
        const orchestrationResult = orchestrateAfterCloudLoad(
          mergedPills,
          lastSweep,
          yesterdayStr,
          tapsToApply,
          userId,
          recordMissedDoses
        );
        
        if (orchestrationResult.sweepRan) {
          setLastMissedSweepDate(userId, yesterdayStr);
        }
        
        // Mark changed pills dirty
        for (const pill of orchestrationResult.pills) {
          if (orchestrationResult.changedPillIds.has(pill.id)) {
            markPillDirty(userId, pill, 'upsert');
          }
        }
        
        // Clear queued taps
        pendingTapsRef.current = [];
        clearQueuedTaps(userId);
        
        const enhancedPills = enhancePillsWithDerivedStatus(orchestrationResult.pills);
        savePillsToStorage(userId, enhancedPills);
        
        // Flush outbox after load - set flag BEFORE setPills to prevent debounced effect
        const currentOutbox = loadOutboxFromStorage(userId);
        if (currentOutbox.length > 0 || hasLocalChanges) {
          justFlushedRef.current = true;
        }
        
        if (cancelled) return;
        
        // Now update state
        setPillsInternal(enhancedPills);
        
        // Actually flush
        if (currentOutbox.length > 0 || hasLocalChanges) {
          const flushResult = await flushOutbox(userId);
          if (!cancelled) {
            setSyncStatusInternal(flushResult.success ? 'synced' : 'error');
          }
        } else {
          if (!cancelled) setSyncStatusInternal('synced');
        }
        
        setPendingSync(userId, false);
        loadInProgressRef.current = false;
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        if (!cancelled) setSyncStatusInternal('error');
        loadInProgressRef.current = false;
      }
    };
    
    loadCloud();
    
    return () => { cancelled = true; };
  }, [userId]); // Only depends on userId
  
  // ─── Persist to localStorage ──────────────────────────────────────────────────
  useEffect(() => {
    if (loadedForUserIdRef.current !== userId) return;
    if (isSigningOut()) return; // Block writes during sign-out (N8: read live)
    savePillsToStorage(userId, pills);
  }, [pills, userId]);
  
  // ─── Debounced outbox flush (single-tab via Web Locks) ──────────────────────
  useEffect(() => {
    if (!cloudLoadSucceededRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    if (isSigningOut()) return; // N8: read live
    
    if (justFlushedRef.current) {
      justFlushedRef.current = false;
      return;
    }
    
    const outbox = loadOutboxFromStorage(userId);
    if (outbox.length === 0) return;
    
    setPendingSync(userId, true);
    setSyncStatusInternal('idle');
    
    const timeoutId = setTimeout(async () => {
      if (loadedForUserIdRef.current !== userId) return;
      if (isSigningOut()) return; // N8: read live
      
      // Use Web Locks to ensure only one tab flushes at a time
      const { acquired, result } = await withFlushLock(userId, async () => {
        // Re-check outbox inside lock - another tab may have flushed
        const currentOutbox = loadOutboxFromStorage(userId);
        if (currentOutbox.length === 0) {
          return { success: true } as FlushResult;
        }
        
        setSyncStatusInternal('syncing');
        return await flushOutbox(userId);
      });
      
      if (!acquired) {
        // Another tab is flushing - just wait and check status later
        setSyncStatusInternal('idle');
        return;
      }
      
      if (result) {
        // L-b fix: remove tombstoned pills from state
        if (result.tombstonedIds && result.tombstonedIds.length > 0) {
          setPillsInternal(prev => prev.filter(p => !result.tombstonedIds!.includes(p.id)));
        }
        
        if (result.success) {
          setPendingSync(userId, false);
          setSyncStatusInternal('synced');
        } else {
          setSyncStatusInternal('error');
        }
      }
    }, 1500);
    
    return () => clearTimeout(timeoutId);
  }, [pills, userId]); // Stable deps - no function deps
  
  return {
    state: {
      pills,
      syncStatus,
      cloudLoadSucceeded: cloudLoadSucceededRef.current,
    },
    actions: {
      markDirty,
      queueTap,
      applyTakenMark,
      markReminderTaken,
      flushSync,
      hasUnsynced,
      setPills,
    },
  };
};
