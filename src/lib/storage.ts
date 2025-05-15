import type { UserProfile, QuestionnaireData } from './types';

const USER_PROFILE_KEY = 'csmAssistantProfile';
const QUESTIONNAIRE_PROGRESS_KEY = 'csmAssistantProgress';

// User Profile
export const saveUserProfile = (profile: UserProfile): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  }
};

export const loadUserProfile = (): UserProfile | null => {
  if (typeof window !== 'undefined') {
    const data = localStorage.getItem(USER_PROFILE_KEY);
    return data ? JSON.parse(data) : null;
  }
  return null;
};

// Questionnaire Progress
export const saveQuestionnaireProgress = (progress: Partial<QuestionnaireData>): void => {
   if (typeof window !== 'undefined') {
    const existingProgress = loadQuestionnaireProgress() || {};
    const newProgress = { ...existingProgress, ...progress };
    localStorage.setItem(QUESTIONNAIRE_PROGRESS_KEY, JSON.stringify(newProgress));
  }
};

export const loadQuestionnaireProgress = (): Partial<QuestionnaireData> | null => {
  if (typeof window !== 'undefined') {
    const data = localStorage.getItem(QUESTIONNAIRE_PROGRESS_KEY);
    return data ? JSON.parse(data) : null;
  }
  return null;
};

export const clearQuestionnaireProgress = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(QUESTIONNAIRE_PROGRESS_KEY);
  }
};

export const clearAllData = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(QUESTIONNAIRE_PROGRESS_KEY);
  }
}
