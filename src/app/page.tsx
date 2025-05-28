
'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import type {
  UserProfile,
  ComplianceSession,
  ResponseData,
  QuestionDefinition,
  ReportAnswerDetail,
  SessionProgress,
  GenerateNepraReportInput as AppGenerateNepraReportInput, // Use aliased import
  QuestionnaireDataForReport as AppQuestionnaireDataForReport, // Use aliased import
} from '@/lib/types';
import { tailorNepraQuestions, TailorNepraQuestionsInput } from '@/ai/flows/tailor-questions';
import type { TailoredQuestionsOutput } from '@/ai/flows/tailor-questions';
import { generateNepraReport } from '@/ai/flows/generate-report'; // Removed type import for output as it's handled by function return
import type { GenerateNepraReportOutput } from '@/ai/flows/generate-report';


import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import {
  saveUserProfileToStorage,
  loadUserProfileFromStorage,
  saveActiveSessionReference,
  loadActiveSessionReference,
  clearActiveSessionReference,
  generateSessionId,
} from '@/lib/storage';

import {
  isFirebaseInitialized,
  startNewComplianceSession,
  getComplianceSession,
  addResponseToSession,
  updateComplianceSession,
  uploadReportToStorage,
} from '@/lib/firebaseService';

// Lazy load components
const DepartmentRoleForm = React.lazy(() =>
  import('@/components/questionnaire/DepartmentRoleForm').then(module => ({ default: module.DepartmentRoleForm }))
);
const QuestionCard = React.lazy(() =>
  import('@/components/questionnaire/QuestionCard').then(module => ({ default: module.QuestionCard }))
);
const ReportDisplay = React.lazy(() =>
  import('@/components/report/ReportDisplay').then(module => ({ default: module.ReportDisplay }))
);

const DEFAULT_POLICY_SCORE = 5.0;
const DEFAULT_PRACTICE_SCORE = 5.0;


