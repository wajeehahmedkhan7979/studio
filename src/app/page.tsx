
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { 
  UserProfile, 
  ComplianceSession, 
  ResponseData, 
  QuestionDefinition,
  ReportAnswerDetail,
  SessionProgress // Keep if used for local storage structure
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
  clearActiveSessionReference, // Renamed from clearAllNepraData for clarity
  generateSessionId,
} from '@/lib/storage';

import {
  isFirebaseInitialized, // Import the flag
  startNewComplianceSession,
  getComplianceSession,
  addResponseToSession,
  updateComplianceSession,
  uploadReportToStorage,
} from '@/lib/firebaseService'; 

// Define QuestionnaireDataForReport if it's used in this file, or import if defined elsewhere
interface QuestionnaireDataForReport {
  questions: string[];
  answers: Record<string, ReportAnswerDetail>;
}


export default function NepraCompliancePage() {
  const [currentSession, setCurrentSession] = useState<ComplianceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);

  const { toast } = useToast();

  const setAppState = (status: ComplianceSession['status']) => {
    setCurrentSession(prev => prev ? { ...prev, status } : null);
  };
  const appState = currentSession?.status || 'initial';

  const initializeOrResumeApp = useCallback(async () => {
    setIsLoading(true);
    setError(null); // Clear previous errors on re-init
    
    if (!isFirebaseInitialized) {
      setError("CRITICAL: Firebase is not configured. Please ensure all NEXT_PUBLIC_FIREBASE_... environment variables are set correctly in your .env file. Application features relying on Firebase will not work.");
      setIsLoading(false);
      setCurrentSession(prev => ({
        ...(prev || { 
            sessionId: generateSessionId(), 
            userProfile: loadUserProfileFromStorage() || { name: '', email: '', department: '', role: '' }, 
            questions: [], 
            responses: {}, 
            currentQuestionIndex: 0, 
            startTime: new Date().toISOString(), 
            reportGenerated: false 
        }),
        status: 'error'
      }));
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
             let reportContentToDisplay = "Previously generated report. Content might be fetched if URL exists.";
             if (firestoreSession.reportUrl) {
                try {
                    // Attempt to fetch report content if a URL is stored.
                    // This is a basic fetch, consider adding error handling or a dedicated service.
                    // const response = await fetch(firestoreSession.reportUrl);
                    // if (response.ok) reportContentToDisplay = await response.text();
                    // else reportContentToDisplay = `Previously generated report available at: ${firestoreSession.reportUrl}. Could not fetch preview.`;
                    // For now, just indicate it's available at URL:
                    reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}`;
                } catch (fetchError) {
                    console.error("Error fetching stored report:", fetchError);
                    reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}. Error fetching preview.`;
                }
             }
             setGeneratedReportContent(reportContentToDisplay);
             const completedSession = { ...firestoreSession, status: 'report_ready' as ComplianceSession['status'] };
             setCurrentSession(completedSession);
             setIsLoading(false);
             return;
          } else {
            // Resuming an incomplete session
            const numResponses = Object.keys(firestoreSession.responses || {}).length;
            const currentQuestionIndex = (firestoreSession.questions && firestoreSession.questions.length > 0) 
                                          ? Math.min(numResponses, firestoreSession.questions.length -1) 
                                          : 0;
            const updatedSession = {
                ...firestoreSession,
                currentQuestionIndex: currentQuestionIndex,
                status: 'questionnaire' as ComplianceSession['status']
            };
            setCurrentSession(updatedSession);
            if ((!firestoreSession.questions || firestoreSession.questions.length === 0) && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
                await handleFetchQuestions(updatedSession, false);
            } else {
                setIsLoading(false);
            }
            return;
          }
        }
      } catch (e: any) {
        console.error("Error resuming session from Firestore:", e);
        setError(`Failed to resume session: ${e.message}. Starting fresh. Please ensure Firebase is configured if this persists.`);
        clearActiveSessionReference(); // Clear faulty reference
      }
    }
    
    // Default to form state if no resumable session or error during resume
    setCurrentSession({
        sessionId: generateSessionId(),
        userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
        questions: [],
        responses: {},
        currentQuestionIndex: 0,
        startTime: new Date().toISOString(),
        reportGenerated: false,
        status: 'form'
    });
    setIsLoading(false);
  }, []); 

  useEffect(() => {
    initializeOrResumeApp();
  }, [initializeOrResumeApp]);

  const handleFetchQuestions = async (sessionToUpdate: ComplianceSession, isNewSession: boolean) => {
    if (!sessionToUpdate.userProfile.department || !sessionToUpdate.userProfile.role) {
      setError("Department and Role are required to fetch questions.");
      setAppState('form');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setAppState(sessionToUpdate.status === 'form' ? 'form' : 'questionnaire');


    try {
      const tailorInput: TailorNepraQuestionsInput = {
        department: sessionToUpdate.userProfile.department,
        role: sessionToUpdate.userProfile.role,
      };
      const result: TailoredQuestionsOutput = await tailorNepraQuestions(tailorInput);
      
      const fetchedQuestionTexts = result.questions || [];
      if (fetchedQuestionTexts.length === 0 || (fetchedQuestionTexts.length === 1 && fetchedQuestionTexts[0].startsWith("Error:"))) {
        const errorMessage = fetchedQuestionTexts[0] || 'No questions were returned for your department/role. Please try again or contact support.';
        setError(errorMessage);
        toast({ title: "Error Fetching Questions", description: errorMessage, variant: "destructive" });
        setAppState('form');
      } else {
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`,
          questionText: qText,
          category: "NEPRA Compliance", // Default category, AI might refine later
        }));

        const updatedSessionData = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses, // Clear responses for new session
          currentQuestionIndex: isNewSession ? 0 : Math.min(sessionToUpdate.currentQuestionIndex, questionDefinitions.length -1),
          status: 'questionnaire' as ComplianceSession['status']
        };
        setCurrentSession(updatedSessionData);
        
        if (isNewSession) {
            await startNewComplianceSession(updatedSessionData); // This saves profile, questions, initial status
        } else {
            // Only update questions if they were re-fetched for an existing session
            await updateComplianceSession(updatedSessionData.sessionId, { questions: questionDefinitions });
        }
        saveActiveSessionReference({ 
            sessionId: updatedSessionData.sessionId, 
            userProfile: updatedSessionData.userProfile, 
            currentQuestionIndex: updatedSessionData.currentQuestionIndex 
        });
        setError(null);
      }
    } catch (e: any) {
      console.error("Error tailoring questions:", e);
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      if (e.message?.includes("503") || e.message?.toLowerCase().includes("service unavailable") || e.message?.toLowerCase().includes("model is overloaded")) {
        userErrorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
      } else if (e.message?.toLowerCase().includes("firestore") || e.message?.toLowerCase().includes("firebase")){
        userErrorMessage = `Firebase error during question processing: ${e.message}. Please ensure Firebase is configured and running.`;
      }
      setError(userErrorMessage);
      toast({ title: "Error", description: userErrorMessage, variant: "destructive" });
      setAppState('form');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDepartmentRoleSubmit = async (profile: UserProfile) => {
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
      startTime: new Date().toISOString(),
      reportGenerated: false,
      status: 'form', 
    };
    setCurrentSession(initialSession);
    await handleFetchQuestions(initialSession, true); 
  };

  const handleAnswerChange = (answerText: string) => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0) return;

    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];

    if (!questionDef) {
        console.error("Current question definition is undefined at index:", qIndex);
        setError("An internal error occurred: Could not find current question. Please try refreshing.");
        return;
    }
    
    const newResponse: ResponseData = {
      questionId: questionDef.id,
      questionText: questionDef.questionText,
      answerText: answerText,
      timestamp: new Date().toISOString(),
      nepraCategory: questionDef.category, // Or potentially AI-derived category later
      riskLevel: 'not_assessed', 
    };
    
    setCurrentSession(prev => {
      if (!prev) return null;
      const updatedResponses = { ...prev.responses, [questionDef.id]: newResponse };
      return { ...prev, responses: updatedResponses };
    });
  };
  
  const saveCurrentProgress = useCallback(async () => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0) {
      toast({ title: "Save Error", description: "No active session or questions to save.", variant: "destructive"});
      return;
    }
  
    const qIndex = currentSession.currentQuestionIndex;
    if (qIndex < 0 || qIndex >= currentSession.questions.length) {
        console.warn("Invalid question index for saving progress:", qIndex);
        return;
    }
    const questionDef = currentSession.questions[qIndex];
    if (!questionDef) {
      console.warn("Question definition not found at index for saving progress:", qIndex);
      return;
    }

    const currentResponse = currentSession.responses[questionDef.id];
  
    if (currentResponse) {
      try {
        await addResponseToSession(currentSession.sessionId, currentResponse);
        saveActiveSessionReference({ 
            sessionId: currentSession.sessionId, 
            userProfile: currentSession.userProfile,
            currentQuestionIndex: currentSession.currentQuestionIndex 
        });
        await updateComplianceSession(currentSession.sessionId, { 
            currentQuestionIndex: currentSession.currentQuestionIndex,
            // lastSavedTime will be updated in Firestore by addResponseToSession or updateComplianceSession
        });

        toast({
          title: "Progress Saved",
          description: "Your current answer and position have been saved.",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } catch (fsError: any) {
        console.error("Firestore save error:", fsError);
        toast({ title: "Sync Error", description: `Could not save progress to cloud: ${fsError.message}`, variant: "destructive" });
      }
    } else {
       toast({ title: "Nothing to Save", description: "No answer provided for the current question.", variant: "default"});
    }
  }, [currentSession, toast]);


  const handleNextQuestion = async () => {
    if (!currentSession || currentSession.currentQuestionIndex >= currentSession.questions.length - 1) return;
    await saveCurrentProgress(); 
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 } : null);
  };

  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.currentQuestionIndex <= 0) return;
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  const handleSubmitAndGenerateReport = async () => {
    if (!currentSession || !currentSession.userProfile) {
      setError("Session data or user profile is not available. Please fill out the form again.");
      setAppState('form');
      return;
    }
    await saveCurrentProgress(); 

    setIsLoading(true);
    setError(null);
    setAppState('generating_report');

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
    };

    try {
      const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
      setGeneratedReportContent(result.reportContent);

      const completedTime = new Date().toISOString();
      let reportStorageUrl = '';
      if (result.reportContent) {
        try {
          reportStorageUrl = await uploadReportToStorage(currentSession.sessionId, result.reportContent, `compliance_report_${currentSession.sessionId}.md`);
          toast({ title: "Report Uploaded", description: "Compliance report saved to secure storage."});
        } catch (storageError: any) {
          console.error("Error uploading report to storage:", storageError);
          toast({ title: "Storage Error", description: `Could not upload report: ${storageError.message}. It is available locally.`, variant: "destructive"});
        }
      }
      
      const updatedSessionOnComplete: Partial<ComplianceSession> = { 
        reportGenerated: true, 
        completedTime: completedTime,
        reportUrl: reportStorageUrl || undefined, 
        status: 'report_ready'
      };
      setCurrentSession(prev => prev ? {...prev, ...updatedSessionOnComplete, status: 'report_ready'} as ComplianceSession : null);
      await updateComplianceSession(currentSession.sessionId, updatedSessionOnComplete);
      clearActiveSessionReference();

    } catch (e: any) {
      console.error("Error generating report:", e);
      setError(`Failed to generate report: ${e.message}.`);
      toast({ title: "Report Generation Failed", description: `Could not generate the report: ${e.message}`, variant: "destructive"});
      setAppState('questionnaire'); 
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNew = () => {
    clearActiveSessionReference(); 
    setCurrentSession(null); 
    setGeneratedReportContent(null);
    setError(null);
    setIsLoading(true); 
    initializeOrResumeApp(); 
  };
  
  if (appState === 'initial' || (isLoading && !currentSession?.sessionId && appState !== 'error') ) {
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }
  
  if (isLoading && (appState === 'generating_report' || (appState === 'questionnaire' && (!currentSession?.questions || currentSession.questions.length === 0)) || (appState === 'form' && !lastPersistedProfile))) {
     return <LoadingSpinner text={
        appState === 'generating_report' ? "Finalizing Report..." 
        : (appState === 'questionnaire' || appState === 'form') ? "Loading Questions & Session..." 
        : "Loading..."
        } className="mt-20" />;
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

      {appState === 'error' && !isLoading && (
         <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Application Initialization Error</AlertTitle>
          <AlertDescription>
            {error || "A critical error occurred during application startup. Please ensure Firebase is correctly configured and try again."}
            <Button onClick={handleStartNew} variant="outline" className="mt-4">Try to Reset and Start New</Button>
          </AlertDescription>
        </Alert>
      )}

      {appState === 'form' && (
        <DepartmentRoleForm
            onSubmit={handleDepartmentRoleSubmit}
            initialProfile={currentSession?.userProfile || lastPersistedProfile}
            isLoading={isLoading} />
      )}

      {appState === 'questionnaire' && currentSession && currentSession.questions && currentSession.questions.length > 0 && (
        <QuestionCard
          question={currentSession.questions[currentSession.currentQuestionIndex]?.questionText || "Loading question..."}
          questionNumber={currentSession.currentQuestionIndex + 1}
          totalQuestions={currentSession.questions.length}
          answer={currentSession.responses[currentSession.questions[currentSession.currentQuestionIndex]?.id]?.answerText || ''}
          onAnswerChange={handleAnswerChange}
          onNext={handleNextQuestion}
          onPrevious={handlePreviousQuestion}
          onSaveProgress={saveCurrentProgress}
          onSubmitAll={handleSubmitAndGenerateReport}
          isFirstQuestion={currentSession.currentQuestionIndex === 0}
          isLastQuestion={currentSession.currentQuestionIndex === currentSession.questions.length - 1}
          isLoading={isLoading}
        />
      )}
      
      {appState === 'questionnaire' && currentSession && (!currentSession.questions || currentSession.questions.length === 0) && isLoading && (
        <div className="text-center py-10">
            <LoadingSpinner text="Preparing NEPRA compliance questions for your role..."/>
            <p className="mt-4 text-muted-foreground">If this takes too long, please check your role/department selection or connection.</p>
        </div>
      )}

      {appState === 'report_ready' && generatedReportContent && (
        <ReportDisplay
            report={generatedReportContent}
            onStartNew={handleStartNew}
            reportUrl={currentSession?.reportUrl}
        />
      )}
       
       {appState === 'report_ready' && !generatedReportContent && ( 
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
      
      {(appState !== 'initial' && appState !== 'generating_report' && !(appState === 'error' && !currentSession) ) && (
         <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
