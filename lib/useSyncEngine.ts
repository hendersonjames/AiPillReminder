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
  flushSync: () => Promise<FlushResult>;
  hasUnsynced: () => boolean;
  setPills: React.Dispatch<React.SetStateAction<Pill[]>>;
}

export interface UseSyncEngineResult {
  state: SyncEngineState;
  actions: SyncEngineActions;
}

export const useSyncEngine = (config: SyncEngineConfig): UseSyncEngineResult => {
  const { userId, loadPillsFromCloud, onPillsChange, onSyncStatusChange } = config;
  
  const [pills, setPillsInternal] = useState<Pill[]>([]);
  const [syncStatus, setSyncStatusInternal] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  
  const cloudLoadSucceededRef = useRef(false);
  const loadedForUserIdRef = useRef<string | null>(null);
  const pendingTapsRef = useRef<QueuedTap[]>([]);
  const justFlushedRef = useRef(false);
  const pillsRef = useRef<Pill[]>([]);
  
  // Keep ref in sync
  useEffect(() => { pillsRef.current = pills; }, [pills]);
  
  // Wrapper to notify on pills change
  const setPills: React.Dispatch<React.SetStateAction<Pill[]>> = useCallback((action) => {
    setPillsInternal(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      onPillsChange?.(next);
      return next;
    });
  }, [onPillsChange]);
  
  // Wrapper to notify on sync status change
  const setSyncStatus = useCallback((status: 'idle' | 'syncing' | 'synced' | 'error') => {
    setSyncStatusInternal(status);
    onSyncStatusChange?.(status);
  }, [onSyncStatusChange]);
  
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
  
  const flushSync = useCallback(async (): Promise<FlushResult> => {
    if (!cloudLoadSucceededRef.current) {
      return { success: false, error: 'Cloud load not complete' };
    }
    if (loadedForUserIdRef.current !== userId) {
      return { success: false, error: 'User mismatch' };
    }
    
    const result = await flushOutbox(userId);
    
    // Handle tombstoned pills
    if (result.tombstonedIds && result.tombstonedIds.length > 0) {
      setPills(prev => prev.filter(p => !result.tombstonedIds!.includes(p.id)));
    }
    
    if (result.success) {
      setPendingSync(userId, false);
    }
    
    return result;
  }, [userId, setPills]);
  
  const hasUnsynced = useCallback((): boolean => {
    return hasUnsyncedChanges(userId);
  }, [userId]);
  
  // ─── Load from cloud on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const loadCloud = async () => {
      cloudLoadSucceededRef.current = false;
      loadedForUserIdRef.current = null;
      
      // Load persisted taps
      const persistedTaps = loadQueuedTapsFromStorage(userId);
      pendingTapsRef.current = [...persistedTaps];
      
      // Load local pills for immediate UI
      const localPills = loadPillsFromStorage(userId);
      if (localPills.length > 0) {
        setPills(enhancePillsWithDerivedStatus(localPills));
      }
      
      try {
        setSyncStatus('syncing');
        const cloudPills = await loadPillsFromCloud();
        
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
        setPills(enhancedPills);
        savePillsToStorage(userId, enhancedPills);
        
        // Flush outbox after load
        const currentOutbox = loadOutboxFromStorage(userId);
        if (currentOutbox.length > 0 || hasLocalChanges) {
          justFlushedRef.current = true;
          const flushResult = await flushOutbox(userId);
          if (flushResult.success) {
            setSyncStatus('synced');
          } else {
            setSyncStatus('error');
          }
        } else {
          setSyncStatus('synced');
        }
        
        setPendingSync(userId, false);
      } catch (err) {
        console.error('Failed to load from cloud:', err);
        setSyncStatus('error');
      }
    };
    
    loadCloud();
  }, [userId, loadPillsFromCloud, setPills, setSyncStatus]);
  
  // ─── Persist to localStorage ──────────────────────────────────────────────────
  useEffect(() => {
    if (loadedForUserIdRef.current !== userId) return;
    savePillsToStorage(userId, pills);
  }, [pills, userId]);
  
  // ─── Debounced outbox flush ───────────────────────────────────────────────────
  useEffect(() => {
    if (!cloudLoadSucceededRef.current) return;
    if (loadedForUserIdRef.current !== userId) return;
    
    if (justFlushedRef.current) {
      justFlushedRef.current = false;
      return;
    }
    
    const outbox = loadOutboxFromStorage(userId);
    if (outbox.length === 0) return;
    
    setPendingSync(userId, true);
    setSyncStatus('idle');
    
    const timeoutId = setTimeout(async () => {
      if (loadedForUserIdRef.current !== userId) return;
      
      setSyncStatus('syncing');
      const result = await flushOutbox(userId);
      
      if (result.tombstonedIds && result.tombstonedIds.length > 0) {
        setPills(prev => prev.filter(p => !result.tombstonedIds!.includes(p.id)));
      }
      
      if (result.success) {
        setPendingSync(userId, false);
        setSyncStatus('synced');
      } else {
        setSyncStatus('error');
      }
    }, 1500);
    
    return () => clearTimeout(timeoutId);
  }, [pills, userId, setPills, setSyncStatus]);
  
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
      flushSync,
      hasUnsynced,
      setPills,
    },
  };
};