export default function NepraCompliancePage() {
  const [currentSession, setCurrentSession] = useState<ComplianceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);
  
  const { toast } = useToast();
  const appState = currentSession?.status || 'initial';

  const handleFetchQuestions = useCallback(async (sessionToUpdate: ComplianceSession, isNewSession: boolean): Promise<boolean> => {
    if (!sessionToUpdate.userProfile.department || !sessionToUpdate.userProfile.role) {
      setError("Department and Role are required to fetch questions.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
      setIsLoading(false);
      return false;
    }

    if (!isLoading) setIsLoading(true);
    setError(null); 
    const targetStatus = (appState === 'form' && isNewSession) ? 'form' : 'questionnaire';
    setCurrentSession(prev => prev ? { ...prev, status: targetStatus } : { ...sessionToUpdate, status: targetStatus });

    let fetchSuccess = false;
    try {
      const tailorInput: TailorNepraQuestionsInput = {
        department: sessionToUpdate.userProfile.department,
        role: sessionToUpdate.userProfile.role,
      };
      const result: TailoredQuestionsOutput = await tailorNepraQuestions(tailorInput);

      const fetchedQuestionTexts = result.questions || [];
      if (fetchedQuestionTexts.length === 0 || (fetchedQuestionTexts.length === 1 && fetchedQuestionTexts[0].startsWith("Error:"))) {
        let errorMessage = fetchedQuestionTexts[0] || 'No questions were returned for your department/role. Please try again or contact support.';
        if (errorMessage.toLowerCase().includes("overloaded") || errorMessage.toLowerCase().includes("service unavailable") || errorMessage.includes("503") || errorMessage.toLowerCase().includes("model is overloaded")) {
          errorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
        }
        setError(errorMessage);
        toast({ title: "Error Fetching Questions", description: errorMessage, variant: "destructive" });
        setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
        fetchSuccess = false;
      } else {
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`,
          questionText: qText, // AI now prepends hint to questionText
          category: "NEPRA Compliance", // Placeholder, AI might provide this in a more advanced setup
        }));

        const updatedSessionData: ComplianceSession = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses, // Preserve existing responses if resuming
          currentQuestionIndex: isNewSession ? 0 : Math.min(sessionToUpdate.currentQuestionIndex || 0, questionDefinitions.length -1), // Ensure index is valid
          status: 'questionnaire'
        };
        setCurrentSession(updatedSessionData);

        let dbOperationSuccessful = true;
        if (isNewSession) {
          try {
            await startNewComplianceSession(updatedSessionData);
          } catch (dbError: any) {
            const dbErrorMessage = `Failed to save new session to database: ${dbError.message}. Please check Firestore setup and security rules.`;
            setError(dbErrorMessage);
            toast({ title: "Database Error", description: `Could not start new session: ${dbError.message}`, variant: "destructive" });
            setCurrentSession(prev => {
              const userProf = (prev || updatedSessionData).userProfile;
              return { // Revert to form, generate NEW session ID if creation failed
                userProfile: userProf, 
                sessionId: generateSessionId(), 
                questions: [], responses: {}, currentQuestionIndex: 0,
                policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {}, // Reset these as they are legacy or per-question now
                startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
              };
            });
            dbOperationSuccessful = false;
          }
        } else { // Resuming session, update questions if they were re-fetched (e.g. if empty before)
          try {
             // Only update questions if they actually changed or were newly fetched
            if (JSON.stringify(updatedSessionData.questions) !== JSON.stringify(sessionToUpdate.questions)) {
                await updateComplianceSession(updatedSessionData.sessionId, { questions: questionDefinitions });
            }
          } catch (dbError: any) {
            setError(`Failed to update session questions in database: ${dbError.message}.`);
            toast({ title: "Database Error", description: `Could not update session questions: ${dbError.message}`, variant: "destructive" });
            dbOperationSuccessful = false;
          }
        }

        if (dbOperationSuccessful) {
          saveActiveSessionReference({
            sessionId: updatedSessionData.sessionId,
            userProfile: updatedSessionData.userProfile, // Save profile for quick prefill
            currentQuestionIndex: updatedSessionData.currentQuestionIndex,
          });
          setError(null);
          fetchSuccess = true;
        } else {
          fetchSuccess = false;
        }
      }
    } catch (e: any) {
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      if (e.message?.includes("FAILED_PRECONDITION") && (e.message?.includes("GEMINI_API_KEY") || e.message?.includes("GOOGLE_API_KEY"))) {
        userErrorMessage = "AI Configuration Error: The current AI provider (Google Gemini) is missing its API key. If you intend to use IBM Watsonx, ensure the Watsonx Genkit plugin is installed and configured in src/ai/genkit.ts, and .env variables are set.";
        toast({ title: "AI Configuration Error", description: "Google AI API key missing or Watsonx not configured. Check .env and src/ai/genkit.ts.", variant: "destructive", duration: 15000 });
      } else if (e.message?.includes("503") || e.message?.toLowerCase().includes("service unavailable") || e.message?.toLowerCase().includes("model is overloaded")) {
        userErrorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
        toast({ title: "AI Service Error", description: userErrorMessage, variant: "destructive" });
      }
      setError(userErrorMessage);
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
      fetchSuccess = false;
    } finally {
      if (fetchSuccess === false && !error) { // Ensure error state is set if fetch failed but no specific error was caught by handlers
          setError(prevError => prevError || "An unknown error occurred while fetching questions.");
      }
      setIsLoading(false);
    }
    return fetchSuccess;
  }, [toast, setIsLoading, setError, setCurrentSession, appState, isLoading]);


  const initializeOrResumeApp = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (!isFirebaseInitialized) {
      setError("CRITICAL: Firebase is not configured. Please ensure all NEXT_PUBLIC_FIREBASE_... environment variables are set correctly in your .env file. Application features relying on Firebase will not work.");
      setCurrentSession(prev => ({
        ...(prev || {
          sessionId: generateSessionId(),
          userProfile: loadUserProfileFromStorage() || { name: '', email: '', department: '', role: '' },
          questions: [], responses: {}, currentQuestionIndex: 0,
          policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
          startTime: new Date().toISOString(), reportGenerated: false
        }),
        status: 'error'
      }));
      setIsLoading(false);
      return;
    }

    const savedProfile = loadUserProfileFromStorage();
    setLastPersistedProfile(savedProfile);
    const activeSessionRef = loadActiveSessionReference();

    if (activeSessionRef?.sessionId) {
      try {
        const firestoreSession = await getComplianceSession(activeSessionRef.sessionId);
        if (firestoreSession) {
          if (firestoreSession.status === 'completed' || firestoreSession.reportGenerated) { // Assuming 'completed' status exists
            let reportContentToDisplay = "Previously generated report.";
            if (firestoreSession.reportUrl) {
              // For now, just show link. Report content is not stored in session.
              reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}`;
            }
            setGeneratedReportContent(reportContentToDisplay);
            setCurrentSession({ ...firestoreSession, status: 'report_ready' });
          } else {
            // Ensure currentQuestionIndex is valid and responses are loaded
            const numResponses = Object.keys(firestoreSession.responses || {}).length;
            let currentQuestionIndex = 0;
            if (firestoreSession.questions && firestoreSession.questions.length > 0) {
                 currentQuestionIndex = firestoreSession.currentQuestionIndex < firestoreSession.questions.length ? firestoreSession.currentQuestionIndex : Math.min(numResponses, firestoreSession.questions.length -1);
            }
            if (currentQuestionIndex < 0) currentQuestionIndex = 0;


            const updatedSession: ComplianceSession = {
              ...firestoreSession,
              currentQuestionIndex: currentQuestionIndex,
              // Legacy fields below, review their necessity
              policyAreasToRate: firestoreSession.policyAreasToRate || [], 
              currentRatingAreaIndex: firestoreSession.currentRatingAreaIndex || 0,
              policyScores: firestoreSession.policyScores || {}, 
              status: 'questionnaire' // Default to questionnaire, can adjust if all questions answered
            };
             setCurrentSession(updatedSession);

            // If questions are missing but profile exists, try to fetch them
            if ((!firestoreSession.questions || firestoreSession.questions.length === 0) && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
              const fetchSuccess = await handleFetchQuestions(updatedSession, false); // false because it's a resume
              if (!fetchSuccess) {
                // Revert to form if fetching questions failed on resume
                setCurrentSession({
                  sessionId: generateSessionId(),
                  userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                  questions: [], responses: {}, currentQuestionIndex: 0,
                  policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
                  startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
                });
              }
            } else if (!firestoreSession.questions || firestoreSession.questions.length === 0) {
                 // No questions and no profile info to fetch them, go to form
                setCurrentSession({
                  sessionId: generateSessionId(),
                  userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                  questions: [], responses: {}, currentQuestionIndex: 0,
                  policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
                  startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
                });
            }
          }
        } else { // No session found in Firestore for the stored ID
            clearActiveSessionReference();
            setCurrentSession({
                sessionId: generateSessionId(),
                userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                questions: [], responses: {}, currentQuestionIndex: 0,
                policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
                startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
            });
        }
      } catch (e: any) {
        setError(`Failed to resume session: ${e.message}. Starting fresh. Ensure Firebase is configured, and check security rules.`);
        toast({ title: "Session Resume Error", description: `Could not resume: ${e.message}`, variant: "destructive" });
        clearActiveSessionReference();
        setCurrentSession({
          sessionId: generateSessionId(),
          userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
          questions: [], responses: {}, currentQuestionIndex: 0,
          policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
          startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
        });
      }
    } else { // No active session reference in local storage
      setCurrentSession({
        sessionId: generateSessionId(),
        userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
        questions: [], responses: {}, currentQuestionIndex: 0,
        policyAreasToRate: [], currentRatingAreaIndex: 0, policyScores: {},
        startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
      });
    }
    setIsLoading(false);
  }, [toast, handleFetchQuestions, setIsLoading, setError, setCurrentSession, setLastPersistedProfile]);

  useEffect(() => {
    initializeOrResumeApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializeOrResumeApp]);


  const handleDepartmentRoleSubmit = useCallback(async (profile: UserProfile) => {
    if (!isFirebaseInitialized) {
      setError("Application not initialized. Cannot submit. Please ensure Firebase is configured.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    saveUserProfileToStorage(profile);
    setLastPersistedProfile(profile);

    const newSessionId = generateSessionId();
    const initialSession: ComplianceSession = {
      sessionId: newSessionId,
      userProfile: profile,
      questions: [],
      responses: {},
      currentQuestionIndex: 0,
      policyAreasToRate: [], // Legacy, review
      currentRatingAreaIndex: 0, // Legacy, review
      policyScores: {}, // Legacy, review
      startTime: new Date().toISOString(),
      reportGenerated: false,
      status: 'form', // Will transition to 'questionnaire' after fetch
    };
    setCurrentSession(initialSession);

    const success = await handleFetchQuestions(initialSession, true);
    if (!success) {
        if (isLoading) setIsLoading(false); // Ensure isLoading is reset if fetch failed
        // Error handling already done in handleFetchQuestions
    }
  }, [handleFetchQuestions, setIsLoading, setError, setCurrentSession, setLastPersistedProfile, isLoading]);

  // Handlers for QuestionCard's new props
  const handleAnswerTextChange = (text: string) => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0 || currentSession.status !== 'questionnaire') return;
    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];
    if (!questionDef) return;

    setCurrentSession(prev => {
      if (!prev) return null;
      const existingResponse = prev.responses[questionDef.id] || {
        questionId: questionDef.id,
        questionText: questionDef.questionText,
        policyMaturityScore: DEFAULT_POLICY_SCORE,
        practiceMaturityScore: DEFAULT_PRACTICE_SCORE,
        timestamp: new Date().toISOString(),
      };
      return {
        ...prev,
        responses: {
          ...prev.responses,
          [questionDef.id]: { ...existingResponse, answerText: text, timestamp: new Date().toISOString() }
        }
      };
    });
  };

  const handlePolicyScoreChange = (score: number) => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0 || currentSession.status !== 'questionnaire') return;
    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];
    if (!questionDef) return;

    setCurrentSession(prev => {
      if (!prev) return null;
      const existingResponse = prev.responses[questionDef.id] || {
        questionId: questionDef.id,
        questionText: questionDef.questionText,
        answerText: '',
        practiceMaturityScore: DEFAULT_PRACTICE_SCORE,
        timestamp: new Date().toISOString(),
      };
      return {
        ...prev,
        responses: {
          ...prev.responses,
          [questionDef.id]: { ...existingResponse, policyMaturityScore: score, timestamp: new Date().toISOString() }
        }
      };
    });
  };

  const handlePracticeScoreChange = (score: number) => {
     if (!currentSession || !currentSession.questions || currentSession.questions.length === 0 || currentSession.status !== 'questionnaire') return;
    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];
    if (!questionDef) return;

    setCurrentSession(prev => {
      if (!prev) return null;
      const existingResponse = prev.responses[questionDef.id] || {
        questionId: questionDef.id,
        questionText: questionDef.questionText,
        answerText: '',
        policyMaturityScore: DEFAULT_POLICY_SCORE,
        timestamp: new Date().toISOString(),
      };
      return {
        ...prev,
        responses: {
          ...prev.responses,
          [questionDef.id]: { ...existingResponse, practiceMaturityScore: score, timestamp: new Date().toISOString() }
        }
      };
    });
  };


  const saveCurrentProgress = useCallback(async () => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0 || currentSession.status !== 'questionnaire') {
      toast({ title: "Save Error", description: "No active session or questions to save.", variant: "destructive" });
      return;
    }

    const qIndex = currentSession.currentQuestionIndex;
    if (qIndex < 0 || qIndex >= currentSession.questions.length) return;

    const questionDef = currentSession.questions[qIndex];
    if (!questionDef) return;

    const currentResponse = currentSession.responses[questionDef.id];

    if (currentResponse && currentResponse.answerText) { // Only save if there's an answer text
      setIsLoading(true);
      try {
        // Ensure all fields for ResponseData are present before saving
        const responseToSave: ResponseData = {
            questionId: currentResponse.questionId,
            questionText: currentResponse.questionText,
            answerText: currentResponse.answerText,
            policyMaturityScore: currentResponse.policyMaturityScore !== undefined ? currentResponse.policyMaturityScore : DEFAULT_POLICY_SCORE,
            practiceMaturityScore: currentResponse.practiceMaturityScore !== undefined ? currentResponse.practiceMaturityScore : DEFAULT_PRACTICE_SCORE,
            timestamp: currentResponse.timestamp || new Date().toISOString(),
            nepraCategory: questionDef.category, // Or from response if available
            riskLevel: currentResponse.riskLevel || 'not_assessed',
        };

        await addResponseToSession(currentSession.sessionId, responseToSave);
        saveActiveSessionReference({ // Save current index to local storage
          sessionId: currentSession.sessionId,
          userProfile: currentSession.userProfile,
          currentQuestionIndex: currentSession.currentQuestionIndex,
        });
        // Main session document currentQuestionIndex also needs update
        await updateComplianceSession(currentSession.sessionId, {
          currentQuestionIndex: currentSession.currentQuestionIndex,
        });
        toast({
          title: "Progress Saved",
          description: "Your current answer and scores have been saved.",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } catch (fsError: any) {
        toast({ title: "Sync Error", description: `Could not save progress to cloud: ${fsError.message}. Check Firebase setup and rules.`, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    } else {
      toast({ title: "Nothing to Save", description: "Please provide an answer before saving.", variant: "default" });
    }
  }, [currentSession, toast, setIsLoading]);


  const handleNextQuestion = useCallback(async () => {
    if (!currentSession || currentSession.status !== 'questionnaire' || currentSession.questions.length === 0) return;
    
    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];
    const currentResponse = currentSession.responses[questionDef.id];

    if (!currentResponse || !currentResponse.answerText) {
        toast({title: "Incomplete Answer", description: "Please provide an answer before proceeding.", variant: "destructive"});
        return;
    }
    // policy/practice scores have defaults, so main validation is on answerText

    setIsLoading(true);
    try {
      await saveCurrentProgress(); // Save the current question's state first
      
      const nextIndex = currentSession.currentQuestionIndex + 1;
      if (nextIndex < currentSession.questions.length) {
        setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: nextIndex } : null);
      } else { // All questions answered
        setCurrentSession(prev => prev ? { ...prev, status: 'generating_report' } : null);
        // Automatically call handleSubmitAndGenerateReport after state update
        // This ensures the status is 'generating_report' before the AI call
      }
    } catch (error) {
       // Error during saveCurrentProgress is handled within it (toast)
       // but ensure loading state is reset if it hangs or throws an unhandled one
       toast({ title: "Navigation Error", description: "Could not proceed to next question.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [currentSession, saveCurrentProgress, toast, setIsLoading, setCurrentSession]);

  // Effect to trigger report generation when status changes to 'generating_report'
  useEffect(() => {
    if (currentSession?.status === 'generating_report') {
      handleSubmitAndGenerateReport();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.status]);


  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.status !== 'questionnaire' || currentSession.currentQuestionIndex <= 0) return;
    // Consider saving progress before going back, or decide if changes to current q are lost
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };


  const handleSubmitAndGenerateReport = useCallback(async () => {
    if (!currentSession || !currentSession.userProfile || currentSession.status !== 'generating_report') {
      // If status isn't generating_report, it means this was called prematurely or from wrong state
      if (currentSession && currentSession.status !== 'generating_report') {
          setCurrentSession(prev => prev ? { ...prev, status: 'generating_report'} : null); // Trigger it correctly
          return; // useEffect will pick it up
      }
      setError("Session data or user profile is not available. Please fill out the form again.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : null);
      setIsLoading(false);
      return;
    }
    
    // Ensure all progress is saved one last time before generating report
    // This is especially important if the user clicks "Submit All" from the last question
    // without explicitly clicking "Next" on it.
    if (currentSession.questions.length > 0 && 
        currentSession.currentQuestionIndex === currentSession.questions.length -1) {
        await saveCurrentProgress();
    }


    setIsLoading(true);
    setError(null);

    try {
      const reportAnswers: Record<string, ReportAnswerDetail> = {};
      let totalPolicyScore = 0;
      let totalPracticeScore = 0;
      let answeredQuestionsCount = 0;

      currentSession.questions.forEach((qDef) => {
        const response = currentSession.responses[qDef.id];
        if (response && response.answerText) { // Only include answered questions in averages
          reportAnswers[qDef.id] = {
            question: qDef.questionText,
            answerText: response.answerText,
            policyMaturityScore: response.policyMaturityScore,
            practiceMaturityScore: response.practiceMaturityScore,
            timestamp: response.timestamp,
            nepraCategory: response.nepraCategory || qDef.category,
          };
          totalPolicyScore += response.policyMaturityScore;
          totalPracticeScore += response.practiceMaturityScore;
          answeredQuestionsCount++;
        } else { // Handle unanswered questions in the report
            reportAnswers[qDef.id] = {
                question: qDef.questionText,
                answerText: "[No answer provided]",
                policyMaturityScore: 0, // Or some indicator for N/A
                practiceMaturityScore: 0, // Or some indicator for N/A
                timestamp: new Date().toISOString(), // Placeholder timestamp
                nepraCategory: qDef.category,
            };
        }
      });

      const averagePolicyMaturity = answeredQuestionsCount > 0 ? parseFloat((totalPolicyScore / answeredQuestionsCount).toFixed(1)) : 0;
      const averagePracticeMaturity = answeredQuestionsCount > 0 ? parseFloat((totalPracticeScore / answeredQuestionsCount).toFixed(1)) : 0;

      const questionnaireDataForReport: AppQuestionnaireDataForReport = {
        questions: currentSession.questions, // Pass QuestionDefinition[]
        answers: reportAnswers,
        averagePolicyMaturity: averagePolicyMaturity,
        averagePracticeMaturity: averagePracticeMaturity,
      };
      
      const reportInput: AppGenerateNepraReportInput = {
        userProfile: currentSession.userProfile,
        questionnaireData: questionnaireDataForReport,
        sessionId: currentSession.sessionId,
        reportDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD format
        completedTime: new Date().toISOString(),
      };

      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      setGeneratedReportContent(result.reportContent);

      const completedTime = new Date().toISOString();
      let reportStorageUrl = '';
      if (result.reportContent && result.reportContent !== "Error: Failed to generate report content. The AI service might be temporarily unavailable or unable to process the request. Please try again.") {
        try {
          reportStorageUrl = await uploadReportToStorage(currentSession.sessionId, result.reportContent, `compliance_report_${currentSession.sessionId}.md`);
          toast({ title: "Report Uploaded", description: "Compliance report saved to secure storage." });
        } catch (storageError: any) {
          toast({ title: "Storage Error", description: `Could not upload report: ${storageError.message}. It is available locally.`, variant: "destructive" });
        }
      }

      const updatedSessionOnComplete: Partial<ComplianceSession> = {
        reportGenerated: true,
        completedTime: completedTime,
        reportUrl: reportStorageUrl || undefined,
        status: 'report_ready',
      };
      setCurrentSession(prev => prev ? { ...prev, ...updatedSessionOnComplete, status: 'report_ready' } as ComplianceSession : null);
      await updateComplianceSession(currentSession.sessionId, updatedSessionOnComplete);
      clearActiveSessionReference(); 

    } catch (e: any) {
      setError(`Failed to generate or finalize report: ${e.message}.`);
      toast({ title: "Report Finalization Failed", description: `Could not complete the report process: ${e.message}`, variant: "destructive" });
      setCurrentSession(prev => prev ? { ...prev, status: 'questionnaire' } : null); // Revert to questionnaire on failure
    } finally {
      setIsLoading(false);
    }
  }, [currentSession, toast, setIsLoading, setError, setCurrentSession, saveCurrentProgress]);


  const handleStartNew = useCallback(() => {
    clearActiveSessionReference();
    setCurrentSession(null); 
    setGeneratedReportContent(null);
    setError(null);
    setIsLoading(true); 
    // initializeOrResumeApp will be called by useEffect due to currentSession becoming null
  }, [setIsLoading, setError, setCurrentSession, setGeneratedReportContent]);
  
  const showInitialSpinner = appState === 'initial' || (isLoading && !error && (!currentSession || (currentSession.questions.length === 0 && appState === 'questionnaire')));

  if (isLoading && (appState === 'initial' || (appState === 'form' && !currentSession?.userProfile.department))) { // More specific initial loading
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }
  if (showInitialSpinner && !isFirebaseInitialized && typeof window !== 'undefined') {
      // This case is handled by the main error display block if isFirebaseInitialized is false
  } else if (showInitialSpinner) {
    return <LoadingSpinner text={appState === 'initial' ? "Initializing Compliance Agent..." : "Loading Session & Questions..."} className="mt-20" />;
  }

  const renderSuspenseFallback = (text: string) => <LoadingSpinner text={text} className="mt-20" />;

  // Get current question data
  const currentQDef = currentSession?.questions[currentSession.currentQuestionIndex];
  const currentQResponse = currentQDef ? currentSession?.responses[currentQDef.id] : undefined;

  return (
    <div className="space-y-8 pb-16"> {/* Added padding bottom */}
      {error && (appState === 'error' || !isFirebaseInitialized) && (
        <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{!isFirebaseInitialized ? "Application Initialization Error" : "Error"}</AlertTitle>
          <AlertDescription>
            {error}
            {appState === 'error' && isFirebaseInitialized && <Button onClick={handleStartNew} variant="outline" className="mt-4">Try to Reset and Start New</Button>}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && appState !== 'initial' && appState !=='error' && !showInitialSpinner && (
        <LoadingSpinner 
          text={
            appState === 'generating_report' ? "Finalizing Report..." :
            (appState === 'questionnaire' && isLoading) ? "Saving / Loading Next Question..." : // More specific for questionnaire loading
            "Processing..."
          } 
          className="mt-20" />
      )}
      
      <Suspense fallback={renderSuspenseFallback("Loading User Information Form...")}>
        {!isLoading && isFirebaseInitialized && appState === 'form' && !error && currentSession && (
          <DepartmentRoleForm
            onSubmit={handleDepartmentRoleSubmit}
            initialProfile={currentSession.userProfile || lastPersistedProfile}
            isLoading={isLoading} />
        )}
      </Suspense>

      {error && appState !== 'error' && isFirebaseInitialized && !isLoading && (
        <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Encountered</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <Suspense fallback={renderSuspenseFallback("Loading Questionnaire...")}>
        {!isLoading && isFirebaseInitialized && appState === 'questionnaire' && currentSession && currentSession.questions && currentSession.questions.length > 0 && currentQDef && (
          <QuestionCard
            question={currentQDef.questionText || "Loading question..."}
            questionNumber={currentSession.currentQuestionIndex + 1}
            totalQuestions={currentSession.questions.length}
            
            answerText={currentQResponse?.answerText || ''}
            onAnswerTextChange={handleAnswerTextChange}
            
            policyMaturityScore={currentQResponse?.policyMaturityScore !== undefined ? currentQResponse.policyMaturityScore : DEFAULT_POLICY_SCORE}
            onPolicyMaturityScoreChange={handlePolicyScoreChange}
            
            practiceMaturityScore={currentQResponse?.practiceMaturityScore !== undefined ? currentQResponse.practiceMaturityScore : DEFAULT_PRACTICE_SCORE}
            onPracticeMaturityScoreChange={handlePracticeScoreChange}
            
            onNext={handleNextQuestion}
            onPrevious={handlePreviousQuestion}
            onSaveProgress={saveCurrentProgress}
            onSubmitAll={() => setCurrentSession(prev => prev ? {...prev, status: 'generating_report'} : null) } // Transition to generating_report
            
            isFirstQuestion={currentSession.currentQuestionIndex === 0}
            isLastQuestion={currentSession.currentQuestionIndex === currentSession.questions.length - 1}
            isLoading={isLoading}
          />
        )}
      </Suspense>
      
      <Suspense fallback={renderSuspenseFallback("Loading Report...")}>
        {!isLoading && isFirebaseInitialized && appState === 'report_ready' && generatedReportContent && (
          <ReportDisplay
            report={generatedReportContent}
            onStartNew={handleStartNew}
            reportUrl={currentSession?.reportUrl}
          />
        )}
      </Suspense>

      {!isLoading && isFirebaseInitialized && appState === 'report_ready' && !generatedReportContent && (
        <Alert variant="default" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Report Status</AlertTitle>
          <AlertDescription>
            The questionnaire is complete.
            {currentSession?.reportUrl
              ? <>Report was generated and <a href={currentSession.reportUrl} target="_blank" rel="noopener noreferrer" className="underline text-primary hover:text-primary/80">can be accessed here</a>.</>
              : "Report content is not currently displayed. You can start a new questionnaire."
            }
            <Button onClick={handleStartNew} variant="outline" className="mt-4 ml-2">Start New Questionnaire</Button>
          </AlertDescription>
        </Alert>
      )}

      {(appState !== 'initial' && appState !== 'generating_report' && !(appState === 'error' && !isFirebaseInitialized) && !isLoading && (currentSession && currentSession.status !== 'report_ready')) && (
        <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
