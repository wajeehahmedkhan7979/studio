
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
  questionText: string;
  category: string; // e.g., Access Control, Incident Response // Main NEPRA category or AI-inferred
  // Example: "🛈 NEPRA Section 4.3 requires documenting incident response procedures. How does your team document these?"
  // The hint is now part of questionText
  // hint?: string; // Brief NEPRA context or explanation for the question
}

// Structure for a single response within a session
export interface ResponseData {
  questionId: string; // Corresponds to QuestionDefinition.id
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
  policyAreasToRate: string[]; // Key policy areas for rating
  currentRatingAreaIndex: number; // Index for the 'policyAreasToRate' array
  policyScores: Record<string, number>; // policyAreaName maps to rating score (0.0-10.0)
  startTime: string; // ISO string format for session start
  lastSavedTime?: string; // ISO string format for last save/resume
  completedTime?: string; // ISO string format for when questionnaire was completed
  status: 'initial' | 'form' | 'questionnaire' | 'collecting_ratings' | 'generating_report' | 'report_ready' | 'error';
  reportGenerated: boolean;
  reportUrl?: string; // URL if report is stored (e.g., Firebase Storage)
}


// Minimal structure for saving progress in local storage
export interface SessionProgress {
  sessionId?: string;
  userProfile?: UserProfile;
  currentQuestionIndex?: number;
  currentRatingAreaIndex?: number; // To resume rating at the correct point
  policyScores?: Record<string, number>; // To store partially collected ratings
}


// Input for the generateNepraReport Genkit flow
export interface ReportGenerationInput {
  session: ComplianceSession; // Contains userProfile, and all questions/responses
}

// Output for the tailorNepraQuestions Genkit flow
export interface TailoredQuestionsOutput {
  questions: string[]; // List of question texts, potentially with hints prepended
}

// For the report generation, aligning with current flow structure
// but using more detailed ResponseData
export interface QuestionnaireDataForReport {
  questions: string[]; // The original question texts in order
  // Answers map index (as string) to the detailed ReportAnswerDetail object
  answers: Record<string, ReportAnswerDetail>;
}

// Adapting NepraAnswer for clarity, to be used by report generator
export type ReportAnswerDetail = {
  question: string;
  answerText: string;
  timestamp: string;
  nepraCategory?: string;
};
