
import type { UserProfile, SessionProgress } from './types';

const USER_PROFILE_KEY = 'nepraAgentUserProfile_v2';
const SESSION_PROGRESS_KEY = 'nepraAgentSessionId_v2'; // Now primarily stores session ID

// User Profile (collected once, could be part of session)
export const saveUserProfileToStorage = (profile: UserProfile): void => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    } catch (error) {
      console.error("Error saving user profile to local storage:", error);
    }
  }
};

export const loadUserProfileFromStorage = (): UserProfile | null => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(USER_PROFILE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error loading user profile from local storage:", error);
      return null;
    }
  }
  return null;
};

// Nepra Session Progress - now focuses on storing the active session ID
// and potentially some quick-access user profile data for form pre-fill.
export const saveActiveSessionReference = (progress: SessionProgress): void => {
   if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(SESSION_PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
      console.error("Error saving session reference to local storage:", error);
    }
  }
};

export const loadActiveSessionReference = (): SessionProgress | null => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(SESSION_PROGRESS_KEY);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error loading session reference from local storage:", error);
      return null;
    }
  }
  return null;
};

export const clearActiveSessionReference = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_PROGRESS_KEY);
  }
};

// Utility to generate a simple unique ID for sessions
export const generateSessionId = (): string => {
  return `session_${new Date().getTime()}_${Math.random().toString(36).substring(2, 11)}`;
};

export const clearAllNepraData = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(SESSION_PROGRESS_KEY);
    // Potentially clear other app-specific keys if added later
  }
}
