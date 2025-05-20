
// User profile information, collected at the start
export interface UserProfile {
  name: string;
  email: string;
  linkedin?: string; // Optional LinkedIn URL
  department: string; // e.g., Security Policy, VAPT, Monitoring, Audit, Training, Reporting
  role: string; // Role within the department
}

// Structure for a question definition (potentially from a 'questions' collection)
export interface QuestionDefinition {
  id: string;
  category: string; // e.g., Access Control, Incident Response
  subcategory?: string; // e.g., Account Management, Breach Notification
  questionText: string;
  // Could add fields to link to department/role if not AI-generated each time
  // applicableDepartments?: string[];
  // applicableRoles?: string[];
}

// Structure for a single response within a session
export interface ResponseData {
  questionId: string; // Corresponds to QuestionDefinition.id or index if questions are just an array
  questionText: string; // Storing the question text with the answer for context
  answerText: string;
  timestamp: string; // ISO string format
  riskLevel?: 'low' | 'medium' | 'high' | 'not_assessed'; // For future risk analysis
  nepraCategory?: string; // Derived or pre-assigned NEPRA category
}

// Represents a user's compliance session
export interface ComplianceSession {
  sessionId: string;
  userProfile: UserProfile;
  questions: QuestionDefinition[]; // The set of questions for this session
  responses: Record<string, ResponseData>; // questionId maps to ResponseData
  currentQuestionIndex: number; // Index for the 'questions' array
  startTime: string; // ISO string format for session start
  lastSavedTime?: string; // ISO string format for last save/resume
  completedTime?: string; // ISO string format for when questionnaire was completed
  status: 'initial' | 'form' | 'questionnaire' | 'generating_report' | 'report_ready' | 'error' | 'paused';
  reportGenerated: boolean;
  reportUrl?: string; // URL if report is stored (e.g., Firebase Storage)
}


// Minimal structure for saving progress in local storage (primarily sessionId)
export interface SessionProgress {
  sessionId?: string;
  // We might store userProfile here too for faster form re-population on resume
  userProfile?: UserProfile; 
  // currentQuestionIndex might be useful if we don't want to recalculate from Firestore responses
  currentQuestionIndex?: number; 
}


// Input for the generateNepraReport Genkit flow
export interface ReportGenerationInput {
  session: ComplianceSession; // Contains userProfile, and all questions/responses
}

// Output for the tailorNepraQuestions Genkit flow
export interface TailoredQuestionsOutput {
  // If AI generates structured questions:
  // questions: QuestionDefinition[];
  // For now, keeping it as strings, but the prompt will guide the AI on structure
  questions: string[]; // List of question texts
}

// For the report generation, aligning with current flow structure
// but using more detailed ResponseData
export interface QuestionnaireDataForReport {
  questions: string[]; // The original question texts in order
  // Answers map index (as string) to the detailed ResponseData object
  answers: Record<string, {
    question: string; // The question text (redundant with questions array, but good for direct lookup)
    answerText: string;
    timestamp: string;
    nepraCategory?: string;
  }>;
}

// Adapting NepraAnswer for clarity, to be used by report generator
export type ReportAnswerDetail = {
  question: string;
  answerText: string;
  timestamp: string;
  nepraCategory?: string;
};


// Keeping original types for smoother transition if some parts still use them temporarily,
// but aiming to phase them out for the new structures.

export type { NepraAnswer, NepraSessionData, NepraQuestionnaireProgress } from './legacy_types';
