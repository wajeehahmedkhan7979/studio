
'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import type {
  UserProfile,
  ComplianceSession,
  ResponseData,
  QuestionDefinition,
  GenerateNepraReportInput as AppGenerateNepraReportInput,
  QuestionnaireDataForReport as AppQuestionnaireDataForReport,
} from '@/lib/types';
import { tailorNepraQuestions, TailorNepraQuestionsInput } from '@/ai/flows/tailor-questions';
import type { TailoredQuestionsOutput } from '@/ai/flows/tailor-questions';
import { generateNepraReport } from '@/ai/flows/generate-report';
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
  const [isLoading, setIsLoading] = useState(true); // Initialize to true for initial setup
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);

  const { toast } = useToast();
  const appState = currentSession?.status || 'initial';


  const handleFetchQuestions = useCallback(async (sessionToUpdate: ComplianceSession, isNewSession: boolean): Promise<boolean> => {
    let fetchSuccess = false;
    let dbOperationSuccessful = true;
    const targetStatusOnError: ComplianceSession['status'] = 'form';
    const targetStatusOnSuccess: ComplianceSession['status'] = 'questionnaire';

    // Optimistically update session status for UI responsiveness
    setCurrentSession(prev => {
        if (!prev && !sessionToUpdate) return null;
        const baseSession = prev || sessionToUpdate;
        return { ...baseSession, status: targetStatusOnSuccess };
    });

    try {
      if (!sessionToUpdate.userProfile.department || !sessionToUpdate.userProfile.role) {
        setError("Department and Role are required to fetch questions.");
        setCurrentSession(prev => prev ? { ...prev, status: targetStatusOnError } : { ...sessionToUpdate, status: targetStatusOnError });
        return false;
      }
      setError(null);

      const tailorInput: TailorNepraQuestionsInput = {
        department: sessionToUpdate.userProfile.department,
        role: sessionToUpdate.userProfile.role,
      };
      const result: TailoredQuestionsOutput = await tailorNepraQuestions(tailorInput);
      
      let fetchedQuestionTexts = result.questions || [];
      // Filter out any empty strings or strings that are only whitespace
      fetchedQuestionTexts = fetchedQuestionTexts.filter(q => q && q.trim() !== "");


      if (fetchedQuestionTexts.length === 0 || (fetchedQuestionTexts.length === 1 && fetchedQuestionTexts[0].startsWith("Error:"))) {
        let errorMessage = fetchedQuestionTexts[0] || 'No questions were returned for your department/role. Please try again or contact support.';
        if (errorMessage.toLowerCase().includes("overloaded") || errorMessage.toLowerCase().includes("service unavailable") || errorMessage.includes("503") || errorMessage.toLowerCase().includes("model is overloaded")) {
          errorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
        }
        setError(errorMessage);
        toast({ title: "Error Fetching Questions", description: errorMessage, variant: "destructive" });
        setCurrentSession(prev => prev ? { ...prev, status: targetStatusOnError } : { ...sessionToUpdate, status: targetStatusOnError });
        dbOperationSuccessful = false;
      } else {
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`,
          questionText: qText,
          category: "NEPRA Compliance",
        }));

        const updatedSessionDataWithQuestions: ComplianceSession = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses,
          currentQuestionIndex: isNewSession ? 0 : Math.min(sessionToUpdate.currentQuestionIndex || 0, questionDefinitions.length - 1),
          status: targetStatusOnSuccess
        };
        setCurrentSession(updatedSessionDataWithQuestions);

        if (isNewSession) {
          try {
            await startNewComplianceSession(updatedSessionDataWithQuestions);
            dbOperationSuccessful = true;
          } catch (dbError: any) {
            const dbErrorMessage = `Firebase error creating session: ${dbError.message}. Please check Firestore setup and security rules.`;
            setError(dbErrorMessage);
            toast({ title: "Database Error", description: `Could not start new session: ${dbError.message}`, variant: "destructive" });
            setCurrentSession(prev => {
              const userProf = (prev || updatedSessionDataWithQuestions).userProfile;
              return {
                userProfile: userProf,
                sessionId: generateSessionId(), // Generate a new ID for a fresh attempt
                questions: [], responses: {}, currentQuestionIndex: 0,
                startTime: new Date().toISOString(), reportGenerated: false, status: targetStatusOnError,
              };
            });
            dbOperationSuccessful = false;
          }
        } else {
          try {
            if (JSON.stringify(updatedSessionDataWithQuestions.questions) !== JSON.stringify(sessionToUpdate.questions)) {
              await updateComplianceSession(updatedSessionDataWithQuestions.sessionId, { questions: questionDefinitions });
            }
            dbOperationSuccessful = true;
          } catch (dbError: any) {
            setError(`Failed to update session questions in database: ${dbError.message}.`);
            toast({ title: "Database Error", description: `Could not update session questions: ${dbError.message}`, variant: "destructive" });
            dbOperationSuccessful = false;
          }
        }
      }

      if (dbOperationSuccessful) {
        saveActiveSessionReference({
          sessionId: (currentSession || sessionToUpdate).sessionId,
          userProfile: (currentSession || sessionToUpdate).userProfile,
          currentQuestionIndex: (currentSession || sessionToUpdate).currentQuestionIndex,
        });
        setError(null);
        fetchSuccess = true;
      } else {
        fetchSuccess = false;
        // Ensure status is 'form' if any critical DB or AI op failed
        setCurrentSession(prev => {
            if (!prev) return null;
            const userProf = prev.userProfile;
            if (isNewSession) { // If it was a new session attempt that failed
                return {
                    userProfile: userProf,
                    sessionId: generateSessionId(),
                    questions: [], responses: {}, currentQuestionIndex: 0,
                    startTime: new Date().toISOString(), reportGenerated: false, status: targetStatusOnError,
                };
            } else { // If it was a resume attempt and updating questions failed
                return { ...prev, status: targetStatusOnError, questions: [] };
            }
        });
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
      setCurrentSession(prev => prev ? { ...prev, status: targetStatusOnError } : { ...sessionToUpdate, status: targetStatusOnError });
      fetchSuccess = false;
    } finally {
      setIsLoading(false);
    }
    return fetchSuccess;
  }, [toast, setCurrentSession, setError, setIsLoading]);


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
          startTime: new Date().toISOString(), reportGenerated: false,
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
          if (firestoreSession.status === 'completed' || firestoreSession.reportGenerated) {
            let reportContentToDisplay = "Previously generated report.";
            if (firestoreSession.reportUrl) {
              reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}`;
            }
            setGeneratedReportContent(reportContentToDisplay);
            setCurrentSession({ ...firestoreSession, status: 'report_ready' });
          } else {
            const numResponses = Object.keys(firestoreSession.responses || {}).length;
            let currentQuestionIndex = 0;
            if (firestoreSession.questions && firestoreSession.questions.length > 0) {
              currentQuestionIndex = firestoreSession.currentQuestionIndex < firestoreSession.questions.length ? firestoreSession.currentQuestionIndex : Math.min(numResponses, firestoreSession.questions.length - 1);
              if (currentQuestionIndex < 0) currentQuestionIndex = 0; // Ensure non-negative index
            }


            const updatedSession: ComplianceSession = {
              ...firestoreSession,
              currentQuestionIndex: currentQuestionIndex,
              status: 'questionnaire' // Default to questionnaire if session is valid
            };
            setCurrentSession(updatedSession);

            if ((!firestoreSession.questions || firestoreSession.questions.length === 0) && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
              const fetchSuccess = await handleFetchQuestions(updatedSession, false);
              if (!fetchSuccess) {
                 // handleFetchQuestions manages isLoading and reverts to 'form' on critical failure
              }
            } else if (!firestoreSession.questions || firestoreSession.questions.length === 0) {
              setCurrentSession({
                sessionId: generateSessionId(), // New session if old one had no questions
                userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                questions: [], responses: {}, currentQuestionIndex: 0,
                startTime: new Date().toISOString(), reportGenerated: false, status: 'form',
              });
            }
          }
        } else {
          // No session found in Firestore for the ID in local storage
          clearActiveSessionReference();
          setCurrentSession({
            sessionId: generateSessionId(),
            userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
            questions: [], responses: {}, currentQuestionIndex: 0,
            startTime: new Date().toISOString(), reportGenerated: false, status: 'form',
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
          startTime: new Date().toISOString(), reportGenerated: false, status: 'form',
        });
      }
    } else { // No active session reference in local storage
      setCurrentSession({
        sessionId: generateSessionId(),
        userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
        questions: [], responses: {}, currentQuestionIndex: 0,
        startTime: new Date().toISOString(), reportGenerated: false, status: 'form',
      });
    }
     if(isLoading) setIsLoading(false); // Ensure isLoading is false if not handled by nested calls
  }, [toast, handleFetchQuestions, setIsLoading, setError, setCurrentSession, setLastPersistedProfile]);

  useEffect(() => {
    initializeOrResumeApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initializeOrResumeApp]);


  const handleDepartmentRoleSubmit = useCallback(async (profile: UserProfile) => {
    if (!isFirebaseInitialized) {
      setError("Application not initialized. Cannot submit. Please ensure Firebase is configured.");
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
      startTime: new Date().toISOString(),
      reportGenerated: false,
      status: 'form',
    };
    setCurrentSession(initialSession);

    const success = await handleFetchQuestions(initialSession, true);
    if (!success) {
        // Error handling (toast, setError, reverting to form) is done within handleFetchQuestions
        // isLoading is also reset within handleFetchQuestions' finally block.
    }
    // If successful, isLoading is reset by handleFetchQuestions' finally block
    // and app state will be 'questionnaire'.
  }, [handleFetchQuestions, setIsLoading, setError, setCurrentSession, setLastPersistedProfile]);


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

    if (currentResponse && currentResponse.answerText) {
      setIsLoading(true);
      try {
        const responseToSave: ResponseData = {
            questionId: currentResponse.questionId,
            questionText: currentResponse.questionText,
            answerText: currentResponse.answerText,
            policyMaturityScore: currentResponse.policyMaturityScore !== undefined ? currentResponse.policyMaturityScore : DEFAULT_POLICY_SCORE,
            practiceMaturityScore: currentResponse.practiceMaturityScore !== undefined ? currentResponse.practiceMaturityScore : DEFAULT_PRACTICE_SCORE,
            timestamp: currentResponse.timestamp || new Date().toISOString(),
            nepraCategory: questionDef.category, // Use category from QuestionDefinition
        };

        await addResponseToSession(currentSession.sessionId, responseToSave);
        saveActiveSessionReference({
          sessionId: currentSession.sessionId,
          userProfile: currentSession.userProfile,
          currentQuestionIndex: currentSession.currentQuestionIndex,
        });
        await updateComplianceSession(currentSession.sessionId, {
          currentQuestionIndex: currentSession.currentQuestionIndex,
          responses: { [responseToSave.questionId]: responseToSave } // Send only the current response for update
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

    setIsLoading(true);
    try {
      await saveCurrentProgress(); // saveCurrentProgress now handles its own isLoading for the save part
      const nextIndex = currentSession.currentQuestionIndex + 1;
      if (nextIndex < currentSession.questions.length) {
        setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: nextIndex } : null);
      } else {
        setCurrentSession(prev => prev ? { ...prev, status: 'generating_report' } : null);
      }
    } catch (error) { // This catch is for errors during saveCurrentProgress or state updates
       toast({ title: "Navigation Error", description: "Could not proceed to next question.", variant: "destructive" });
    } finally {
      setIsLoading(false); // This ensures isLoading is false after navigation logic
    }
  }, [currentSession, saveCurrentProgress, toast, setIsLoading, setCurrentSession]);


  const handleSubmitAndGenerateReport = useCallback(async () => {
    if (!currentSession || !currentSession.userProfile || currentSession.status !== 'generating_report') {
      if (currentSession && currentSession.status !== 'generating_report') {
          setCurrentSession(prev => prev ? { ...prev, status: 'generating_report'} : null);
          return; // Let the useEffect trigger the actual generation
      }
      setError("Session data or user profile is not available. Please fill out the form again.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Ensure the very last question's state is saved before generating report
      if (currentSession.questions.length > 0) {
          const lastQIndex = currentSession.questions.length - 1;
          const lastQDef = currentSession.questions[lastQIndex];
          if (currentSession.currentQuestionIndex === lastQIndex &&
              currentSession.responses[lastQDef.id]?.answerText) {
            await saveCurrentProgress();
          }
      }

      const reportAnswers: Record<string, ReportAnswerDetail> = {};
      let totalPolicyScore = 0;
      let totalPracticeScore = 0;
      let answeredQuestionsCount = 0;

      currentSession.questions.forEach((qDef) => {
        const response = currentSession.responses[qDef.id];
        if (response && response.answerText) {
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
        } else { // Include unanswered questions in the report
            reportAnswers[qDef.id] = {
                question: qDef.questionText,
                answerText: "[No answer provided]",
                policyMaturityScore: 0, // Or some other indicator for unanswered
                practiceMaturityScore: 0,
                timestamp: new Date().toISOString(), // Placeholder timestamp
                nepraCategory: qDef.category,
            };
        }
      });

      const averagePolicyMaturity = answeredQuestionsCount > 0 ? parseFloat((totalPolicyScore / answeredQuestionsCount).toFixed(1)) : 0;
      const averagePracticeMaturity = answeredQuestionsCount > 0 ? parseFloat((totalPracticeScore / answeredQuestionsCount).toFixed(1)) : 0;

      const questionnaireDataForReport: AppQuestionnaireDataForReport = {
        questions: currentSession.questions, // Send all original questions
        answers: reportAnswers, // Send all (answered or marked as unanswered)
        averagePolicyMaturity: averagePolicyMaturity,
        averagePracticeMaturity: averagePracticeMaturity,
      };

      const reportInput: AppGenerateNepraReportInput = {
        userProfile: currentSession.userProfile,
        questionnaireData: questionnaireDataForReport,
        sessionId: currentSession.sessionId,
        reportDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
        completedTime: new Date().toISOString(),
      };

      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      setGeneratedReportContent(result.reportContent);

      const completedTime = new Date().toISOString();
      let reportStorageUrl = '';
      if (result.reportContent && !result.reportContent.startsWith("Error:")) {
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
        reportUrl: reportStorageUrl || undefined, // Use empty string if no URL
        status: 'report_ready',
        averagePolicyMaturity: averagePolicyMaturity,
        averagePracticeMaturity: averagePracticeMaturity,
      };
      setCurrentSession(prev => prev ? { ...prev, ...updatedSessionOnComplete, status: 'report_ready' } as ComplianceSession : null);
      await updateComplianceSession(currentSession.sessionId, updatedSessionOnComplete);
      clearActiveSessionReference();

    } catch (e: any) {
      setError(`Failed to generate or finalize report: ${e.message}.`);
      toast({ title: "Report Finalization Failed", description: `Could not complete the report process: ${e.message}`, variant: "destructive" });
      setCurrentSession(prev => prev ? { ...prev, status: 'questionnaire' } : null);
    } finally {
      setIsLoading(false);
    }
  }, [currentSession, toast, setIsLoading, setError, setCurrentSession, saveCurrentProgress]);

  useEffect(() => {
    if (currentSession?.status === 'generating_report') {
      handleSubmitAndGenerateReport();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.status, handleSubmitAndGenerateReport]);


  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.status !== 'questionnaire' || currentSession.currentQuestionIndex <= 0) return;
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  const handleStartNew = useCallback(() => {
    setIsLoading(true); // Set loading true, initializeOrResumeApp will take over
    clearActiveSessionReference();
    setCurrentSession(null); // This will trigger useEffect for initializeOrResumeApp
    setGeneratedReportContent(null);
    setError(null);
    // initializeOrResumeApp will eventually set isLoading to false
  }, [setIsLoading, setError, setCurrentSession, setGeneratedReportContent]);

  const showInitialSpinner = appState === 'initial' || (isLoading && !currentSession?.questions?.length && appState !== 'error' && !error);


  if (appState === 'error' && !isFirebaseInitialized) {
    return (
        <div className="space-y-8 pb-16">
            <Alert variant="destructive" className="max-w-2xl mx-auto mt-20">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Application Initialization Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        </div>
    );
  }

  if (showInitialSpinner) {
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }

  const renderSuspenseFallback = (text: string) => <LoadingSpinner text={text} className="mt-20" />;

  const currentQDef = currentSession?.questions && currentSession.questions.length > currentSession.currentQuestionIndex
    ? currentSession.questions[currentSession.currentQuestionIndex]
    : undefined;
  const currentQResponse = currentQDef ? currentSession?.responses[currentQDef.id] : undefined;

  return (
    <div className="space-y-8 pb-16">
      {error && !(appState === 'error' && !isFirebaseInitialized) && (
        <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Encountered</AlertTitle>
          <AlertDescription>
            {error}
            {isFirebaseInitialized && <Button onClick={handleStartNew} variant="outline" className="mt-4">Try to Reset and Start New</Button>}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && appState !== 'initial' && appState !== 'error' && (
        <LoadingSpinner
          text={
            appState === 'generating_report' ? "Finalizing Report..." :
            (appState === 'form' && currentSession?.userProfile?.department) ? "Fetching Questions..." :
            (appState === 'questionnaire' && currentSession?.questions?.length) ? "Saving / Loading Next Question..." :
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
            onSubmitAll={() => setCurrentSession(prev => prev ? {...prev, status: 'generating_report'} : null) }

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
