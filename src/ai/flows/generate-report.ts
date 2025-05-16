
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
// Assuming UserProfile and NepraAnswer are defined in types.ts
// For Zod, we need to define them or import Zod schemas if they exist elsewhere.

const UserProfileSchema = z.object({
  name: z.string().describe("The user's full name."),
  email: z.string().email().describe("The user's email address."),
  linkedin: z.string().url().optional().describe("The user's LinkedIn profile URL (optional)."),
  department: z.string().describe("The user's department (e.g., Security Policy, VAPT)."),
  role: z.string().describe("The user's role within the department (e.g., Compliance Officer)."),
});

const AnswerDetailSchema = z.object({
  question: z.string().describe("The question text."),
  answerText: z.string().describe("The user's answer to the question."),
  timestamp: z.string().describe("The ISO timestamp when the answer was recorded."),
  nepraCategory: z.string().optional().describe("The NEPRA category the question relates to, if available.")
});

const QuestionnaireDataSchema = z.object({
  questions: z.array(z.string()).describe("The list of original questions asked (order matters)."),
  answers: z.record(AnswerDetailSchema).describe("A mapping of question index (as string, 0-indexed) to the user's detailed answer object (NepraAnswer).")
}).describe("The questions asked and the detailed answers provided by the user.");


const GenerateNepraReportInputSchema = z.object({
  userProfile: UserProfileSchema.describe("The profile information of the user."),
  questionnaireData: QuestionnaireDataSchema.describe("The questions asked and the answers provided by the user."),
  sessionId: z.string().describe("The unique session ID for this questionnaire."),
  reportDate: z.string().describe("The date the report is being generated (e.g., YYYY-MM-DD)."),
});
export type GenerateNepraReportInput = z.infer<typeof GenerateNepraReportInputSchema>;

const GenerateNepraReportOutputSchema = z.object({
  reportContent: z.string().describe('A comprehensive NEPRA-aligned compliance report in Markdown format. It should include user details, session ID, date, all Q&A grouped by NEPRA categories, and a summary of compliance status based on the responses.'),
});
export type GenerateNepraReportOutput = z.infer<typeof GenerateNepraReportOutputSchema>;

// Wrapper function
export async function generateNepraReport(input: GenerateNepraReportInput): Promise<GenerateNepraReportOutput> {
  return generateNepraReportFlow(input);
}

const generateNepraReportPrompt = ai.definePrompt({
  name: 'generateNepraReportPrompt',
  input: {schema: GenerateNepraReportInputSchema},
  output: {schema: GenerateNepraReportOutputSchema},
  prompt: `You are a senior cybersecurity analyst tasked with generating a NEPRA-aligned Cybersecurity Compliance Report for an employee in Pakistan's power sector.
The report should be structured, clear, and ready for submission or review. Use Markdown for formatting.

Report Generation Date: {{{reportDate}}}
Session ID: {{{sessionId}}}

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

This section details the questions posed to the user and their responses, timestamped.
Organize the Q&A pairs. If a NEPRA category is available for a question, use it as a sub-header. If not, list them sequentially.
Number each question sequentially starting from 1 (e.g., Question 1, Question 2, etc.).

{{#each questionnaireData.questions}}
### Question [Number]: {{{this}}}
{{#with (lookup ../questionnaireData.answers @index)}}
- **User's Answer:** {{{this.answerText}}}
- **Answered On:** {{{this.timestamp}}}
{{#if this.nepraCategory}}
- **NEPRA Category:** {{{this.nepraCategory}}}
{{/if}}
{{else}}
- **User's Answer:** [No answer provided]
- **Answered On:** [N/A]
{{/with}}
---
{{/each}}

## Overall Compliance Assessment & Recommendations

Based on the user's role ({{{userProfile.role}}} in {{{userProfile.department}}}), the NEPRA regulations, and the answers provided above, generate a comprehensive summary.
This summary should:
1.  Briefly assess the employee's awareness and adherence to relevant NEPRA cybersecurity controls as reflected by their responses.
2.  Identify key strengths demonstrated in the responses.
3.  Highlight areas potentially needing attention, improvement, or further training, specifically referencing NEPRA controls (e.g., "Access Rights Management", "Security Incident Reporting", "Data Integrity").
4.  If any responses indicate a potential non-compliance or significant risk (e.g., unreported breach, lack of awareness of critical procedures), clearly state this and suggest immediate follow-up actions.
5.  Conclude with a general statement on the compliance posture suggested by this specific Q&A session.

Focus on actionable insights derived from the Q&A section, always linking back to NEPRA regulatory themes like:
"Least Privilege Principle", "Access Rights Management", "Critical Infrastructure", "IDS/IPS", "SOC & PowerCERT coordination", "Security Incident Reporting", "Data Integrity, Confidentiality & Authenticity", "Audit & Training Programs", "Security Controls Monitoring", "Quarterly Reporting Requirements".

The output MUST be a single string in Markdown format.
`,
});

const generateNepraReportFlow = ai.defineFlow(
  {
    name: 'generateNepraReportFlow',
    inputSchema: GenerateNepraReportInputSchema,
    outputSchema: GenerateNepraReportOutputSchema,
  },
  async input => {
    const {output} = await generateNepraReportPrompt(input);
    if (!output || !output.reportContent) {
        console.error('AI did not return report content. Output:', output);
        return { reportContent: "Error: Failed to generate report content. Please try again." };
    }
    return output;
  }
);
