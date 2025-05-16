
import type { UserProfile, NepraQuestionnaireProgress, NepraSessionData } from './types';

const USER_PROFILE_KEY = 'nepraAgentUserProfile'; // Changed key for new app
const SESSION_PROGRESS_KEY = 'nepraAgentSessionProgress'; // Changed key for new app

// User Profile (collected once, could be part of session)
export const saveUserProfileToStorage = (profile: UserProfile): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  }
};

export const loadUserProfileFromStorage = (): UserProfile | null => {
  if (typeof window !== 'undefined') {
    const data = localStorage.getItem(USER_PROFILE_KEY);
    return data ? JSON.parse(data) : null;
  }
  return null;
};

// Nepra Session Progress
export const saveSessionProgress = (progress: NepraQuestionnaireProgress): void => {
   if (typeof window !== 'undefined') {
    const existingProgress = loadSessionProgress() || {};
    const newProgress = { ...existingProgress, ...progress };
    localStorage.setItem(SESSION_PROGRESS_KEY, JSON.stringify(newProgress));
  }
};

export const loadSessionProgress = (): NepraQuestionnaireProgress | null => {
  if (typeof window !== 'undefined') {
    const data = localStorage.getItem(SESSION_PROGRESS_KEY);
    // Basic validation could be added here if needed
    return data ? JSON.parse(data) : null;
  }
  return null;
};

export const clearSessionProgress = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SESSION_PROGRESS_KEY);
  }
};

// Utility to generate a simple unique ID for sessions
export const generateSessionId = (): string => {
  return `session_${new Date().getTime()}_${Math.random().toString(36).substring(2, 9)}`;
};

export const clearAllNepraData = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(SESSION_PROGRESS_KEY);
  }
}
