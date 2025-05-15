// use server'

/**
 * @fileOverview This file defines a Genkit flow for tailoring questions based on user department and role.
 *
 * - tailorQuestions - A function that takes user's department and role and returns tailored questions.
 * - TailorQuestionsInput - The input type for the tailorQuestions function.
 * - TailorQuestionsOutput - The return type for the tailorQuestions function.
 */

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TailorQuestionsInputSchema = z.object({
  department: z.string().describe('The department of the user.'),
  role: z.string().describe('The role of the user in the department.'),
});
export type TailorQuestionsInput = z.infer<typeof TailorQuestionsInputSchema>;

const TailorQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).describe('A list of questions tailored to the user.'),
});
export type TailorQuestionsOutput = z.infer<typeof TailorQuestionsOutputSchema>;

export async function tailorQuestions(input: TailorQuestionsInput): Promise<TailorQuestionsOutput> {
  return tailorQuestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'tailorQuestionsPrompt',
  input: {schema: TailorQuestionsInputSchema},
  output: {schema: TailorQuestionsOutputSchema},
  prompt: `You are an AI assistant designed to tailor questions based on the user's department and role within the organization.

  Given the user's department: {{{department}}} and role: {{{role}}}, generate a list of relevant questions.
  The questions should be related to cybersecurity and align with NIST framework.
  Return the questions in a JSON array.
  `,
});

const tailorQuestionsFlow = ai.defineFlow(
  {
    name: 'tailorQuestionsFlow',
    inputSchema: TailorQuestionsInputSchema,
    outputSchema: TailorQuestionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
