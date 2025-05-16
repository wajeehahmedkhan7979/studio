
'use server';

/**
 * @fileOverview Generates a comprehensive report summarizing the responses collected, including user information.
 *
 * - generateReport - A function that generates the security report.
 * - GenerateReportInput - The input type for the generateReport function.
 * - GenerateReportOutput - The return type for the generateReport function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

// Define a Zod schema for UserProfile that matches the one in src/lib/types.ts
const UserProfileSchema = z.object({
  name: z.string().describe("The user's full name."),
  email: z.string().email().describe("The user's email address."),
  linkedin: z.string().url().optional().describe("The user's LinkedIn profile URL (optional)."),
  department: z.string().describe("The user's department."),
  role: z.string().describe("The user's role."),
});

const QuestionnaireDataSchema = z.object({
  questions: z.array(z.string()).describe("The list of questions asked."),
  answers: z.record(z.string()).describe("A mapping of question index (as string, 0-indexed) to the user's answer.")
}).describe("The questions asked and the answers provided by the user.");


const GenerateReportInputSchema = z.object({
  userProfile: UserProfileSchema.describe("The profile information of the user."),
  questionnaireData: QuestionnaireDataSchema.describe("The questions asked and the answers provided by the user."),
});
export type GenerateReportInput = z.infer<typeof GenerateReportInputSchema>;

const GenerateReportOutputSchema = z.object({
  report: z.string().describe('A comprehensive report including user details, Q&A, and security posture summary.'),
});
export type GenerateReportOutput = z.infer<typeof GenerateReportOutputSchema>;

export async function generateReport(input: GenerateReportInput): Promise<GenerateReportOutput> {
  return generateReportFlow(input);
}

const generateReportPrompt = ai.definePrompt({
  name: 'generateReportPrompt',
  input: {schema: GenerateReportInputSchema},
  output: {schema: GenerateReportOutputSchema},
  prompt: `You are a security analyst. Your task is to generate a comprehensive security assessment report.

First, display the user's information as provided:
Name: {{{userProfile.name}}}
Email: {{{userProfile.email}}}
{{#if userProfile.linkedin}}
LinkedIn: {{{userProfile.linkedin}}}
{{/if}}
Department: {{{userProfile.department}}}
Role: {{{userProfile.role}}}

---
Questions & Answers:
Present the following questions and their corresponding user answers. Number each question-answer pair sequentially starting from 1.
{{#each questionnaireData.questions}}
Question: {{{this}}}
User's Answer: {{{lookup ../questionnaireData.answers @index}}}
---
{{/each}}

---
Overall Security Assessment:
Based on the user's role ({{{userProfile.role}}} in {{{userProfile.department}}}) and the answers provided above, generate a comprehensive summary. This summary should assess the organization's security posture as reflected by these specific responses and identify areas potentially needing attention or improvement. Focus on insights derived from the Q&A section.
`,
});

const generateReportFlow = ai.defineFlow(
  {
    name: 'generateReportFlow',
    inputSchema: GenerateReportInputSchema,
    outputSchema: GenerateReportOutputSchema,
  },
  async input => {
    const {output} = await generateReportPrompt(input);
    return output!;
  }
);

