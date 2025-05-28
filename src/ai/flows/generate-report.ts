
'use server';

/**
 * @fileOverview Generates a NEPRA-aligned cybersecurity compliance report.
 *
 * - generateNepraReport - A function that generates the compliance report.
 * - GenerateNepraReportInput - The input type for the generateNepraReport function.
 * - GenerateNepraReportOutput - The return type for the generateNepraReport function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { UserProfile, QuestionDefinition, ReportAnswerDetail as AppReportAnswerDetail, GenerateNepraReportInput as AppGenerateNepraReportInput, QuestionnaireDataForReport as AppQuestionnaireDataForReport } from '@/lib/types';


const UserProfileSchema = z.object({
  name: z.string().describe("The user's full name."),
  email: z.string().email().describe("The user's email address."),
  linkedin: z.string().url().optional().describe("The user's LinkedIn profile URL (optional)."),
  department: z.string().describe("The user's department (e.g., Access Control, VAPT). This should align with NEPRA categories."),
  role: z.string().describe("The user's role within the department (e.g., Compliance Officer, Analyst)."),
});

const ReportAnswerDetailSchema = z.object({
  question: z.string().describe("The full question text as presented to the user, including any NEPRA hints."),
  answerText: z.string().describe("The user's freeform answer to the question."),
  policyMaturityScore: z.number().min(0).max(10).describe("User's self-assessed policy maturity score (0.0-10.0) for this specific question/control."),
  practiceMaturityScore: z.number().min(0).max(10).describe("User's self-assessed practice maturity score (0.0-10.0) for this specific question/control."),
  timestamp: z.string().describe("The ISO timestamp when the answer was recorded."),
  nepraCategory: z.string().optional().describe("The NEPRA category the question relates to, if available. This might be AI-inferred or pre-assigned to the question.")
});

// Schema for questions array within questionnaireData
const QuestionDefinitionSchema = z.object({
  id: z.string(),
  questionText: z.string(),
  category: z.string(),
});


const QuestionnaireDataSchema = z.object({
  questions: z.array(QuestionDefinitionSchema).describe("The list of original question definitions in the order they were presented."),
  answers: z.record(ReportAnswerDetailSchema).describe("A mapping of question ID (string) to the user's detailed answer object, including scores."),
  averagePolicyMaturity: z.number().optional().describe("Overall average policy maturity score calculated from all per-question scores."),
  averagePracticeMaturity: z.number().optional().describe("Overall average practice maturity score calculated from all per-question scores."),
  // policyScores: z.record(z.number()).optional().describe("Legacy field for overall department policy scores (0.0-10.0). Review if still needed or use per-question scores for averages.")
}).describe("The questions asked, the detailed answers and per-question scores provided by the user, and overall average maturity scores.");


const GenerateNepraReportInputSchema = z.object({
  userProfile: UserProfileSchema.describe("The profile information of the user."),
  questionnaireData: QuestionnaireDataSchema.describe("The questions asked, answers provided by the user (indexed by question ID), per-question scores, and calculated average maturity scores."),
  sessionId: z.string().describe("The unique session ID for this questionnaire."),
  reportDate: z.string().describe("The date the report is being generated (e.g., YYYY-MM-DD)."),
  completedTime: z.string().optional().describe("The ISO timestamp when the questionnaire was completed."),
});

const GenerateNepraReportOutputSchema = z.object({
  reportContent: z.string().describe('A comprehensive NEPRA-aligned compliance report in Markdown format. It should include user details, session ID, date, all Q&A (attempt to group by NEPRA categories if identifiable by the AI), per-question policy and practice maturity scores, overall average maturity scores, and a summary of compliance status. If a question was not answered, it should be noted.'),
});

// Exporting types for application use
export type GenerateNepraReportInput = z.infer<typeof GenerateNepraReportInputSchema>;
export type GenerateNepraReportOutput = z.infer<typeof GenerateNepraReportOutputSchema>;


// Wrapper function
export async function generateNepraReport(input: AppGenerateNepraReportInput): Promise<GenerateNepraReportOutput> {
  // Map AppQuestionnaireDataForReport to the Zod schema expected by the flow
  const zodQuestionnaireData = {
    questions: input.questionnaireData.questions.map(q => ({ id: q.id, questionText: q.questionText, category: q.category })),
    answers: {} as Record<string, z.infer<typeof ReportAnswerDetailSchema>>,
    averagePolicyMaturity: input.questionnaireData.averagePolicyMaturity,
    averagePracticeMaturity: input.questionnaireData.averagePracticeMaturity,
  };

  for (const qId in input.questionnaireData.answers) {
    const appAnswer = input.questionnaireData.answers[qId];
    zodQuestionnaireData.answers[qId] = {
      question: appAnswer.question,
      answerText: appAnswer.answerText,
      policyMaturityScore: appAnswer.policyMaturityScore,
      practiceMaturityScore: appAnswer.practiceMaturityScore,
      timestamp: appAnswer.timestamp,
      nepraCategory: appAnswer.nepraCategory,
    };
  }
  
  const flowInput: GenerateNepraReportInput = {
    ...input,
    questionnaireData: zodQuestionnaireData,
  };
  return generateNepraReportFlow(flowInput);
}

const generateNepraReportPrompt = ai.definePrompt({
  name: 'generateNepraReportPrompt',
  input: {schema: GenerateNepraReportInputSchema},
  output: {schema: GenerateNepraReportOutputSchema},
  prompt: `You are a senior cybersecurity analyst tasked with generating a NEPRA-aligned Cybersecurity Compliance Report for an employee in Pakistan's power sector.
The report must be meticulously structured, clear, comprehensive, and ready for submission or review. Use Markdown for formatting.

Report Generation Date: {{{reportDate}}}
Session ID: {{{sessionId}}}
{{#if completedTime}}
Questionnaire Completed On: {{{completedTime}}}
{{/if}}

## User Information
- **Name:** {{{userProfile.name}}}
- **Email:** {{{userProfile.email}}}
{{#if userProfile.linkedin}}
- **LinkedIn:** {{{userProfile.linkedin}}}
{{/if}}
- **Department:** {{{userProfile.department}}}
- **Role:** {{{userProfile.role}}}

---
## NEPRA Compliance Questionnaire & Responses

This section details the questions posed to the user, their responses, and their self-assessed maturity scores for each.
**Instructions for AI**: Review all questions and answers. Attempt to group related Q&A pairs under relevant NEPRA regulatory categories as sub-headings (e.g., "### Access Control", "### Incident Response"). If a question doesn't clearly fit a common category or if categorization is ambiguous, list it under a general "### Other Compliance Areas" or sequentially. Number each question sequentially starting from 1 (e.g., Question 1, Question 2, etc.) within its category or overall.

{{#each questionnaireData.questions}}
**Question {{!-- AI to assign sequential number here --}}**: {{{this.questionText}}}
{{#with (lookup ../questionnaireData.answers this.id)}}
  - **User's Answer:** {{{this.answerText}}}
  - **Policy Maturity Score:** {{this.policyMaturityScore}}/10.0
  - **Practice Maturity Score:** {{this.practiceMaturityScore}}/10.0
  - **Answered On:** {{{this.timestamp}}}
  {{#if this.nepraCategory}}
  - **NEPRA Category:** {{{this.nepraCategory}}}
  {{/if}}
{{else}}
  - **User's Answer:** [No answer provided for this question]
  - **Policy Maturity Score:** [N/A]
  - **Practice Maturity Score:** [N/A]
  - **Answered On:** [N/A]
{{/with}}
---
{{/each}}

{{#if questionnaireData.averagePolicyMaturity}}
## Overall Maturity Assessment
- **Average Policy Maturity Score:** {{questionnaireData.averagePolicyMaturity}}/10.0
- **Average Practice Maturity Score:** {{questionnaireData.averagePracticeMaturity}}/10.0
---
{{/if}}

## Overall Compliance Assessment & Recommendations

Based on the user's role ({{{userProfile.role}}} in {{{userProfile.department}}}), the NEPRA regulations, the answers provided, the per-question maturity scores, and overall average scores, generate a comprehensive summary.
This summary should:
1.  Briefly assess the employee's department's adherence to relevant NEPRA cybersecurity controls as reflected by their responses and scores.
2.  Identify key strengths demonstrated.
3.  Highlight areas potentially needing attention, improvement, or further training, specifically referencing NEPRA controls. Mention specific question numbers or policy areas if relevant, especially those with low maturity scores.
4.  If any responses or low scores indicate a potential non-compliance or significant risk, clearly state this and suggest immediate follow-up actions.
5.  Conclude with a general statement on the compliance posture suggested by this session.

Focus on actionable insights, always linking back to NEPRA regulatory themes such as:
"Least Privilege Principle", "Access Rights Management", "Critical Infrastructure", "IDS/IPS", "SOC & PowerCERT coordination", "Security Incident Reporting (within 72 hours)", "Data Integrity, Confidentiality & Authenticity", "Audit & Training Programs", "Security Controls Monitoring", "Quarterly Reporting Requirements", "VAPT", "Data Backup and Recovery", "Change Management", "Risk Management".

The output MUST be a single string in Markdown format. Ensure all parts of the report are generated.
`,
});

const generateNepraReportFlow = ai.defineFlow(
  {
    name: 'generateNepraReportFlow',
    inputSchema: GenerateNepraReportInputSchema,
    outputSchema: GenerateNepraReportOutputSchema,
  },
  async (input: GenerateNepraReportInput): Promise<GenerateNepraReportOutput> => {
    const {output} = await generateNepraReportPrompt(input);
    if (!output || !output.reportContent) {
        console.error('AI did not return report content. Input:', input, 'Output:', output);
        return { reportContent: "Error: Failed to generate report content. The AI service might be temporarily unavailable or unable to process the request. Please try again." };
    }
    return output;
  }
);
