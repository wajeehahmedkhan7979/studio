
'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  UserProfile,
  ComplianceSession,
  ResponseData,
  QuestionDefinition,
  ReportAnswerDetail,
  SessionProgress
} from '@/lib/types';
import { tailorNepraQuestions, TailorNepraQuestionsInput } from '@/ai/flows/tailor-questions';
import type { TailoredQuestionsOutput } from '@/ai/flows/tailor-questions';
import { generateNepraReport, GenerateNepraReportInput } from '@/ai/flows/generate-report';
import type { GenerateNepraReportOutput } from '@/ai/flows/generate-report';

import { DepartmentRoleForm } from '@/components/questionnaire/DepartmentRoleForm';
import { QuestionCard } from '@/components/questionnaire/QuestionCard';
import { ReportDisplay } from '@/components/report/ReportDisplay';
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

interface QuestionnaireDataForReport {
  questions: string[];
  answers: Record<string, ReportAnswerDetail>;
}

const POLICY_AREAS_TO_RATE = [
  "Security Policy",
  "Access Rights Management",
  "Monitoring and Incident Response",
  "Training and Awareness",
  "Vulnerability Assessment and Penetration Testing (VAPT)",
  "Data Backup and Confidentiality",
  "SOC and PowerCERT Coordination",
  "Reporting (Breach & Audit)",
];

