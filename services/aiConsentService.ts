/**
 * AI Consent Service
 *
 * Manages user consent for sending medication data to AI (Gemini).
 *
 * TRADE-OFF: Consent is stored per-device in localStorage, keyed by
 * Supabase user ID. This means:
 * - Consent does not sync across devices (user must consent on each device)
 * - No server-side record of consent exists
 * - If localStorage is cleared, consent must be given again
 *
 * This approach was chosen because:
 * 1. It's the simplest implementation with no backend changes required
 * 2. PR #3 is rewriting geminiService.ts to move Gemini server-side,
 *    which may provide a better location for server-side consent tracking
 * 3. Per-device consent provides an extra layer of control for users
 *    who may want AI features on some devices but not others
 */

const CONSENT_KEY_PREFIX = 'remedi_ai_consent_';

export type ConsentStatus = 'granted' | 'declined' | 'unknown';

/**
 * Gets the localStorage key for a specific user's AI consent
 */
const getConsentKey = (userId: string): string => {
  return `${CONSENT_KEY_PREFIX}${userId}`;
};

/**
 * Gets the current AI consent status for a user.
 * Returns 'unknown' if user has never been prompted.
 */
export const getAIConsentStatus = (userId: string | undefined): ConsentStatus => {
  if (!userId) return 'unknown';
  
  const value = localStorage.getItem(getConsentKey(userId));
  if (value === 'granted') return 'granted';
  if (value === 'declined') return 'declined';
  return 'unknown';
};

/**
 * Checks if the user has explicitly granted consent for AI features.
 */
export const hasAIConsent = (userId: string | undefined): boolean => {
  return getAIConsentStatus(userId) === 'granted';
};

/**
 * Checks if the user has explicitly declined consent (vs never asked).
 */
export const hasDeclinedAIConsent = (userId: string | undefined): boolean => {
  return getAIConsentStatus(userId) === 'declined';
};

/**
 * Grants AI consent for a user. Call when user accepts the consent dialog.
 */
export const grantAIConsent = (userId: string): void => {
  localStorage.setItem(getConsentKey(userId), 'granted');
};

/**
 * Declines AI consent for a user. Call when user declines the consent dialog.
 */
export const declineAIConsent = (userId: string): void => {
  localStorage.setItem(getConsentKey(userId), 'declined');
};

/**
 * Revokes previously granted consent (resets to unknown so dialog shows again).
 * Call when user wants to change their consent decision.
 */
export const revokeAIConsent = (userId: string): void => {
  localStorage.removeItem(getConsentKey(userId));
};

/**
 * Resets consent to unknown state, allowing the dialog to be shown again.
 * Use when user wants to re-evaluate their consent decision.
 */
export const resetAIConsent = (userId: string): void => {
  localStorage.removeItem(getConsentKey(userId));
};
