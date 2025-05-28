
'use client';

import React, { type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { ArrowLeft, ArrowRight, Save, FileText, MessageSquareQuote, CheckCircle, Info } from 'lucide-react';

interface QuestionCardProps {
  question: string; // Full question text, potentially with NEPRA hint prepended
  questionNumber: number;
  totalQuestions: number;
  
  answerText: string;
  onAnswerTextChange: (text: string) => void;
  
  policyMaturityScore: number;
  onPolicyMaturityScoreChange: (score: number) => void;
  
  practiceMaturityScore: number;
  onPracticeMaturityScoreChange: (score: number) => void;
  
  onNext: () => void;
  onPrevious: ()  => void;
  onSaveProgress: () => void;
  onSubmitAll: () => void;
  
  isFirstQuestion: boolean;
  isLastQuestion: boolean;
  isLoading?: boolean;
}

const sliderLabels = {
  0: "No policy/implementation",
  2.5: "Basic awareness",
  5: "Somewhat defined, inconsistently applied",
  7.5: "Largely defined & applied",
  10: "Fully defined, implemented, reviewed & optimized",
};

export function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  answerText,
  onAnswerTextChange,
  policyMaturityScore,
  onPolicyMaturityScoreChange,
  practiceMaturityScore,
  onPracticeMaturityScoreChange,
  onNext,
  onPrevious,
  onSaveProgress,
  onSubmitAll,
  isFirstQuestion,
  isLastQuestion,
  isLoading = false,
}: QuestionCardProps) {

  const handleAnswerTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onAnswerTextChange(event.target.value);
  };

  const handlePolicySliderChange = (value: number[]) => {
    onPolicyMaturityScoreChange(value[0]);
  };

  const handlePracticeSliderChange = (value: number[]) => {
    onPracticeMaturityScoreChange(value[0]);
  };
  
  const progressValue = totalQuestions > 0 ? (questionNumber / totalQuestions) * 100 : 0;

  const renderSliderDescription = (score: number) => {
    if (score <= 0) return sliderLabels[0];
    if (score > 0 && score <= 2.5) return sliderLabels[2.5];
    if (score > 2.5 && score <= 5) return sliderLabels[5];
    if (score > 5 && score <= 7.5) return sliderLabels[7.5];
    return sliderLabels[10];
  };

  // Extract hint if present (starts with 🛈)
  const hintPrefix = "🛈";
  let displayQuestion = question;
  let hintText = "";
  if (question && question.startsWith(hintPrefix)) {
    const firstNewline = question.indexOf('\n');
    if (firstNewline > -1) {
        hintText = question.substring(hintPrefix.length, firstNewline).trim();
        displayQuestion = question.substring(firstNewline + 1).trim();
    } else { // Entire string is a hint or malformed
        hintText = question.substring(hintPrefix.length).trim();
        displayQuestion = ""; // Or some default text
    }
  }


  return (
    <Card className="w-full max-w-3xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <MessageSquareQuote className="w-8 h-8 mr-3 text-primary" />
          Question {questionNumber} of {totalQuestions}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground pt-1">
          Provide your answer and rate policy & practice maturity.
        </CardDescription>
        <Progress value={progressValue} className="w-full mt-2" aria-label={`Progress: ${questionNumber} of ${totalQuestions} questions answered`} />
      </CardHeader>
      <CardContent className="space-y-6">
        {hintText && (
          <div className="p-3 mb-4 text-sm rounded-md bg-accent/20 text-accent-foreground border border-accent/50 flex items-start">
            <Info className="w-5 h-5 mr-2 mt-0.5 shrink-0 text-accent" />
            <p><span className="font-semibold">NEPRA Context:</span> {hintText}</p>
          </div>
        )}
        <p className="text-lg font-semibold text-foreground">{displayQuestion || "Loading question..."}</p>
        
        <div>
          <Label htmlFor={`answer-${questionNumber}`} className="text-base font-medium">Your Answer:</Label>
          <Textarea
            id={`answer-${questionNumber}`}
            value={answerText}
            onChange={handleAnswerTextAreaChange}
            placeholder="Type your detailed answer here..."
            rows={5}
            className="mt-1 text-base resize-none"
            disabled={isLoading}
          />
        </div>

        <div className="space-y-4">
          <Label htmlFor={`policy-score-${questionNumber}`} className="text-base font-medium">Policy Maturity Score: <span className="font-bold text-primary">{policyMaturityScore.toFixed(1)}</span></Label>
          <Slider
            id={`policy-score-${questionNumber}`}
            defaultValue={[5]}
            value={[policyMaturityScore]}
            min={0}
            max={10}
            step={0.5}
            onValueChange={handlePolicySliderChange}
            disabled={isLoading}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground text-center">{renderSliderDescription(policyMaturityScore)}</p>
        </div>

        <div className="space-y-4">
          <Label htmlFor={`practice-score-${questionNumber}`} className="text-base font-medium">Practice Maturity Score: <span className="font-bold text-primary">{practiceMaturityScore.toFixed(1)}</span></Label>
          <Slider
            id={`practice-score-${questionNumber}`}
            defaultValue={[5]}
            value={[practiceMaturityScore]}
            min={0}
            max={10}
            step={0.5}
            onValueChange={handlePracticeSliderChange}
            disabled={isLoading}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground text-center">{renderSliderDescription(practiceMaturityScore)}</p>
        </div>
        
        {isLoading && <p className="text-sm text-center text-primary">Processing...</p>}
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6">
        <Button variant="outline" onClick={onSaveProgress} disabled={isLoading}>
          <Save className="w-4 h-4 mr-2" />
          Save Progress
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onPrevious} disabled={isFirstQuestion || isLoading}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>
          {isLastQuestion ? (
            <Button onClick={onSubmitAll} disabled={isLoading} className="bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle className="w-4 h-4 mr-2" />
              Submit All & Generate Report
            </Button>
          ) : (
            <Button onClick={onNext} disabled={isLoading}>
              Next Question
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
