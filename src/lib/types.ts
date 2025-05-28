
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
  questionText: string; // Includes AI-generated NEPRA hint, e.g., "🛈 NEPRA Section X.Y: Your question..."
  category: string; // Main NEPRA category or AI-inferred
}

// Structure for a single response within a session
export interface ResponseData {
  questionId: string; // Corresponds to QuestionDefinition.id
  questionText: string; // Storing the question text with the answer for context
  answerText: string;
  policyMaturityScore: number; // Score from 0.0 to 10.0
  practiceMaturityScore: number; // Score from 0.0 to 10.0
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
  
  // These policyAreasToRate and currentRatingAreaIndex are from a previous iteration.
  // The new requirement is per-question scoring, not overall policy area rating.
  // I'll keep them for now but they might become obsolete or repurposed.
  // For now, they are NOT being used in the primary question flow.
  policyAreasToRate: string[];
  currentRatingAreaIndex: number;
  policyScores: Record<string, number>; // This was for overall department ratings, potentially to be removed or rethought.

  startTime: string; // ISO string format for session start
  lastSavedTime?: string; // ISO string format for last save/resume
  completedTime?: string; // ISO string format for when questionnaire was completed
  status: 'initial' | 'form' | 'questionnaire' | 'generating_report' | 'report_ready' | 'error'; // Removed 'collecting_ratings' as ratings are per-question
  reportGenerated: boolean;
  reportUrl?: string; // URL if report is stored (e.g., Firebase Storage)
}


// Minimal structure for saving progress in local storage
export interface SessionProgress {
  sessionId?: string;
  userProfile?: UserProfile;
  currentQuestionIndex?: number;
  // currentRatingAreaIndex and policyScores here were for the separate rating phase.
  // Since ratings are now per-question, these might not be needed in local storage for resume
  // unless we want to pre-fill the sliders of the current question on resume.
  // For simplicity, current resume will load all answered questions, and the current question will start fresh with sliders.
}

// Data for the report generation flow
export interface QuestionnaireDataForReport {
  questions: QuestionDefinition[]; // Array of QuestionDefinition objects
  answers: Record<string, ReportAnswerDetail>; // questionId (string) maps to the user's detailed answer object.
  averagePolicyMaturity?: number;
  averagePracticeMaturity?: number;
  policyScores?: Record<string, number>; // This was for overall department ratings. To be reviewed.
}

// Detailed answer structure for the report
export type ReportAnswerDetail = {
  question: string; // The full question text
  answerText: string;
  policyMaturityScore: number;
  practiceMaturityScore: number;
  timestamp: string;
  nepraCategory?: string;
};

// Input for the tailorNepraQuestions Genkit flow
export interface TailorNepraQuestionsInput {
  department: string;
  role: string;
}

// Output for the tailorNepraQuestions Genkit flow
export interface TailoredQuestionsOutput {
  questions: string[]; // List of question texts, with hints prepended by AI
}

// Input for the generateNepraReport Genkit flow
export interface GenerateNepraReportInput {
  userProfile: UserProfile;
  questionnaireData: QuestionnaireDataForReport; // Contains questions and their detailed answers including scores
  sessionId: string;
  reportDate: string; // YYYY-MM-DD
  completedTime?: string; // ISO
}

// Output for the generateNepraReport Genkit flow
export interface GenerateNepraReportOutput {
  reportContent: string; // Markdown
}
