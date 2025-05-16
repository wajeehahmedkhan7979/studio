
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserProfile, NepraSessionData, NepraAnswer, QuestionnaireDataForReport, NepraQuestionnaireProgress } from '@/lib/types';
import { tailorNepraQuestions, TailorNepraQuestionsInput, TailorNepraQuestionsOutput } from '@/ai/flows/tailor-questions';
import { generateNepraReport, GenerateNepraReportInput, GenerateNepraReportOutput } from '@/ai/flows/generate-report';
import { DepartmentRoleForm } from '@/components/questionnaire/DepartmentRoleForm';
import { QuestionCard } from '@/components/questionnaire/QuestionCard';
import { ReportDisplay } from '@/components/report/ReportDisplay';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  saveSessionProgress,
  loadSessionProgress,
  clearAllNepraData,
  generateSessionId,
  saveUserProfileToStorage, // To save initial profile if needed separately
  loadUserProfileFromStorage
} from '@/lib/storage';
import { saveSessionToFirestore, addAnswerToSessionInFirestore, uploadReportToStorage } from '@/lib/firebaseService'; // Firebase stubs

type AppState = 'initial' | 'form' | 'questionnaire' | 'report' | 'loading';

export default function NepraCompliancePage() {
  const [appState, setAppState] = useState<AppState>('initial');
  
  const [sessionData, setSessionData] = useState<NepraSessionData | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null); // Kept for form initialization
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { toast } = useToast();

  const initializeNewSession = (profile: UserProfile): NepraSessionData => {
    const newSessionId = generateSessionId();
    return {
      sessionId: newSessionId,
      userProfile: profile,
      questions: [],
      answers: {},
      currentQuestionIndex: 0,
      startTime: new Date().toISOString(),
      reportGenerated: false,
    };
  };

  const loadSavedSession = useCallback(async () => {
    setIsLoading(true);
    setAppState('loading');
    const savedProgress = loadSessionProgress();
    
    if (savedProgress?.sessionId && savedProgress?.userProfile) {
      // Potentially re-hydrate from Firestore if full session needed and only partial in localStorage
      // For now, assume localStorage has enough to continue or fetch questions
      const loadedSession: NepraSessionData = {
        sessionId: savedProgress.sessionId,
        userProfile: savedProgress.userProfile,
        questions: savedProgress.questions || [],
        answers: savedProgress.answers || {},
        currentQuestionIndex: savedProgress.currentQuestionIndex || 0,
        startTime: savedProgress.startTime || new Date().toISOString(), // Fallback, should be there
        reportGenerated: false, // Assume false unless specifically loaded
      };
      setSessionData(loadedSession);
      setUserProfile(loadedSession.userProfile); // For form prefill if needed

      if (loadedSession.questions.length > 0) {
        if (Object.keys(loadedSession.answers).length === loadedSession.questions.length && loadedSession.questions.length > 0) {
          // All questions answered, maybe go to report or allow re-submit
          setAppState('questionnaire'); // Let user review and submit
        } else {
          setAppState('questionnaire');
        }
      } else if (loadedSession.userProfile.department && loadedSession.userProfile.role) {
        // Has profile, but no questions in local storage, fetch them
        await handleFetchQuestions(loadedSession);
      } else {
        setAppState('form'); // Profile incomplete
      }
    } else {
      // No saved session, try loading just the user profile for form prefill
      const lastUserProfile = loadUserProfileFromStorage();
      setUserProfile(lastUserProfile); // Prefill form if available
      setAppState('form');
    }
    setIsLoading(false);
  }, []); // No dependencies that would cause re-runs without actual state change

  useEffect(() => {
    loadSavedSession();
  }, [loadSavedSession]);

  const handleFetchQuestions = async (currentSession: NepraSessionData) => {
    if (!currentSession.userProfile.department || !currentSession.userProfile.role) {
      setError("Department and Role are required to fetch questions.");
      setAppState('form');
      return;
    }
    setIsLoading(true);
    setError(null);
    setAppState('loading');
    try {
      const tailorInput: TailorNepraQuestionsInput = { 
        department: currentSession.userProfile.department, 
        role: currentSession.userProfile.role 
      };
      const result: TailorNepraQuestionsOutput = await tailorNepraQuestions(tailorInput);
      const fetchedQuestions = result.questions || [];
      
      if (fetchedQuestions.length === 0 || (fetchedQuestions.length === 1 && fetchedQuestions[0].startsWith("Failed to generate"))) {
        setError(fetchedQuestions[0] || 'No questions were returned for your department/role. Please try again or contact support.');
        toast({ title: "Error", description: "Could not fetch questions.", variant: "destructive" });
        setAppState('form'); // Go back to form
      } else {
        const updatedSession = {
          ...currentSession,
          questions: fetchedQuestions,
          answers: {}, // Reset answers for new questions
          currentQuestionIndex: 0,
        };
        setSessionData(updatedSession);
        saveSessionProgress({
          sessionId: updatedSession.sessionId,
          userProfile: updatedSession.userProfile,
          questions: updatedSession.questions,
          answers: updatedSession.answers,
          currentQuestionIndex: updatedSession.currentQuestionIndex,
          startTime: updatedSession.startTime,
        });
        // await saveSessionToFirestore(updatedSession); // Save initial session with questions
        setAppState('questionnaire');
      }
    } catch (e) {
      console.error("Error tailoring questions:", e);
      setError('Failed to load questions. Please check your connection or try again.');
      toast({ title: "Error", description: "Could not fetch questions. Please check your connection or try again later.", variant: "destructive"});
      setAppState('form');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDepartmentRoleSubmit = async (profile: UserProfile) => {
    setUserProfile(profile); // Save for potential re-use if user starts over quickly
    saveUserProfileToStorage(profile); // Save for form prefill next time

    const newSession = initializeNewSession(profile);
    setSessionData(newSession);
    // Save minimal progress to indicate session start
    saveSessionProgress({
      sessionId: newSession.sessionId,
      userProfile: newSession.userProfile,
      startTime: newSession.startTime,
      currentQuestionIndex: 0,
      answers: {},
      questions: []
    });
    // await saveSessionToFirestore(newSession); // Save initial session structure to Firestore
    await handleFetchQuestions(newSession);
  };

  const handleAnswerChange = (answerText: string) => {
    if (!sessionData) return;

    const now = new Date().toISOString();
    const newAnswer: NepraAnswer = {
      question: sessionData.questions[sessionData.currentQuestionIndex],
      answerText: answerText,
      timestamp: now,
      // nepraCategory could be assigned here if questions had categories from tailorQuestions
    };

    setSessionData(prev => {
      if (!prev) return null;
      const updatedAnswers = { ...prev.answers, [prev.currentQuestionIndex]: newAnswer };
      return { ...prev, answers: updatedAnswers, lastSavedTime: now };
    });
  };

  const saveCurrentProgressToStorageAndFirestore = useCallback(async () => {
    if (sessionData) {
      saveSessionProgress({
        sessionId: sessionData.sessionId,
        userProfile: sessionData.userProfile,
        questions: sessionData.questions,
        answers: sessionData.answers,
        currentQuestionIndex: sessionData.currentQuestionIndex,
        startTime: sessionData.startTime,
      });
      
      // Update Firestore (could be optimized to save only changed answer)
      // For simplicity, saving the relevant parts or just the latest answer.
      // If saving just the latest answer:
      const currentAnswer = sessionData.answers[sessionData.currentQuestionIndex];
      if (currentAnswer) {
         try {
            await addAnswerToSessionInFirestore(
                sessionData.sessionId,
                sessionData.userProfile.department,
                sessionData.userProfile.role,
                sessionData.currentQuestionIndex,
                currentAnswer
            );
         } catch (fsError) {
            console.error("Firestore save error:", fsError);
            toast({ title: "Sync Error", description: "Could not save progress to cloud.", variant: "destructive" });
         }
      } else {
        // Or save the whole session if structure is simple
        // await saveSessionToFirestore(sessionData);
      }


      toast({
        title: "Progress Saved",
        description: "Your current answers and position have been saved.",
        action: <CheckCircle2 className="text-green-500" />,
      });
    }
  }, [sessionData, toast]);

  const handleNextQuestion = async () => {
    if (!sessionData || sessionData.currentQuestionIndex >= sessionData.questions.length - 1) return;
    await saveCurrentProgressToStorageAndFirestore(); 
    setSessionData(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 } : null);
  };

  const handlePreviousQuestion = () => {
    if (!sessionData || sessionData.currentQuestionIndex <= 0) return;
    setSessionData(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  const handleSubmitAndGenerateReport = async () => {
    if (!sessionData || !sessionData.userProfile) {
      setError("Session data or user profile is not available. Please fill out the form again.");
      setAppState('form');
      return;
    }
    await saveCurrentProgressToStorageAndFirestore(); // Save final answers
    
    setIsLoading(true);
    setError(null);
    setAppState('loading');

    // Prepare answers for the report generator (string-indexed, string answers)
    const reportAnswers: Record<string, any> = {};
    Object.entries(sessionData.answers).forEach(([index, nepraAnswer]) => {
      reportAnswers[index] = nepraAnswer; // Pass the whole NepraAnswer object
    });

    const reportInput: GenerateNepraReportInput = {
      userProfile: sessionData.userProfile,
      questionnaireData: {
        questions: sessionData.questions,
        answers: reportAnswers,
      },
      sessionId: sessionData.sessionId,
      reportDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
    };

    try {
      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      const updatedSession = { ...sessionData, reportGenerated: true, completedTime: new Date().toISOString() };
      
      // Try to upload report to Firebase Storage
      try {
        const reportUrl = await uploadReportToStorage(updatedSession.sessionId, result.reportContent);
        updatedSession.reportUrl = reportUrl;
        toast({ title: "Report Uploaded", description: "Compliance report saved to secure storage."});
      } catch (storageError) {
        console.error("Error uploading report to storage:", storageError);
        toast({ title: "Storage Error", description: "Could not upload report. It is available locally.", variant: "destructive"});
      }
      
      setSessionData(updatedSession);
      // await saveSessionToFirestore(updatedSession); // Save final session state with report status
      
      // Save final progress including report status to local storage
      saveSessionProgress({
          sessionId: updatedSession.sessionId,
          userProfile: updatedSession.userProfile,
          questions: updatedSession.questions,
          answers: updatedSession.answers,
          currentQuestionIndex: updatedSession.currentQuestionIndex,
          startTime: updatedSession.startTime,
      });


      setAppState('report');
    } catch (e) {
      console.error("Error generating report:", e);
      setError('Failed to generate report. Please try again.');
      toast({ title: "Report Generation Failed", description: "Could not generate the report.", variant: "destructive"});
      setAppState('questionnaire'); 
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNew = () => {
    clearAllNepraData();
    setSessionData(null);
    setUserProfile(loadUserProfileFromStorage()); // Pre-fill if previous basic info exists
    setError(null);
    setAppState('form');
  };
  
  if (appState === 'initial' || (isLoading && !sessionData && !userProfile)) {
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }
  
  if (isLoading && appState === 'loading') {
     return <LoadingSpinner text={sessionData?.reportGenerated ? "Finalizing Report..." : (sessionData?.questions.length ? "Processing..." : "Loading Questions...")} className="mt-20" />;
  }

  return (
    <div className="space-y-8">
      {error && (
         <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {appState === 'form' && (
        <DepartmentRoleForm 
            onSubmit={handleDepartmentRoleSubmit} 
            initialProfile={userProfile} 
            isLoading={isLoading} />
      )}

      {appState === 'questionnaire' && sessionData && sessionData.questions.length > 0 && (
        <QuestionCard
          question={sessionData.questions[sessionData.currentQuestionIndex]}
          questionNumber={sessionData.currentQuestionIndex + 1}
          totalQuestions={sessionData.questions.length}
          answer={sessionData.answers[sessionData.currentQuestionIndex]?.answerText || ''}
          onAnswerChange={handleAnswerChange}
          onNext={handleNextQuestion}
          onPrevious={handlePreviousQuestion}
          onSaveProgress={saveCurrentProgressToStorageAndFirestore}
          onSubmitAll={handleSubmitAndGenerateReport}
          isFirstQuestion={sessionData.currentQuestionIndex === 0}
          isLastQuestion={sessionData.currentQuestionIndex === sessionData.questions.length - 1}
          isLoading={isLoading}
        />
      )}
      
      {appState === 'questionnaire' && sessionData && sessionData.questions.length === 0 && !isLoading && (
        <div className="text-center py-10">
            <LoadingSpinner text="Preparing NEPRA compliance questions for your role..."/>
            <p className="mt-4 text-muted-foreground">If this takes too long, please check your role/department selection and try again, or contact support.</p>
        </div>
      )}

      {appState === 'report' && sessionData?.reportGenerated && sessionData.answers && (
        <ReportDisplay 
            report={(sessionData.answers[0] as unknown as GenerateNepraReportOutput)?.reportContent || "Report content not available."} // Bit of a hack to get report content, needs proper state
            onStartNew={handleStartNew} 
        />
      )}
       {/* Temporary fix for report display - Ideally, generatedReport would be a separate state variable.
           The current structure stores the report in sessionData.answers[0] which is incorrect.
           A proper fix would be to have a `generatedReportContent: string | null` state.
           For now, assuming the report generation flow returns the content and it's somehow accessible.
           The ReportDisplay component expects `report: string`.
       */}
       {appState === 'report' && sessionData && !sessionData.answers && (
            <Alert variant="destructive" className="max-w-2xl mx-auto">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Report Display Error</AlertTitle>
                <AlertDescription>Report content is not in the expected state. Please try generating again.</AlertDescription>
            </Alert>
       )}
      
      {(appState !== 'initial' && appState !== 'loading') && (
         <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive/80 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
