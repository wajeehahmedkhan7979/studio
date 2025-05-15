
export interface UserProfile {
  name: string;
  email: string;
  linkedin?: string; // Optional LinkedIn URL
  department: string;
  role: string;
}

export interface Answer {
  question: string; // Store the question text itself as ID might not be stable
  answerText: string;
}

export interface QuestionnaireData {
  profile: UserProfile | null;
  questions: string[];
  answers: Record<number, string>; // Index of question to answer string
  currentQuestionIndex: number;
}
