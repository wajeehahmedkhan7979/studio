
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FileText, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReportDisplayProps {
  report: string; // Expecting Markdown string
  onStartNew: () => void;
  reportUrl?: string; // Optional URL for downloading from Firebase Storage
}

export function ReportDisplay({ report, onStartNew, reportUrl }: ReportDisplayProps) {
  // Basic Markdown-like to HTML conversion (for paragraphs, newlines, and simple headers)
  const formatReport = (text: string) => {
    if (!text) return <p>Report content is unavailable.</p>;
    return text.split('\n').map((line, index) => {
      if (line.startsWith('### ')) {
        return <h3 key={`h3-${index}`} className="text-lg font-semibold mt-3 mb-1">{line.substring(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={`h2-${index}`} className="text-xl font-semibold mt-4 mb-2 border-b pb-1">{line.substring(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={`h1-${index}`} className="text-2xl font-bold mt-5 mb-3 border-b pb-2">{line.substring(2)}</h1>;
      }
      if (line.startsWith('- ')) {
        return <li key={`li-${index}`} className="ml-4 list-disc">{line.substring(2)}</li>;
      }
      if (line.trim() === '---') {
        return <hr key={`hr-${index}`} className="my-4"/>;
      }
      return line.trim() === '' ? <br key={`br-${index}`} /> : <p key={`p-${index}`} className="mb-2 last:mb-0">{line}</p>;
    });
  };

  const handleDownload = () => {
    // Create a blob from the report string
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8;' });
    // Create a link element
    const link = document.createElement("a");
    // Set the download attribute with a filename
    link.download = `nepra_compliance_report_${new Date().toISOString().split('T')[0]}.md`;
    // Create a URL for the blob and set it as the href
    link.href = URL.createObjectURL(blob);
    // Append the link to the body
    document.body.appendChild(link);
    // Programmatically click the link to trigger the download
    link.click();
    // Remove the link from the body
document.body.removeChild(link);
    // Revoke the blob URL
    URL.revokeObjectURL(link.href);
  };


  return (
    <Card className="w-full max-w-3xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-2xl">
          <div className="flex items-center">
            <FileText className="w-8 h-8 mr-3 text-primary" />
            NEPRA Compliance Report
          </div>
          <Button variant="outline" onClick={handleDownload} title="Download Report as Markdown">
            <Download className="w-4 h-4 mr-2" />
            Download Report
          </Button>
        </CardTitle>
        <CardDescription>
          This report summarizes the responses for NEPRA compliance. Review carefully.
          {reportUrl && (
            <span className="block mt-1">
              A copy has been stored and can be accessed <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="underline text-primary hover:text-primary/80">here (link requires access)</a>.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="prose prose-sm sm:prose-base max-w-none dark:prose-invert bg-muted/20 p-4 rounded-md max-h-[60vh] overflow-y-auto">
        {formatReport(report)}
      </CardContent>
      <CardFooter className="flex justify-center mt-6">
        <Button onClick={onStartNew} className="w-full sm:w-auto text-lg py-3">
          Start New Questionnaire
        </Button>
      </CardFooter>
    </Card>
  );
}
