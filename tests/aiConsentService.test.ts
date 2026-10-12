import { describe, it, expect, beforeEach } from 'vitest';
import { localStorageMock } from './setup';
import {
  getAIConsentStatus,
  hasAIConsent,
  hasDeclinedAIConsent,
  grantAIConsent,
  declineAIConsent,
  revokeAIConsent,
  resetAIConsent,
} from '../services/aiConsentService';

describe('aiConsentService', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getAIConsentStatus', () => {
    it('returns "unknown" when userId is undefined', () => {
      expect(getAIConsentStatus(undefined)).toBe('unknown');
    });

    it('returns "unknown" for new user with no stored consent', () => {
      expect(getAIConsentStatus('user-123')).toBe('unknown');
    });

    it('returns "granted" when consent was granted', () => {
      grantAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('granted');
    });

    it('returns "declined" when consent was declined', () => {
      declineAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('declined');
    });
  });

  describe('hasAIConsent', () => {
    it('returns false when userId is undefined', () => {
      expect(hasAIConsent(undefined)).toBe(false);
    });

    it('returns false for new user', () => {
      expect(hasAIConsent('user-123')).toBe(false);
    });

    it('returns true after granting consent', () => {
      grantAIConsent('user-123');
      expect(hasAIConsent('user-123')).toBe(true);
    });

    it('returns false after declining consent', () => {
      declineAIConsent('user-123');
      expect(hasAIConsent('user-123')).toBe(false);
    });
  });

  describe('hasDeclinedAIConsent', () => {
    it('returns false when userId is undefined', () => {
      expect(hasDeclinedAIConsent(undefined)).toBe(false);
    });

    it('returns false for new user (not declined, just unknown)', () => {
      expect(hasDeclinedAIConsent('user-123')).toBe(false);
    });

    it('returns true after explicitly declining', () => {
      declineAIConsent('user-123');
      expect(hasDeclinedAIConsent('user-123')).toBe(true);
    });

    it('returns false after granting consent', () => {
      grantAIConsent('user-123');
      expect(hasDeclinedAIConsent('user-123')).toBe(false);
    });
  });

  describe('grantAIConsent', () => {
    it('sets consent to granted', () => {
      grantAIConsent('user-123');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'remedi_ai_consent_user-123',
        'granted'
      );
      expect(getAIConsentStatus('user-123')).toBe('granted');
    });

    it('overwrites previously declined consent', () => {
      declineAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('declined');
      
      grantAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('granted');
    });
  });

  describe('declineAIConsent', () => {
    it('sets consent to declined', () => {
      declineAIConsent('user-123');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'remedi_ai_consent_user-123',
        'declined'
      );
      expect(getAIConsentStatus('user-123')).toBe('declined');
    });

    it('overwrites previously granted consent', () => {
      grantAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('granted');
      
      declineAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('declined');
    });
  });

  describe('revokeAIConsent', () => {
    it('removes consent entry from localStorage', () => {
      grantAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('granted');
      
      revokeAIConsent('user-123');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        'remedi_ai_consent_user-123'
      );
      expect(getAIConsentStatus('user-123')).toBe('unknown');
    });
  });

  describe('resetAIConsent', () => {
    it('resets consent to unknown state', () => {
      declineAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('declined');
      
      resetAIConsent('user-123');
      expect(getAIConsentStatus('user-123')).toBe('unknown');
    });

    it('allows re-prompting after reset', () => {
      grantAIConsent('user-123');
      resetAIConsent('user-123');
      expect(hasAIConsent('user-123')).toBe(false);
      expect(hasDeclinedAIConsent('user-123')).toBe(false);
    });
  });

  describe('per-user isolation', () => {
    it('keeps consent separate per user', () => {
      grantAIConsent('user-1');
      declineAIConsent('user-2');
      
      expect(getAIConsentStatus('user-1')).toBe('granted');
      expect(getAIConsentStatus('user-2')).toBe('declined');
      expect(getAIConsentStatus('user-3')).toBe('unknown');
    });
  });
});
