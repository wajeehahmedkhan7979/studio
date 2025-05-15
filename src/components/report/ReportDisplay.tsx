'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReportDisplayProps {
  report: string;
  onStartNew: () => void;
}

export function ReportDisplay({ report, onStartNew }: ReportDisplayProps) {
  // Basic Markdown-like to HTML conversion (for paragraphs and newlines)
  const formatReport = (text: string) => {
    return text.split('\n').map((paragraph, index) => (
      paragraph.trim() === '' ? <br key={`br-${index}`} /> : <p key={`p-${index}`} className="mb-2 last:mb-0">{paragraph}</p>
    ));
  };

  return (
    <Card className="w-full max-w-3xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <FileText className="w-8 h-8 mr-3 text-primary" />
          Security Assessment Report
        </CardTitle>
        <CardDescription>
          This report summarizes your responses and provides an overview of the assessment.
        </CardDescription>
      </CardHeader>
      <CardContent className="prose prose-sm sm:prose-base max-w-none dark:prose-invert">
        {formatReport(report)}
      </CardContent>
      <CardFooter>
        <Button onClick={onStartNew} className="w-full sm:w-auto">
          Start New Questionnaire
        </Button>
      </CardFooter>
    </Card>
  );
}