export default function NepraCompliancePage() {
  const [currentSession, setCurrentSession] = useState<ComplianceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);
  const [currentRatingValue, setCurrentRatingValue] = useState<string>('');

  const { toast } = useToast();

  const appState = currentSession?.status || 'initial';

  const handleFetchQuestions = useCallback(async (sessionToUpdate: ComplianceSession, isNewSession: boolean): Promise<boolean> => {
    let fetchSuccess = false;
    if (!sessionToUpdate.userProfile.department || !sessionToUpdate.userProfile.role) {
      setError("Department and Role are required to fetch questions.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
      setIsLoading(false);
      return false;
    }

    if (!isLoading) setIsLoading(true);
    const targetStatus = (appState === 'form' && isNewSession) ? 'form' : 'questionnaire';
    setCurrentSession(prev => prev ? { ...prev, status: targetStatus } : { ...sessionToUpdate, status: targetStatus });

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
        setIsLoading(false); // Ensure loading is stopped on AI error
      } else {
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`,
          questionText: qText,
          category: "NEPRA Compliance", // Default category, AI might provide more specific ones in qText
        }));

        const updatedSessionData: ComplianceSession = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses,
          currentQuestionIndex: isNewSession ? 0 : Math.min(sessionToUpdate.currentQuestionIndex || 0, questionDefinitions.length - 1),
          status: 'questionnaire'
        };
        setCurrentSession(updatedSessionData);

        let dbOperationSuccessful = true;
        if (isNewSession) {
          try {
            await startNewComplianceSession(updatedSessionData);
          } catch (dbError: any) {
            setError(`Failed to save new session to database: ${dbError.message}. Please check Firestore setup and security rules.`);
            toast({ title: "Database Error", description: `Could not start new session: ${dbError.message}`, variant: "destructive" });
            setCurrentSession(prev => ({
              ...(prev || updatedSessionData), // Preserve form input
              userProfile: (prev || updatedSessionData).userProfile,
              sessionId: generateSessionId(), // Generate a NEW id
              questions: [],
              responses: {},
              currentQuestionIndex: 0,
              policyAreasToRate: POLICY_AREAS_TO_RATE,
              currentRatingAreaIndex: 0,
              policyScores: {},
              startTime: new Date().toISOString(),
              reportGenerated: false,
              status: 'form'
            }));
            dbOperationSuccessful = false;
          }
        } else {
          try {
            await updateComplianceSession(updatedSessionData.sessionId, { questions: questionDefinitions });
          } catch (dbError: any) {
            setError(`Failed to update session questions in database: ${dbError.message}.`);
            toast({ title: "Database Error", description: `Could not update session questions: ${dbError.message}`, variant: "destructive" });
            dbOperationSuccessful = false;
          }
        }

        if (dbOperationSuccessful) {
          saveActiveSessionReference({
            sessionId: updatedSessionData.sessionId,
            userProfile: updatedSessionData.userProfile,
            currentQuestionIndex: updatedSessionData.currentQuestionIndex,
            currentRatingAreaIndex: updatedSessionData.currentRatingAreaIndex,
            policyScores: updatedSessionData.policyScores,
          });
          setError(null);
          fetchSuccess = true;
        } else {
          fetchSuccess = false;
        }
      }
    } catch (e: any) {
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      if (e.message?.includes("503") || e.message?.toLowerCase().includes("service unavailable") || e.message?.toLowerCase().includes("model is overloaded")) {
        userErrorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
      } else if (e.message?.toLowerCase().includes("firestore") || e.message?.toLowerCase().includes("firebase")) {
        userErrorMessage = `Firebase error during question processing: ${e.message}. Please ensure Firebase is configured and running, and check security rules.`;
      }
      setError(userErrorMessage);
      toast({ title: "Error", description: userErrorMessage, variant: "destructive" });
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
      fetchSuccess = false;
    } finally {
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
          questions: [],
          responses: {},
          currentQuestionIndex: 0,
          policyAreasToRate: POLICY_AREAS_TO_RATE,
          currentRatingAreaIndex: 0,
          policyScores: {},
          startTime: new Date().toISOString(),
          reportGenerated: false
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
            setIsLoading(false);
            return;
          } else {
            const numResponses = Object.keys(firestoreSession.responses || {}).length;
            let currentQuestionIndex = 0;
            if (firestoreSession.questions && firestoreSession.questions.length > 0) {
                 currentQuestionIndex = firestoreSession.currentQuestionIndex < firestoreSession.questions.length ? firestoreSession.currentQuestionIndex : Math.min(numResponses, firestoreSession.questions.length -1);
            }


            const updatedSession = {
              ...firestoreSession,
              currentQuestionIndex: currentQuestionIndex,
              // Ensure policyAreasToRate is initialized if missing from older sessions
              policyAreasToRate: firestoreSession.policyAreasToRate || POLICY_AREAS_TO_RATE,
              currentRatingAreaIndex: firestoreSession.currentRatingAreaIndex || 0,
              policyScores: firestoreSession.policyScores || {},
              status: (firestoreSession.status === 'collecting_ratings' || (firestoreSession.status === 'questionnaire' && numResponses === firestoreSession.questions.length && firestoreSession.questions.length > 0) ) && firestoreSession.currentRatingAreaIndex < (firestoreSession.policyAreasToRate || POLICY_AREAS_TO_RATE).length ? 'collecting_ratings' : 'questionnaire' as ComplianceSession['status']
            };
            setCurrentSession(updatedSession);

            if ((!firestoreSession.questions || firestoreSession.questions.length === 0) && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
              const fetchSuccess = await handleFetchQuestions(updatedSession, false);
              if (!fetchSuccess) {
                setCurrentSession({
                  sessionId: generateSessionId(),
                  userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                  questions: [], responses: {}, currentQuestionIndex: 0,
                  policyAreasToRate: POLICY_AREAS_TO_RATE, currentRatingAreaIndex: 0, policyScores: {},
                  startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
                });
              }
            }
            setIsLoading(false);
            return;
          }
        } else {
          clearActiveSessionReference();
        }
      } catch (e: any) {
        setError(`Failed to resume session: ${e.message}. Starting fresh. Ensure Firebase is configured, and check security rules.`);
        toast({ title: "Session Resume Error", description: `Could not resume: ${e.message}`, variant: "destructive" });
        clearActiveSessionReference();
      }
    }

    setCurrentSession({
      sessionId: generateSessionId(),
      userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
      questions: [],
      responses: {},
      currentQuestionIndex: 0,
      policyAreasToRate: POLICY_AREAS_TO_RATE,
      currentRatingAreaIndex: 0,
      policyScores: {},
      startTime: new Date().toISOString(),
      reportGenerated: false,
      status: 'form'
    });
    setIsLoading(false);
  }, [toast, handleFetchQuestions, setIsLoading, setError, setCurrentSession, setLastPersistedProfile]);

  useEffect(() => {
    initializeOrResumeApp();
  }, [initializeOrResumeApp]);

  const handleDepartmentRoleSubmit = async (profile: UserProfile) => {
    if (!isFirebaseInitialized) {
      setError("Application not initialized. Cannot submit. Please ensure Firebase is configured.");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    saveUserProfileToStorage(profile);
    setLastPersistedProfile(profile);

    const newSessionId = generateSessionId();
    const initialSession: ComplianceSession = {
      sessionId: newSessionId,
      userProfile: profile,
      questions: [],
      responses: {},
      currentQuestionIndex: 0,
      policyAreasToRate: POLICY_AREAS_TO_RATE,
      currentRatingAreaIndex: 0,
      policyScores: {},
      startTime: new Date().toISOString(),
      reportGenerated: false,
      status: 'form',
    };
    setCurrentSession(initialSession);

    const success = await handleFetchQuestions(initialSession, true);
    if (!success) {
      setIsLoading(false);
    }
  };

  const handleAnswerChange = (answerText: string) => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0 || currentSession.status !== 'questionnaire') return;

    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];

    if (!questionDef) {
      setError("An internal error occurred: Could not find current question. Please try refreshing.");
      return;
    }

    const newResponse: ResponseData = {
      questionId: questionDef.id,
      questionText: questionDef.questionText,
      answerText: answerText,
      timestamp: new Date().toISOString(),
      nepraCategory: questionDef.category,
      riskLevel: 'not_assessed',
    };

    setCurrentSession(prev => {
      if (!prev) return null;
      const updatedResponses = { ...prev.responses, [questionDef.id]: newResponse };
      return { ...prev, responses: updatedResponses };
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

    if (currentResponse) {
      setIsLoading(true);
      try {
        await addResponseToSession(currentSession.sessionId, currentResponse);
        saveActiveSessionReference({
          sessionId: currentSession.sessionId,
          userProfile: currentSession.userProfile,
          currentQuestionIndex: currentSession.currentQuestionIndex,
          currentRatingAreaIndex: currentSession.currentRatingAreaIndex,
          policyScores: currentSession.policyScores,
        });
        await updateComplianceSession(currentSession.sessionId, {
          currentQuestionIndex: currentSession.currentQuestionIndex,
        });
        toast({
          title: "Progress Saved",
          description: "Your current answer and position have been saved.",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } catch (fsError: any) {
        toast({ title: "Sync Error", description: `Could not save progress to cloud: ${fsError.message}. Check Firebase setup and rules.`, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    } else {
      toast({ title: "Nothing to Save", description: "No answer provided for the current question.", variant: "default" });
    }
  }, [currentSession, toast, setIsLoading]);


  const handleNextQuestion = async () => {
    if (!currentSession || currentSession.status !== 'questionnaire' || currentSession.currentQuestionIndex >= currentSession.questions.length - 1) return;

    setIsLoading(true);
    try {
      await saveCurrentProgress();
      const nextIndex = currentSession.currentQuestionIndex + 1;
      if (nextIndex === currentSession.questions.length) { // All questions answered
        setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: nextIndex, status: 'collecting_ratings', currentRatingAreaIndex: 0 } : null);
        setCurrentRatingValue(''); // Reset for the first rating
      } else {
        setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: nextIndex } : null);
      }
    } catch (error) {
      // Error already handled by saveCurrentProgress's toast
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.status !== 'questionnaire' || currentSession.currentQuestionIndex <= 0) return;
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  // Rating specific handlers
  const handleRatingChange = (value: string) => {
    setCurrentRatingValue(value);
  };

  const handleSaveRatingProgress = useCallback(async () => {
    if (!currentSession || currentSession.status !== 'collecting_ratings') {
      toast({ title: "Save Error", description: "Not in rating mode or no active session.", variant: "destructive" });
      return;
    }
    const ratingArea = currentSession.policyAreasToRate[currentSession.currentRatingAreaIndex];
    const numericRating = parseFloat(currentRatingValue);

    if (ratingArea && !isNaN(numericRating) && numericRating >= 0 && numericRating <= 10) {
      setIsLoading(true);
      try {
        const updatedScores = { ...currentSession.policyScores, [ratingArea]: numericRating };
        await updateComplianceSession(currentSession.sessionId, {
          policyScores: updatedScores,
          currentRatingAreaIndex: currentSession.currentRatingAreaIndex
        });
        saveActiveSessionReference({
          sessionId: currentSession.sessionId,
          userProfile: currentSession.userProfile,
          currentQuestionIndex: currentSession.currentQuestionIndex,
          currentRatingAreaIndex: currentSession.currentRatingAreaIndex,
          policyScores: updatedScores,
        });
        toast({ title: "Rating Progress Saved", description: `Rating for ${ratingArea} saved.` });
      } catch (fsError: any) {
        toast({ title: "Sync Error", description: `Could not save rating progress: ${fsError.message}`, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    } else {
      toast({ title: "Invalid Rating", description: "Please enter a number between 0.0 and 10.0.", variant: "destructive" });
    }
  }, [currentSession, currentRatingValue, toast, setIsLoading]);

  const handleSubmitRating = async () => {
    if (!currentSession || currentSession.status !== 'collecting_ratings') return;

    const ratingArea = currentSession.policyAreasToRate[currentSession.currentRatingAreaIndex];
    const numericRating = parseFloat(currentRatingValue);

    if (isNaN(numericRating) || numericRating < 0 || numericRating > 10) {
      toast({ title: "Invalid Rating", description: "Please enter a number between 0.0 and 10.0.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const updatedScores = { ...currentSession.policyScores, [ratingArea]: numericRating };

    try {
      // Optimistically update UI, then save to DB
      setCurrentSession(prev => {
        if (!prev) return null;
        const nextRatingIndex = prev.currentRatingAreaIndex + 1;
        if (nextRatingIndex < prev.policyAreasToRate.length) {
          return {
            ...prev,
            policyScores: updatedScores,
            currentRatingAreaIndex: nextRatingIndex,
          };
        } else { // All ratings collected
          return {
            ...prev,
            policyScores: updatedScores,
            status: 'generating_report', // Transition to report generation
          };
        }
      });
      setCurrentRatingValue(''); // Reset for next rating or clear after last

      await updateComplianceSession(currentSession.sessionId, { policyScores: updatedScores, currentRatingAreaIndex: currentSession.currentRatingAreaIndex + 1 }); // Save all scores + new index
      saveActiveSessionReference({
        sessionId: currentSession.sessionId,
        userProfile: currentSession.userProfile,
        currentQuestionIndex: currentSession.currentQuestionIndex,
        currentRatingAreaIndex: currentSession.currentRatingAreaIndex + 1, // This will be updated by setCurrentSession if not last
        policyScores: updatedScores,
      });

      if (currentSession.currentRatingAreaIndex +1 === currentSession.policyAreasToRate.length) {
        // If this was the last rating, trigger report generation
         await handleSubmitAndGenerateReport(updatedScores); // Pass final scores
      }

    } catch (fsError: any) {
      toast({ title: "Sync Error", description: `Could not save rating: ${fsError.message}`, variant: "destructive" });
      // Potentially revert optimistic UI update if needed, though for simplicity, we might rely on next save/load
    } finally {
      setIsLoading(false);
    }
  };


  const handleSubmitAndGenerateReport = async (finalPolicyScores?: Record<string, number>) => {
    if (!currentSession || !currentSession.userProfile) {
      setError("Session data or user profile is not available. Please fill out the form again.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : null);
      setIsLoading(false);
      return;
    }

    // Ensure final progress of questions is saved if report is triggered directly
    // This might happen if handleSubmitRating calls this after the last rating
    if (currentSession.status === 'questionnaire' && currentSession.questions.length > 0) {
        await saveCurrentProgress();
    }


    setIsLoading(true);
    setError(null);
    setCurrentSession(prev => prev ? { ...prev, status: 'generating_report' } : null);

    try {
      const reportAnswers: Record<string, ReportAnswerDetail> = {};
      currentSession.questions.forEach((qDef, index) => {
        const response = currentSession.responses[qDef.id];
        reportAnswers[index.toString()] = {
          question: qDef.questionText,
          answerText: response ? response.answerText : "[No answer provided]",
          timestamp: response ? response.timestamp : new Date().toISOString(),
          nepraCategory: response?.nepraCategory || qDef.category,
        };
      });

      const questionnaireDataForReport: QuestionnaireDataForReport = {
        questions: currentSession.questions.map(q => q.questionText),
        answers: reportAnswers,
      };

      const reportInput: GenerateNepraReportInput = {
        userProfile: currentSession.userProfile,
        questionnaireData: questionnaireDataForReport,
        sessionId: currentSession.sessionId,
        reportDate: new Date().toLocaleDateString('en-CA'),
        completedTime: new Date().toISOString(),
        policyScores: finalPolicyScores || currentSession.policyScores, // Use final scores if passed
      };

      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      setGeneratedReportContent(result.reportContent);

      const completedTime = new Date().toISOString();
      let reportStorageUrl = '';
      if (result.reportContent) {
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
        policyScores: finalPolicyScores || currentSession.policyScores, // Ensure final scores are in the session for DB
      };
      setCurrentSession(prev => prev ? { ...prev, ...updatedSessionOnComplete, status: 'report_ready' } as ComplianceSession : null);
      await updateComplianceSession(currentSession.sessionId, updatedSessionOnComplete);
      clearActiveSessionReference();

    } catch (e: any) {
      setError(`Failed to generate or finalize report: ${e.message}.`);
      toast({ title: "Report Finalization Failed", description: `Could not complete the report process: ${e.message}`, variant: "destructive" });
      setCurrentSession(prev => prev ? { ...prev, status: 'questionnaire' } : null); // Revert to questionnaire or ratings
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNew = () => {
    clearActiveSessionReference();
    setCurrentSession(null);
    setGeneratedReportContent(null);
    setError(null);
    setCurrentRatingValue('');
    initializeOrResumeApp();
  };

  if (appState === 'initial' && isLoading && !error) {
    return <LoadingSpinner text={"Initializing Compliance Agent..."} className="mt-20" />;
  }

  if (isLoading &&
    (appState === 'generating_report' ||
      (appState === 'form' && (!currentSession?.userProfile.department && !error)) || // Loading form if no profile details yet AND no error
      (appState === 'questionnaire' && (!currentSession?.questions || currentSession.questions.length === 0) && !error) || // Loading questions only if they are empty AND no error
      (appState === 'collecting_ratings' && !error) // Loading during ratings only if no error
    ) && !error) {
    let spinnerText = "Loading...";
    if (appState === 'generating_report') spinnerText = "Finalizing Report...";
    else if (appState === 'form' || (appState === 'questionnaire' && (!currentSession?.questions || currentSession.questions.length === 0))) spinnerText = "Loading Questions & Session...";
    else if (appState === 'collecting_ratings') spinnerText = "Loading Next Rating Area...";

    return <LoadingSpinner text={spinnerText} className="mt-20" />;
  }

  return (
    <div className="space-y-8">
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

      {isFirebaseInitialized && appState === 'form' && !error && (
        <DepartmentRoleForm
          onSubmit={handleDepartmentRoleSubmit}
          initialProfile={currentSession?.userProfile || lastPersistedProfile}
          isLoading={isLoading} />
      )}

      {error && appState !== 'error' && isFirebaseInitialized && (
        <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Encountered</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isFirebaseInitialized && appState === 'questionnaire' && currentSession && currentSession.questions && currentSession.questions.length > 0 && (
        <QuestionCard
          question={currentSession.questions[currentSession.currentQuestionIndex]?.questionText || "Loading question..."}
          questionNumber={currentSession.currentQuestionIndex + 1}
          totalQuestions={currentSession.questions.length}
          answer={currentSession.responses[currentSession.questions[currentSession.currentQuestionIndex]?.id]?.answerText || ''}
          onAnswerChange={handleAnswerChange}
          onNext={handleNextQuestion}
          onPrevious={handlePreviousQuestion}
          onSaveProgress={saveCurrentProgress}
          onSubmitAll={() => handleSubmitAndGenerateReport()} // Directly call, scores will be from session state
          isFirstQuestion={currentSession.currentQuestionIndex === 0}
          isLastQuestion={currentSession.currentQuestionIndex === currentSession.questions.length - 1}
          isLoading={isLoading}
          isRatingMode={false}
        />
      )}

      {isFirebaseInitialized && appState === 'collecting_ratings' && currentSession && currentSession.policyAreasToRate.length > 0 && (
        <QuestionCard
          isRatingMode={true}
          ratingQuestion={`On a scale from 0.0 to 10.0, how would you rate your department’s compliance with NEPRA's ${currentSession.policyAreasToRate[currentSession.currentRatingAreaIndex]}?`}
          questionNumber={currentSession.currentRatingAreaIndex + 1}
          totalQuestions={currentSession.policyAreasToRate.length}
          currentRatingValue={currentRatingValue}
          onRatingChange={handleRatingChange}
          onNext={handleSubmitRating} // "Next" button submits current rating and moves to next
          onPrevious={() => { // Allow going back in ratings
            if (currentSession.currentRatingAreaIndex > 0) {
              setCurrentSession(prev => prev ? { ...prev, currentRatingAreaIndex: prev.currentRatingAreaIndex - 1 } : null);
              // Pre-fill rating if it exists for the previous area
              const prevRatingArea = currentSession.policyAreasToRate[currentSession.currentRatingAreaIndex - 1];
              setCurrentRatingValue(currentSession.policyScores[prevRatingArea]?.toString() || '');
            }
          }}
          onSaveProgress={handleSaveRatingProgress} // "Save Progress" button on rating card
          onSubmitAll={() => handleSubmitAndGenerateReport()} // "Submit All" becomes "Generate Report" after last rating
          isFirstQuestion={currentSession.currentRatingAreaIndex === 0}
          isLastQuestion={currentSession.currentRatingAreaIndex === currentSession.policyAreasToRate.length - 1}
          isLoading={isLoading}
          // Dummy props for non-rating mode, not used
          question=""
          answer=""
          onAnswerChange={() => {}}
        />
      )}

      {isFirebaseInitialized && (appState === 'questionnaire' || appState === 'collecting_ratings') && currentSession && ((appState === 'questionnaire' && (!currentSession.questions || currentSession.questions.length === 0)) || (appState === 'collecting_ratings' && (!currentSession.policyAreasToRate || currentSession.policyAreasToRate.length === 0))) && isLoading && !error && (
        <div className="text-center py-10">
          <LoadingSpinner text={appState === 'questionnaire' ? "Preparing NEPRA compliance questions for your role..." : "Preparing policy rating areas..."} />
          <p className="mt-4 text-muted-foreground">If this takes too long, please check your role/department selection or connection, and ensure Firebase services are correctly set up with appropriate security rules.</p>
        </div>
      )}

      {isFirebaseInitialized && appState === 'report_ready' && generatedReportContent && (
        <ReportDisplay
          report={generatedReportContent}
          onStartNew={handleStartNew}
          reportUrl={currentSession?.reportUrl}
        />
      )}

      {isFirebaseInitialized && appState === 'report_ready' && !generatedReportContent && (
        <Alert variant="default" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Report Status</AlertTitle>
          <AlertDescription>
            The questionnaire is complete.
            {currentSession?.reportUrl
              ? <>Report was generated and <a href={currentSession.reportUrl} target="_blank" rel="noopener noreferrer" className="underline">can be accessed here</a>.</>
              : "Report content is not currently displayed. You can start a new questionnaire."
            }
            <Button onClick={handleStartNew} variant="outline" className="mt-4 ml-2">Start New Questionnaire</Button>
          </AlertDescription>
        </Alert>
      )}

      {(appState !== 'initial' && appState !== 'generating_report' && !(appState === 'error' && !isFirebaseInitialized)) && (
        <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
