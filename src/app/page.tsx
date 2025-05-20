
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
  saveUserProfileToStorage, 
  loadUserProfileFromStorage
} from '@/lib/storage';
import { saveSessionToFirestore, addAnswerToSessionInFirestore, uploadReportToStorage } from '@/lib/firebaseService'; 

type AppState = 'initial' | 'form' | 'questionnaire' | 'report' | 'loading';

export default function NepraCompliancePage() {
  const [appState, setAppState] = useState<AppState>('initial');
  
  const [sessionData, setSessionData] = useState<NepraSessionData | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null); 
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);


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
      const loadedSession: NepraSessionData = {
        sessionId: savedProgress.sessionId,
        userProfile: savedProgress.userProfile,
        questions: savedProgress.questions || [],
        answers: savedProgress.answers || {},
        currentQuestionIndex: savedProgress.currentQuestionIndex || 0,
        startTime: savedProgress.startTime || new Date().toISOString(), 
        reportGenerated: false, 
      };
      setSessionData(loadedSession);
      setUserProfile(loadedSession.userProfile); 

      if (loadedSession.questions.length > 0) {
        if (Object.keys(loadedSession.answers).length === loadedSession.questions.length && loadedSession.questions.length > 0) {
          setAppState('questionnaire'); 
        } else {
          setAppState('questionnaire');
        }
      } else if (loadedSession.userProfile.department && loadedSession.userProfile.role) {
        await handleFetchQuestions(loadedSession);
      } else {
        setAppState('form'); 
      }
    } else {
      const lastUserProfile = loadUserProfileFromStorage();
      setUserProfile(lastUserProfile); 
      setAppState('form');
    }
    setIsLoading(false);
  }, []); 

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
        setAppState('form'); 
      } else {
        const updatedSession = {
          ...currentSession,
          questions: fetchedQuestions,
          answers: {}, 
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
        setAppState('questionnaire');
      }
    } catch (e) {
      console.error("Error tailoring questions:", e);
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      let userErrorDescription = "Could not fetch questions. Please check your connection or try again later.";

      if (e instanceof Error && e.message) {
        if (e.message.includes("503") || e.message.toLowerCase().includes("service unavailable") || e.message.toLowerCase().includes("model is overloaded")) {
          userErrorMessage = "AI Service Overloaded";
          userErrorDescription = "The AI service is currently experiencing high demand. Please try again in a few minutes.";
        }
      }
      setError(userErrorMessage);
      toast({ title: "Error", description: userErrorDescription, variant: "destructive"});
      setAppState('form');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDepartmentRoleSubmit = async (profile: UserProfile) => {
    setUserProfile(profile); 
    saveUserProfileToStorage(profile);

    const newSession = initializeNewSession(profile);
    setSessionData(newSession);
    saveSessionProgress({
      sessionId: newSession.sessionId,
      userProfile: newSession.userProfile,
      startTime: newSession.startTime,
      currentQuestionIndex: 0,
      answers: {},
      questions: []
    });
    await handleFetchQuestions(newSession);
  };

  const handleAnswerChange = (answerText: string) => {
    if (!sessionData) return;

    const now = new Date().toISOString();
    const newAnswer: NepraAnswer = {
      question: sessionData.questions[sessionData.currentQuestionIndex],
      answerText: answerText,
      timestamp: now,
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
    await saveCurrentProgressToStorageAndFirestore(); 
    
    setIsLoading(true);
    setError(null);
    setAppState('loading');

    const reportAnswers: Record<string, NepraAnswer> = {};
    Object.entries(sessionData.answers).forEach(([index, nepraAnswer]) => {
      reportAnswers[index] = nepraAnswer;
    });

    const questionnaireDataForReport: QuestionnaireDataForReport = {
      questions: sessionData.questions,
      answers: reportAnswers,
    };

    const reportInput: GenerateNepraReportInput = {
      userProfile: sessionData.userProfile,
      questionnaireData: questionnaireDataForReport,
      sessionId: sessionData.sessionId,
      reportDate: new Date().toLocaleDateString('en-CA'), 
    };

    try {
      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      setGeneratedReportContent(result.reportContent);

      const updatedSession = { ...sessionData, reportGenerated: true, completedTime: new Date().toISOString() };
      
      try {
        const reportUrl = await uploadReportToStorage(updatedSession.sessionId, result.reportContent);
        updatedSession.reportUrl = reportUrl;
        toast({ title: "Report Uploaded", description: "Compliance report saved to secure storage."});
      } catch (storageError) {
        console.error("Error uploading report to storage:", storageError);
        toast({ title: "Storage Error", description: "Could not upload report. It is available locally.", variant: "destructive"});
      }
      
      setSessionData(updatedSession);
      
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
    setGeneratedReportContent(null);
    setUserProfile(loadUserProfileFromStorage()); 
    setError(null);
    setAppState('form');
  };
  
  if (appState === 'initial' || (isLoading && !sessionData && !userProfile)) {
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }
  
  if (isLoading && appState === 'loading') {
     return <LoadingSpinner text={sessionData?.reportGenerated ? "Finalizing Report..." : (sessionData?.questions && sessionData.questions.length > 0 ? "Processing..." : "Loading Questions...")} className="mt-20" />;
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

      {appState === 'report' && generatedReportContent && (
        <ReportDisplay 
            report={generatedReportContent}
            onStartNew={handleStartNew} 
            reportUrl={sessionData?.reportUrl}
        />
      )}
       
       {appState === 'report' && !generatedReportContent && (
            <Alert variant="destructive" className="max-w-2xl mx-auto">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Report Display Error</AlertTitle>
                <AlertDescription>Report content is not available. Please try generating again.</AlertDescription>
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

    