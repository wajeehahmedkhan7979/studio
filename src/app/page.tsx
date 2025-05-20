
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
  clearAllNepraData,
  generateSessionId,
} from '@/lib/storage';

import {
  startNewComplianceSession,
  getComplianceSession,
  addResponseToSession,
  updateComplianceSession,
  uploadReportToStorage,
  // getNepraQuestions // Example if fetching predefined questions
} from '@/lib/firebaseService'; // Using MOCK firebaseService

export default function NepraCompliancePage() {
  const [currentSession, setCurrentSession] = useState<ComplianceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start true for initial load check
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);


  const { toast } = useToast();

  const setAppState = (status: ComplianceSession['status']) => {
    setCurrentSession(prev => prev ? { ...prev, status } : null);
  };
  const appState = currentSession?.status || 'initial';


  // Initialize or Resume Session
  const initializeOrResumeApp = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const savedProfile = loadUserProfileFromStorage();
    setLastPersistedProfile(savedProfile);

    const activeSessionRef = loadActiveSessionReference();
    
    if (activeSessionRef?.sessionId) {
      // Try to load session from "Firestore" (mock)
      const firestoreSession = await getComplianceSession(activeSessionRef.sessionId);
      if (firestoreSession && firestoreSession.status !== 'completed') {
        setCurrentSession(firestoreSession);
        // Determine current question index based on responses vs questions
        const numResponses = Object.keys(firestoreSession.responses || {}).length;
        const updatedSession = {
            ...firestoreSession,
            currentQuestionIndex: Math.min(numResponses, firestoreSession.questions.length -1 ),
            status: 'questionnaire' as ComplianceSession['status']
        };
        setCurrentSession(updatedSession);
        setIsLoading(false);
        if (firestoreSession.questions.length === 0 && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
            // If session loaded but no questions, fetch them.
            await handleFetchQuestions(updatedSession, false); // false = not a brand new session
        }
        return;
      } else if (firestoreSession && firestoreSession.status === 'completed') {
         // If session was completed, allow viewing report or starting new
         setGeneratedReportContent("Previously generated report (content would be fetched or regenerated)."); // Placeholder
         setCurrentSession({...firestoreSession, status: 'report_ready'});
         setIsLoading(false);
         return;
      }
    }
    
    // No active session found or resumable, or previous session was completed
    // Go to form, prefill if possible
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
      return;
    }
    setIsLoading(true);
    setError(null);
    setAppState(isNewSession ? 'initial' : 'questionnaire'); // Show loading within questionnaire if resuming

    try {
      const tailorInput: TailorNepraQuestionsInput = {
        department: sessionToUpdate.userProfile.department,
        role: sessionToUpdate.userProfile.role,
      };
      const result: TailoredQuestionsOutput = await tailorNepraQuestions(tailorInput);
      
      const fetchedQuestionTexts = result.questions || [];
      if (fetchedQuestionTexts.length === 0 || (fetchedQuestionTexts.length === 1 && fetchedQuestionTexts[0].startsWith("Error:"))) {
        setError(fetchedQuestionTexts[0] || 'No questions were returned for your department/role. Please try again or contact support.');
        toast({ title: "Error", description: "Could not fetch questions.", variant: "destructive" });
        setAppState('form');
      } else {
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`, // Simple unique ID for the question in this session
          questionText: qText,
          category: "NEPRA Compliance", // Placeholder, AI could categorize
        }));

        const updatedSession = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses, // Clear responses only if new session
          currentQuestionIndex: isNewSession ? 0 : sessionToUpdate.currentQuestionIndex,
          status: 'questionnaire' as ComplianceSession['status']
        };
        setCurrentSession(updatedSession);
        saveActiveSessionReference({ sessionId: updatedSession.sessionId, userProfile: updatedSession.userProfile, currentQuestionIndex: updatedSession.currentQuestionIndex });
        if (isNewSession) {
            await startNewComplianceSession(updatedSession); // Save to mock Firestore
        } else {
            await updateComplianceSession(updatedSession.sessionId, { questions: questionDefinitions }); // Update existing session
        }
      }
    } catch (e: any) {
      console.error("Error tailoring questions:", e);
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      if (e.message?.includes("503") || e.message?.toLowerCase().includes("service unavailable") || e.message?.toLowerCase().includes("model is overloaded")) {
        userErrorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
      }
      setError(userErrorMessage);
      toast({ title: "Error", description: userErrorMessage, variant: "destructive" });
      setAppState('form');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDepartmentRoleSubmit = async (profile: UserProfile) => {
    saveUserProfileToStorage(profile); // Save for future prefill
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
      status: 'initial', // Will transition to questionnaire after fetching questions
    };
    setCurrentSession(initialSession);
    saveActiveSessionReference({ sessionId: newSessionId, userProfile: profile, currentQuestionIndex: 0 });
    await startNewComplianceSession(initialSession); // Save to mock Firestore
    await handleFetchQuestions(initialSession, true); // true = is a brand new session
  };

  const handleAnswerChange = (answerText: string) => {
    if (!currentSession || currentSession.questions.length === 0) return;

    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];

    const newResponse: ResponseData = {
      questionId: questionDef.id,
      questionText: questionDef.questionText,
      answerText: answerText,
      timestamp: new Date().toISOString(),
      nepraCategory: questionDef.category, // Or AI inferred
      riskLevel: 'not_assessed',
    };
    
    setCurrentSession(prev => {
      if (!prev) return null;
      const updatedResponses = { ...prev.responses, [questionDef.id]: newResponse };
      return { ...prev, responses: updatedResponses };
    });
  };
  
  const saveCurrentProgress = useCallback(async () => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0) return;

    const qIndex = currentSession.currentQuestionIndex;
    if (qIndex < 0 || qIndex >= currentSession.questions.length) return; // Ensure qIndex is valid

    const questionDef = currentSession.questions[qIndex];
    const currentResponse = currentSession.responses[questionDef.id];

    if (currentResponse) {
      try {
        await addResponseToSession(currentSession.sessionId, currentResponse);
        // Also update local storage marker for current index
        saveActiveSessionReference({ 
            sessionId: currentSession.sessionId, 
            userProfile: currentSession.userProfile,
            currentQuestionIndex: currentSession.currentQuestionIndex 
        });
        toast({
          title: "Progress Saved",
          description: "Your current answer and position have been saved.",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } catch (fsError) {
        console.error("Firestore save error (mock):", fsError);
        toast({ title: "Sync Error", description: "Could not save progress to cloud (mock).", variant: "destructive" });
      }
    } else {
        // console.warn("No current response to save for question index:", qIndex);
    }
  }, [currentSession, toast]);


  const handleNextQuestion = async () => {
    if (!currentSession || currentSession.currentQuestionIndex >= currentSession.questions.length - 1) return;
    await saveCurrentProgress();
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 } : null);
  };

  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.currentQuestionIndex <= 0) return;
    // No need to save on previous, just navigate
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  const handleSubmitAndGenerateReport = async () => {
    if (!currentSession || !currentSession.userProfile) {
      setError("Session data or user profile is not available. Please fill out the form again.");
      setAppState('form');
      return;
    }
    await saveCurrentProgress(); // Save the last answer

    setIsLoading(true);
    setError(null);
    setAppState('generating_report');

    // Prepare data for report generation
    const reportAnswers: Record<string, ReportAnswerDetail> = {};
    currentSession.questions.forEach((qDef, index) => {
      const response = currentSession.responses[qDef.id];
      reportAnswers[index.toString()] = { // Index as string key
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
      try {
        // Placeholder for PDF: for now, upload Markdown content.
        // In a real app, generate PDF then upload.
        reportStorageUrl = await uploadReportToStorage(currentSession.sessionId, result.reportContent);
        toast({ title: "Report Uploaded (Mock)", description: "Compliance report saved to secure storage."});
      } catch (storageError) {
        console.error("Error uploading report to storage (mock):", storageError);
        toast({ title: "Storage Error", description: "Could not upload report (mock). It is available locally.", variant: "destructive"});
      }
      
      const updatedSessionOnComplete: ComplianceSession = { 
        ...currentSession, 
        reportGenerated: true, 
        completedTime: completedTime,
        reportUrl: reportStorageUrl,
        status: 'report_ready'
      };
      setCurrentSession(updatedSessionOnComplete);
      await updateComplianceSession(currentSession.sessionId, {
        reportGenerated: true,
        completedTime: completedTime,
        reportUrl: reportStorageUrl,
        status: 'report_ready'
      });
      clearActiveSessionReference(); // Clear local session marker as it's complete

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
    setCurrentSession(null); // This will trigger re-initialization via useEffect or direct call
    setGeneratedReportContent(null);
    setError(null);
    initializeOrResumeApp(); // Re-initialize to go to form state
  };
  

  if (appState === 'initial' || (isLoading && !currentSession?.sessionId)) {
    return <LoadingSpinner text="Initializing Compliance Agent..." className="mt-20" />;
  }
  
  if (isLoading && (appState === 'generating_report' || (appState === 'questionnaire' && (!currentSession?.questions || currentSession.questions.length === 0)))) {
     return <LoadingSpinner text={appState === 'generating_report' ? "Finalizing Report..." : "Loading Questions..."} className="mt-20" />;
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
            initialProfile={currentSession?.userProfile || lastPersistedProfile}
            isLoading={isLoading} />
      )}

      {appState === 'questionnaire' && currentSession && currentSession.questions.length > 0 && (
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
      
      {appState === 'questionnaire' && currentSession && currentSession.questions.length === 0 && !isLoading && (
        <div className="text-center py-10">
            <LoadingSpinner text="Preparing NEPRA compliance questions for your role..."/>
            <p className="mt-4 text-muted-foreground">If this takes too long, please check your role/department selection and try again.</p>
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
            <Alert variant="destructive" className="max-w-2xl mx-auto">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Report Display Error</AlertTitle>
                <AlertDescription>Report content is not available. Please try generating again or check previous sessions.</AlertDescription>
            </Alert>
       )}
      
      {(appState !== 'initial' && appState !== 'generating_report') && (
         <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive/80 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
