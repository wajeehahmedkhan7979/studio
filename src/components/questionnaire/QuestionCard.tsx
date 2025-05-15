'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, ArrowLeft, ArrowRight, Save, FileText, MessageSquareQuote } from 'lucide-react';
import type { ChangeEvent } from 'react';

interface QuestionCardProps {
  question: string;
  questionNumber: number;
  totalQuestions: number;
  answer: string;
  onAnswerChange: (answer: string) => void;
  onNext: () => void;
  onPrevious: ()  => void;
  onSaveProgress: () => void;
  onSubmitAll: () => void;
  isFirstQuestion: boolean;
  isLastQuestion: boolean;
  isLoading?: boolean;
}

export function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  answer,
  onAnswerChange,
  onNext,
  onPrevious,
  onSaveProgress,
  onSubmitAll,
  isFirstQuestion,
  isLastQuestion,
  isLoading = false,
}: QuestionCardProps) {

  const handleTextAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onAnswerChange(event.target.value);
  };
  
  const progressValue = totalQuestions > 0 ? (questionNumber / totalQuestions) * 100 : 0;

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <MessageSquareQuote className="w-8 h-8 mr-3 text-primary" />
          Question {questionNumber} of {totalQuestions}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground pt-1">
          Please provide a detailed answer. Your responses help assess security maturity.
          Questions are designed in alignment with relevant cybersecurity frameworks and NEPRA guidelines.
        </CardDescription>
        <Progress value={progressValue} className="w-full mt-2" aria-label={`Progress: ${questionNumber} of ${totalQuestions} questions answered`} />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-lg font-semibold text-foreground">{question}</p>
        <Textarea
          value={answer}
          onChange={handleTextAreaChange}
          placeholder="Type your answer here..."
          rows={6}
          className="text-base resize-none"
          disabled={isLoading}
        />
        {isLoading && <p className="text-sm text-primary">Thinking...</p>}
      </CardContent>
      <CardFooter className="flex flex-col sm:flex-row justify-between items-center gap-4">
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
              <FileText className="w-4 h-4 mr-2" />
              Submit & Generate Report
            </Button>
          ) : (
            <Button onClick={onNext} disabled={isLoading}>
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
