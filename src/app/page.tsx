
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { UserProfile, QuestionnaireData } from '@/lib/types';
import { tailorQuestions, TailorQuestionsInput, TailorQuestionsOutput } from '@/ai/flows/tailor-questions';
import { generateReport, GenerateReportInput, GenerateReportOutput } from '@/ai/flows/generate-report';
import { DepartmentRoleForm } from '@/components/questionnaire/DepartmentRoleForm';
import { QuestionCard } from '@/components/questionnaire/QuestionCard';
import { ReportDisplay } from '@/components/report/ReportDisplay';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  saveUserProfile,
  loadUserProfile,
  saveQuestionnaireProgress,
  loadQuestionnaireProgress,
  clearAllData,
} from '@/lib/storage';

type AppState = 'initial' | 'form' | 'questionnaire' | 'report' | 'loading';

export default function CSMPage() {
  const [appState, setAppState] = useState<AppState>('initial');
  
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({}); // Store answers as Record<number, string>
  
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { toast } = useToast();

  const loadSavedData = useCallback(() => {
    const savedProfile = loadUserProfile();
    const savedProgress = loadQuestionnaireProgress();

    if (savedProfile) {
      setUserProfile(savedProfile);
      if (savedProgress?.questions && savedProgress.questions.length > 0) {
        setQuestions(savedProgress.questions);
        setAnswers(savedProgress.answers || {});
        setCurrentQuestionIndex(savedProgress.currentQuestionIndex || 0);
        if (Object.keys(savedProgress.answers || {}).length === savedProgress.questions.length && savedProgress.questions.length > 0) {
          // If all questions answered, consider if we should show report or questionnaire
          // For now, let's go to questionnaire, user can submit again
           setAppState('questionnaire');
        } else {
           setAppState('questionnaire');
        }
        return;
      }
      // If profile exists but no questionnaire progress, fetch questions
      if (savedProfile.department && savedProfile.role) { // Ensure department and role exist
         handleFetchQuestions(savedProfile);
      } else {
         setAppState('form'); // if essential profile info missing, go to form
      }
      return;
    }
    setAppState('form');
  }, []); // Removed handleFetchQuestions from dependencies to avoid re-triggering

  useEffect(() => {
    loadSavedData();
  }, [loadSavedData]);

  const handleFetchQuestions = async (profile: UserProfile) => {
    setIsLoading(true);
    setError(null);
    setAppState('loading');
    try {
      const tailorInput: TailorQuestionsInput = { department: profile.department, role: profile.role };
      const result: TailorQuestionsOutput = await tailorQuestions(tailorInput);
      const fetchedQuestions = result.questions || [];
      setQuestions(fetchedQuestions);
      setAnswers({}); // Reset answers for new questions
      setCurrentQuestionIndex(0);
      saveQuestionnaireProgress({ questions: fetchedQuestions, answers: {}, currentQuestionIndex: 0 });
      setAppState('questionnaire');
    } catch (e) {
      console.error("Error tailoring questions:", e);
      setError('Failed to load questions. Please try again.');
      toast({
        title: "Error",
        description: "Could not fetch questions. Please check your connection or try again later.",
        variant: "destructive",
      });
      setAppState('form'); // Go back to form on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleDepartmentRoleSubmit = (profile: UserProfile) => {
    setUserProfile(profile);
    saveUserProfile(profile);
    // Check if questions are already loaded for this profile from progress
    const savedProgress = loadQuestionnaireProgress();
    if (savedProgress && savedProgress.profile?.department === profile.department && savedProgress.profile?.role === profile.role && savedProgress.questions?.length) {
        setQuestions(savedProgress.questions);
        setAnswers(savedProgress.answers || {});
        setCurrentQuestionIndex(savedProgress.currentQuestionIndex || 0);
        setAppState('questionnaire');
    } else {
        handleFetchQuestions(profile);
    }
  };

  const handleAnswerChange = (answerText: string) => {
    setAnswers(prev => ({ ...prev, [currentQuestionIndex]: answerText }));
  };

  const saveCurrentProgress = useCallback(() => {
    if (userProfile) {
      const progress: Partial<QuestionnaireData> = {
        profile: userProfile,
        questions,
        answers,
        currentQuestionIndex,
      };
      saveQuestionnaireProgress(progress);
      toast({
        title: "Progress Saved",
        description: "Your current answers and position have been saved.",
        action: <CheckCircle2 className="text-green-500" />,
      });
    }
  }, [userProfile, questions, answers, currentQuestionIndex, toast]);

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      saveCurrentProgress(); 
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const handleSubmitAndGenerateReport = async () => {
    saveCurrentProgress(); // Save final answers
    setIsLoading(true);
    setError(null);
    setAppState('loading');

    if (!userProfile) {
      setError("User profile is not available. Please fill out the form again.");
      setIsLoading(false);
      setAppState('form');
      return;
    }
    
    // Convert answers keys from number to string for Zod record(z.string())
    const stringKeyAnswers: Record<string, string> = {};
    for (const key in answers) {
      if (answers.hasOwnProperty(key)) {
        stringKeyAnswers[key.toString()] = answers[parseInt(key)];
      }
    }

    const reportInput: GenerateReportInput = {
      userProfile: userProfile,
      questionnaireData: {
        questions: questions,
        answers: stringKeyAnswers,
      },
    };

    try {
      const result: GenerateReportOutput = await generateReport(reportInput);
      setGeneratedReport(result.report);
      setAppState('report');
      // Optionally clear progress after successful report generation for a truly "new" start next time
      // clearQuestionnaireProgress(); 
    } catch (e) {
      console.error("Error generating report:", e);
      setError('Failed to generate report. Please try again.');
      toast({
        title: "Report Generation Failed",
        description: "Could not generate the report. Please try again later.",
        variant: "destructive",
      });
      setAppState('questionnaire'); // Go back to questionnaire
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNew = () => {
    clearAllData();
    setUserProfile(null);
    setQuestions([]);
    setAnswers({});
    setCurrentQuestionIndex(0);
    setGeneratedReport(null);
    setError(null);
    setAppState('form');
  };

  // Ensure loadSavedData's handleFetchQuestions call doesn't create infinite loops
  useEffect(() => {
    if (appState === 'initial') {
        const savedProfile = loadUserProfile();
        if (savedProfile && savedProfile.department && savedProfile.role) {
            const savedProgress = loadQuestionnaireProgress();
            if (savedProgress?.questions && savedProgress.questions.length > 0 && savedProgress.profile?.department === savedProfile.department && savedProgress.profile?.role === savedProfile.role) {
                // Already handled by loadSavedData
            } else {
                // handleFetchQuestions(savedProfile); // This line might be problematic if loadSavedData also calls it.
                                                // loadSavedData is designed to call it if profile exists but no questions.
            }
        }
    }
  }, [appState]);


  if (appState === 'initial' || (appState === 'loading' && !questions.length && !generatedReport && !userProfile?.department)) { // Check userProfile for readiness
    return <LoadingSpinner text="Initializing CSM AI Assistant..." className="mt-20" />;
  }
  
  if (isLoading && appState === 'loading') {
     return <LoadingSpinner text={generatedReport ? "Generating Report..." : (userProfile?.department ? "Loading Questions..." : "Processing...")} className="mt-20" />;
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
        <DepartmentRoleForm onSubmit={handleDepartmentRoleSubmit} initialProfile={userProfile} isLoading={isLoading} />
      )}

      {appState === 'questionnaire' && questions.length > 0 && userProfile && (
        <QuestionCard
          question={questions[currentQuestionIndex]}
          questionNumber={currentQuestionIndex + 1}
          totalQuestions={questions.length}
          answer={answers[currentQuestionIndex] || ''}
          onAnswerChange={handleAnswerChange}
          onNext={handleNextQuestion}
          onPrevious={handlePreviousQuestion}
          onSaveProgress={saveCurrentProgress}
          onSubmitAll={handleSubmitAndGenerateReport}
          isFirstQuestion={currentQuestionIndex === 0}
          isLastQuestion={currentQuestionIndex === questions.length - 1}
          isLoading={isLoading}
        />
      )}
      
      {appState === 'questionnaire' && questions.length === 0 && userProfile && !isLoading && (
        <div className="text-center py-10">
            <LoadingSpinner text="Preparing questions for your role..."/>
            <p className="mt-4 text-muted-foreground">If this takes too long, please try refreshing or starting over.</p>
        </div>
      )}


      {appState === 'report' && generatedReport && (
        <ReportDisplay report={generatedReport} onStartNew={handleStartNew} />
      )}
      
      {(appState === 'questionnaire' || appState === 'form' || appState === 'report') && (
         <div className="text-center mt-8">
          <Button variant="outline" onClick={handleStartNew} className="text-destructive hover:text-destructive/80 border-destructive hover:border-destructive/80">
            Reset and Start New Questionnaire
          </Button>
        </div>
      )}
    </div>
  );
}
