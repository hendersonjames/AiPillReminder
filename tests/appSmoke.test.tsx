// tests/appSmoke.test.tsx
// App-level smoke test and mutation detection tests (A1-A7, T1, U2)
// These tests verify App.tsx uses useSyncEngine correctly.
// Uses lightweight unit tests instead of full React rendering to avoid OOM.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Read App.tsx source to verify structure
const appSource = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf-8');

describe('App Structure Tests (A1-A7, T1, U2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('A1: App imports useSyncEngine', () => {
    it('FAILS if useSyncEngine is not imported', () => {
      expect(appSource).toContain("import { useSyncEngine }");
      expect(appSource).toContain("from './lib/useSyncEngine'");
    });
  });

  describe('A2: App calls useSyncEngine hook', () => {
    it('FAILS if useSyncEngine is not called', () => {
      expect(appSource).toContain("useSyncEngine({");
      expect(appSource).toContain("loadPillsFromCloud");
    });
  });

  describe('A3: App gets pills from useSyncEngine state', () => {
    it('FAILS if pills are not destructured from state', () => {
      expect(appSource).toContain("const { pills, syncStatus } = state");
    });
  });

  describe('A4: App gets syncStatus from useSyncEngine state', () => {
    it('FAILS if syncStatus is not from useSyncEngine', () => {
      expect(appSource).toContain("syncStatus === 'syncing'");
      expect(appSource).toContain("syncStatus === 'synced'");
      expect(appSource).toContain("syncStatus === 'error'");
    });
  });

  describe('A5: App uses markDirty from useSyncEngine actions', () => {
    it('FAILS if markDirty is not used', () => {
      expect(appSource).toContain("markDirty(");
      expect(appSource).toContain("markDirty(savedPill, 'upsert')");
      expect(appSource).toContain("markDirty(updatedPill, 'upsert')");
      expect(appSource).toContain("markDirty(pill, 'delete')");
    });
  });

  describe('A6: App uses setPills from useSyncEngine actions', () => {
    it('FAILS if setPills is not from actions', () => {
      expect(appSource).toContain("const { markDirty, markReminderTaken, flushSync, hasUnsynced, setPills } = actions");
    });
  });

  describe('A7: App uses flushSync for sign-out', () => {
    it('FAILS if flushSync is not available', () => {
      expect(appSource).toContain("flushSync");
      expect(appSource).toContain("flushPendingSync");
    });
  });

  describe('T1: App does NOT have duplicate sync logic', () => {
    it('FAILS if App has its own cloudLoadSucceededRef', () => {
      // App should NOT define cloudLoadSucceededRef - it comes from useSyncEngine
      // Count occurrences in App.tsx vs useSyncEngine.ts
      const appCloudLoadRef = (appSource.match(/cloudLoadSucceededRef/g) || []).length;
      // App should have 0 definitions of cloudLoadSucceededRef
      expect(appCloudLoadRef).toBe(0);
    });
    
    it('FAILS if App has its own loadCloud effect', () => {
      // App should NOT have the load effect - it's in useSyncEngine
      expect(appSource).not.toContain("const loadCloud = async () => {");
    });
    
    it('FAILS if App imports mergePills directly', () => {
      // App should not import mergePills - useSyncEngine uses it
      expect(appSource).not.toContain("import { mergePills");
      expect(appSource).not.toContain("mergePills,");
    });
    
    it('FAILS if App imports flushOutbox directly', () => {
      // App should not import flushOutbox - useSyncEngine uses it
      expect(appSource).not.toContain("import { flushOutbox");
      expect(appSource).not.toContain("flushOutbox,");
    });
  });

  describe('U2: UUID generation uses crypto.randomUUID or crypto.getRandomValues', () => {
    it('FAILS if new pill ID uses Date.now() fallback', () => {
      // Should NOT have now.toString() as ID fallback
      expect(appSource).not.toContain(": now.toString()");
      expect(appSource).not.toContain("now.toString(); // Fallback");
    });
    
    it('Uses crypto.randomUUID', () => {
      expect(appSource).toContain("crypto.randomUUID()");
    });
    
    it('Has crypto.getRandomValues fallback', () => {
      expect(appSource).toContain("crypto.getRandomValues");
    });
    
    it('Throws error when crypto unavailable', () => {
      expect(appSource).toContain("throw new Error");
      expect(appSource).toContain("crypto.randomUUID or crypto.getRandomValues required");
    });
  });
});
