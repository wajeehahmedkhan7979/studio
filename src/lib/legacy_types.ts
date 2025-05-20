
// This file contains older type definitions that are being phased out
// but kept temporarily for a smoother transition.

// User profile information, collected at the start
export interface UserProfile {
  name: string;
  email: string;
  linkedin?: string; // Optional LinkedIn URL
  department: string; // e.g., Security Policy, VAPT, Monitoring, Audit, Training, Reporting
  role: string; // Role within the department
}

// Structure for a single answer within a session
export interface NepraAnswer {
  question: string; // The text of the question asked
  answerText: string; // The user's answer
  timestamp: string; // ISO string format for when the answer was recorded
  nepraCategory?: string; 
}

// Represents a user's session for the NEPRA questionnaire
export interface NepraSessionData {
  sessionId: string; // Unique anonymous session identifier
  userProfile: UserProfile; // User's department, role, and contact info
  questions: string[]; // List of questions for this session
  answers: Record<number, NepraAnswer>; // Index of question to NepraAnswer object
  currentQuestionIndex: number;
  startTime: string; // ISO string format for session start
  lastSavedTime?: string; // ISO string format for last save/resume
  completedTime?: string; // ISO string format for when questionnaire was completed
  reportGenerated: boolean; // Flag if report has been generated
  reportUrl?: string; // URL if report is stored (e.g., Firebase Storage)
}

// Minimal structure for saving progress
export interface NepraQuestionnaireProgress {
  sessionId?: string;
  userProfile?: UserProfile;
  questions?: string[];
  answers?: Record<number, NepraAnswer>;
  currentQuestionIndex?: number;
  startTime?: string;
}

// Kept for compatibility with Genkit flow argument, but QuestionnaireData is richer.
export interface QuestionnaireDataForReport {
  questions: string[];
  // Genkit flow currently expects string-indexed answers, this needs to be reconciled
  // with the richer NepraAnswer structure for report generation.
  answers: Record<string, { 
    question: string; 
    answerText: string; 
    timestamp: string;
    nepraCategory?: string;
  }>; 
}
