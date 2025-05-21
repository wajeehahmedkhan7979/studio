
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


export default function NepraCompliancePage() {
  const [currentSession, setCurrentSession] = useState<ComplianceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start true for initial load
  const [error, setError] = useState<string | null>(null);
  const [generatedReportContent, setGeneratedReportContent] = useState<string | null>(null);
  const [lastPersistedProfile, setLastPersistedProfile] = useState<UserProfile | null>(null);

  const { toast } = useToast();

  const appState = currentSession?.status || 'initial';

  const handleFetchQuestions = useCallback(async (sessionToUpdate: ComplianceSession, isNewSession: boolean): Promise<boolean> => {
    let fetchSuccess = false;
    console.log("HFQ: Initiating handleFetchQuestions. isNewSession:", isNewSession, "Session to update ID:", sessionToUpdate.sessionId);
    if (!sessionToUpdate.userProfile.department || !sessionToUpdate.userProfile.role) {
      console.error("HFQ: Department and Role are required to fetch questions.");
      setError("Department and Role are required to fetch questions.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form'});
      setIsLoading(false);
      return false;
    } 
    
    if (!isLoading) setIsLoading(true); 
    console.log("HFQ: setIsLoading(true) if it wasn't already. Current status before AI call:", sessionToUpdate.status);
    
    // Tentatively set status; might revert if AI/DB ops fail
    const targetStatus = (appState === 'form' && isNewSession) ? 'form' : 'questionnaire';
    setCurrentSession(prev => prev ? { ...prev, status: targetStatus } : { ...sessionToUpdate, status: targetStatus });

    try {
      const tailorInput: TailorNepraQuestionsInput = {
        department: sessionToUpdate.userProfile.department,
        role: sessionToUpdate.userProfile.role,
      };
      console.log("HFQ: Calling tailorNepraQuestions with input:", tailorInput);
      const result: TailoredQuestionsOutput = await tailorNepraQuestions(tailorInput);
      console.log("HFQ: tailorNepraQuestions returned:", result);
      
      const fetchedQuestionTexts = result.questions || [];
      if (fetchedQuestionTexts.length === 0 || (fetchedQuestionTexts.length === 1 && fetchedQuestionTexts[0].startsWith("Error:"))) {
        let errorMessage = fetchedQuestionTexts[0] || 'No questions were returned for your department/role. Please try again or contact support.';
         if (errorMessage.toLowerCase().includes("overloaded") || errorMessage.toLowerCase().includes("service unavailable") || errorMessage.includes("503") || errorMessage.toLowerCase().includes("model is overloaded")) {
            errorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
        }
        console.error("HFQ: Error from AI or no questions:", errorMessage);
        setError(errorMessage);
        toast({ title: "Error Fetching Questions", description: errorMessage, variant: "destructive" });
        setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
        fetchSuccess = false;
      } else {
        console.log("HFQ: Successfully fetched questions:", fetchedQuestionTexts.length);
        const questionDefinitions: QuestionDefinition[] = fetchedQuestionTexts.map((qText, index) => ({
          id: `q_${sessionToUpdate.sessionId}_${index}`,
          questionText: qText,
          category: "NEPRA Compliance", 
        }));
        console.log("HFQ: Mapped questions definitions:", questionDefinitions.length);

        const updatedSessionData: ComplianceSession = {
          ...sessionToUpdate,
          questions: questionDefinitions,
          responses: isNewSession ? {} : sessionToUpdate.responses,
          currentQuestionIndex: isNewSession ? 0 : Math.min(sessionToUpdate.currentQuestionIndex || 0, questionDefinitions.length -1),
          status: 'questionnaire'
        };
        setCurrentSession(updatedSessionData); 
        console.log("HFQ: Current session updated with questions. Session status:", updatedSessionData.status);
        
        let dbOperationSuccessful = true;
        if (isNewSession) {
            console.log("HFQ: Calling startNewComplianceSession for new session...");
            try {
                await startNewComplianceSession(updatedSessionData);
                console.log("HFQ: startNewComplianceSession completed.");
            } catch (dbError: any) {
                console.error("HFQ: Error during startNewComplianceSession:", dbError);
                const dbErrorMessage = `Failed to save new session to database: ${dbError.message}. Please check Firestore setup and security rules.`;
                setError(dbErrorMessage);
                toast({ title: "Database Error", description: `Could not start new session: ${dbError.message}`, variant: "destructive" });
                // CRITICAL: Revert state if session creation failed, preserving user input
                setCurrentSession(prev => ({
                    userProfile: (prev || updatedSessionData).userProfile, // Keep user profile
                    sessionId: generateSessionId(), // Generate a NEW id to avoid reuse of failed one
                    questions: [],
                    responses: {},
                    currentQuestionIndex: 0,
                    startTime: new Date().toISOString(),
                    reportGenerated: false,
                    status: 'form' // Revert to form
                }));
                dbOperationSuccessful = false;
            }
        } else { 
            console.log("HFQ: Calling updateComplianceSession for existing session's questions...");
            try {
                await updateComplianceSession(updatedSessionData.sessionId, { questions: questionDefinitions });
                console.log("HFQ: updateComplianceSession completed for questions.");
            } catch (dbError: any) {
                console.error("HFQ: Error during updateComplianceSession for questions:", dbError);
                setError(`Failed to update session questions in database: ${dbError.message}.`);
                toast({ title: "Database Error", description: `Could not update session questions: ${dbError.message}`, variant: "destructive" });
                dbOperationSuccessful = false;
            }
        }

        if (dbOperationSuccessful) {
            saveActiveSessionReference({ 
                sessionId: updatedSessionData.sessionId, 
                userProfile: updatedSessionData.userProfile, 
                currentQuestionIndex: updatedSessionData.currentQuestionIndex 
            });
            setError(null); 
            console.log("HFQ: AI and DB operations successfully completed.");
            fetchSuccess = true;
        } else {
            fetchSuccess = false;
        }
      }
    } catch (e: any) {
      console.error("HFQ: Error caught in handleFetchQuestions:", e);
      let userErrorMessage = 'Failed to load questions. Please check your connection or try again.';
      if (e.message?.includes("503") || e.message?.toLowerCase().includes("service unavailable") || e.message?.toLowerCase().includes("model is overloaded")) {
        userErrorMessage = "AI Service Overloaded: The AI service is currently experiencing high demand. Please try again in a few minutes.";
      } else if (e.message?.toLowerCase().includes("firestore") || e.message?.toLowerCase().includes("firebase")){
        userErrorMessage = `Firebase error during question processing: ${e.message}. Please ensure Firebase is configured and running, and check security rules.`;
      }
      setError(userErrorMessage);
      toast({ title: "Error", description: userErrorMessage, variant: "destructive" });
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : { ...sessionToUpdate, status: 'form' });
      fetchSuccess = false;
    } finally {
      console.log("HFQ: Setting isLoading to false in finally block. fetchSuccess:", fetchSuccess);
      setIsLoading(false); 
    }
    return fetchSuccess;
  }, [toast, setIsLoading, setError, setCurrentSession, appState, isLoading]); // Added appState, isLoading

  const initializeOrResumeApp = useCallback(async () => {
    console.log("Initializing or resuming app...");
    setIsLoading(true); 
    setError(null);
    
    if (!isFirebaseInitialized) {
      console.error("Firebase not initialized. Setting error state.");
      setError("CRITICAL: Firebase is not configured. Please ensure all NEXT_PUBLIC_FIREBASE_... environment variables are set correctly in your .env file. Application features relying on Firebase will not work.");
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
      setIsLoading(false);
      return; 
    }
    
    const savedProfile = loadUserProfileFromStorage();
    setLastPersistedProfile(savedProfile);
    console.log("Loaded saved profile:", savedProfile);

    const activeSessionRef = loadActiveSessionReference();
    console.log("Loaded active session reference:", activeSessionRef);
    
    if (activeSessionRef?.sessionId) {
      try {
        console.log(`Attempting to resume session: ${activeSessionRef.sessionId}`);
        const firestoreSession = await getComplianceSession(activeSessionRef.sessionId);
        console.log("Fetched session from Firestore:", firestoreSession ? firestoreSession.sessionId : "null");

        if (firestoreSession) {
          if (firestoreSession.status === 'completed' || firestoreSession.reportGenerated) {
             let reportContentToDisplay = "Previously generated report.";
             if (firestoreSession.reportUrl) {
                try {
                    // In a real scenario, you might fetch/show a snippet or confirm access
                    reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}`;
                } catch (fetchError) {
                    console.error("Error fetching stored report:", fetchError);
                    reportContentToDisplay = `Report available at: ${firestoreSession.reportUrl}. Error fetching preview.`;
                }
             }
             setGeneratedReportContent(reportContentToDisplay);
             setCurrentSession({ ...firestoreSession, status: 'report_ready' });
             setIsLoading(false);
             console.log("Resumed completed session, report ready.");
             return;
          } else { 
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
            console.log("Resumed in-progress session:", updatedSession.sessionId);

            if ((!firestoreSession.questions || firestoreSession.questions.length === 0) && firestoreSession.userProfile.department && firestoreSession.userProfile.role) {
                console.log("Session exists but questions are missing. Attempting to fetch questions...");
                const fetchSuccess = await handleFetchQuestions(updatedSession, false); 
                if (!fetchSuccess) {
                 console.log("Failed to fetch questions during resume. Reverting to form.");
                 setCurrentSession({
                     sessionId: generateSessionId(),
                     userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                     questions: [], responses: {}, currentQuestionIndex: 0, 
                     startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
                 });
                 setIsLoading(false);
                }
            } else if (firestoreSession.questions && firestoreSession.questions.length > 0) {
                console.log("Session and questions exist. Ready for questionnaire.");
                setIsLoading(false);
            } else { 
                 console.log("Session exists, but questions missing and no profile info. Reverting to form.");
                 setCurrentSession({
                    sessionId: generateSessionId(),
                    userProfile: savedProfile || { name: '', email: '', department: '', role: '' },
                    questions: [], responses: {}, currentQuestionIndex: 0, 
                    startTime: new Date().toISOString(), reportGenerated: false, status: 'form'
                 });
                 setIsLoading(false);
            }
            return; 
          }
        } else { 
          console.log("No session found in Firestore for ID:", activeSessionRef.sessionId, ". Starting fresh.");
          clearActiveSessionReference();
        }
      } catch (e: any) {
        console.error("Error resuming session from Firestore:", e);
        setError(`Failed to resume session: ${e.message}. Starting fresh. Ensure Firebase is configured, and check security rules.`);
        toast({ title: "Session Resume Error", description: `Could not resume: ${e.message}`, variant: "destructive" });
        clearActiveSessionReference(); 
      }
    }
    
    console.log("No active session or error in resume. Initializing a new session object for form.");
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
    console.log("App initialized to form state.");
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
    console.log("Submitting department/role form with profile:", profile);
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
    console.log("DepartmentRoleSubmit: Initial session object created, status 'form'. Calling handleFetchQuestions.");
    
    const success = await handleFetchQuestions(initialSession, true); 
    if (!success) {
        setIsLoading(false); 
        console.log("DepartmentRoleSubmit: handleFetchQuestions failed. State should be 'form' or an error displayed.");
    }
    console.log("DepartmentRoleSubmit: handleFetchQuestions completed.");
  };

  const handleAnswerChange = (answerText: string) => {
    if (!currentSession || !currentSession.questions || currentSession.questions.length === 0) return;

    const qIndex = currentSession.currentQuestionIndex;
    const questionDef = currentSession.questions[qIndex];

    if (!questionDef) {
        console.error("An internal error occurred: Could not find current question definition at index:", qIndex);
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
      setIsLoading(true); 
      console.log("SaveProgress: setIsLoading(true)");
      try {
        console.log("Saving progress: Adding response for questionId:", currentResponse.questionId);
        await addResponseToSession(currentSession.sessionId, currentResponse);
        console.log("Saving progress: Response added. Updating session currentQuestionIndex.");
        
        saveActiveSessionReference({ 
            sessionId: currentSession.sessionId, 
            userProfile: currentSession.userProfile,
            currentQuestionIndex: currentSession.currentQuestionIndex 
        });
        await updateComplianceSession(currentSession.sessionId, { 
            currentQuestionIndex: currentSession.currentQuestionIndex,
        });
        console.log("Saving progress: Session updated.");
        toast({
          title: "Progress Saved",
          description: "Your current answer and position have been saved.",
          action: <CheckCircle2 className="text-green-500" />,
        });
      } catch (fsError: any) {
        console.error("Firestore save error:", fsError);
        toast({ title: "Sync Error", description: `Could not save progress to cloud: ${fsError.message}. Check Firebase setup and rules.`, variant: "destructive" });
      } finally {
        setIsLoading(false); 
        console.log("SaveProgress: setIsLoading(false)");
      }
    } else {
       toast({ title: "Nothing to Save", description: "No answer provided for the current question.", variant: "default"});
    }
  }, [currentSession, toast, setIsLoading]);


  const handleNextQuestion = async () => {
    if (!currentSession || currentSession.currentQuestionIndex >= currentSession.questions.length - 1) return;
    
    setIsLoading(true); 
    console.log("Next Question: Attempting to save current progress before moving. setIsLoading(true)");
    try {
      await saveCurrentProgress(); 
      console.log("Next Question: Progress saved. Moving to next question.");
      setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 } : null);
    } catch (error) {
        console.error("Error during saveCurrentProgress in handleNextQuestion:", error);
    } finally {
        setIsLoading(false); 
        console.log("Next Question: setIsLoading(false)");
    }
  };

  const handlePreviousQuestion = () => {
    if (!currentSession || currentSession.currentQuestionIndex <= 0) return;
    setCurrentSession(prev => prev ? { ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 } : null);
  };

  const handleSubmitAndGenerateReport = async () => {
    if (!currentSession || !currentSession.userProfile) {
      setError("Session data or user profile is not available. Please fill out the form again.");
      setCurrentSession(prev => prev ? { ...prev, status: 'form' } : null);
      setIsLoading(false); 
      return;
    }
    
    setIsLoading(true); 
    console.log("Submit & Generate Report: Saving final progress. setIsLoading(true)");
    setError(null);

    try {
        await saveCurrentProgress(); 
        setCurrentSession(prev => prev ? { ...prev, status: 'generating_report' } : null);
        console.log("Submit & Generate Report: Status set to 'generating_report'. Preparing report input.");

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
        console.log("Submit & Generate Report: Calling generateNepraReport with input:", reportInput.sessionId);

        const result: GenerateNepraReportOutput = await generateNepraReport(reportInput);
        console.log("Submit & Generate Report: Report generated by AI:", result.reportContent ? "Content received" : "No content");
        setGeneratedReportContent(result.reportContent);

        const completedTime = new Date().toISOString();
        let reportStorageUrl = '';
        if (result.reportContent) {
            try {
            console.log("Submit & Generate Report: Uploading report to storage.");
            reportStorageUrl = await uploadReportToStorage(currentSession.sessionId, result.reportContent, `compliance_report_${currentSession.sessionId}.md`);
            console.log("Submit & Generate Report: Report uploaded. URL:", reportStorageUrl);
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
        console.log("Submit & Generate Report: Updating session in Firestore as complete.");
        await updateComplianceSession(currentSession.sessionId, updatedSessionOnComplete);
        clearActiveSessionReference(); 
        console.log("Submit & Generate Report: Process complete.");

    } catch (e: any) {
      console.error("Error during report generation process:", e);
      setError(`Failed to generate or finalize report: ${e.message}.`);
      toast({ title: "Report Finalization Failed", description: `Could not complete the report process: ${e.message}`, variant: "destructive"});
      setCurrentSession(prev => prev ? { ...prev, status: 'questionnaire' } : null); 
    } finally {
      setIsLoading(false);
      console.log("Submit & Generate Report: setIsLoading(false)");
    }
  };

  const handleStartNew = () => {
    console.log("Handle Start New: Clearing session references and resetting state.");
    clearActiveSessionReference(); 
    setCurrentSession(null); 
    setGeneratedReportContent(null);
    setError(null);
    initializeOrResumeApp(); 
  };
  
  if (appState === 'initial' && isLoading && !error) { // Added !error
    return <LoadingSpinner text={"Initializing Compliance Agent..."} className="mt-20" />;
  }
  
  if (isLoading && 
      (appState === 'generating_report' || 
      (appState === 'questionnaire' && (!currentSession?.questions || currentSession.questions.length === 0)) || 
      (appState === 'form' && !currentSession?.userProfile.department && !error) // More specific: form loading only if no dept/role yet
      ) && !error ) { // Added !error to prevent spinner over error message
     return <LoadingSpinner text={
        appState === 'generating_report' ? "Finalizing Report..." 
        : (appState === 'questionnaire' || appState === 'form') ? "Loading Questions & Session..." 
        : "Loading..."
        } className="mt-20" />;
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
          <AlertTitle>Error</AlertTitle>
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
          onSubmitAll={handleSubmitAndGenerateReport}
          isFirstQuestion={currentSession.currentQuestionIndex === 0}
          isLastQuestion={currentSession.currentQuestionIndex === currentSession.questions.length - 1}
          isLoading={isLoading} 
        />
      )}
      
      {isFirebaseInitialized && appState === 'questionnaire' && currentSession && (!currentSession.questions || currentSession.questions.length === 0) && isLoading && !error && (
        <div className="text-center py-10">
            <LoadingSpinner text="Preparing NEPRA compliance questions for your role..."/>
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
      
      {(appState !== 'initial' && appState !== 'generating_report' && !(appState === 'error' && !isFirebaseInitialized) ) && (
         <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
    
