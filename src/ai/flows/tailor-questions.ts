
'use server';

/**
 * @fileOverview This file defines a Genkit flow for tailoring NEPRA-compliant cybersecurity questions
 * based on the user's department and role within Pakistan's power sector.
 *
 * - tailorNepraQuestions - A function that takes user's department and role and returns tailored NEPRA questions.
 * - TailorNepraQuestionsInput - The input type for the tailorNepraQuestions function.
 * - TailorNepraQuestionsOutput - The return type for the tailorNepraQuestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const TailorNepraQuestionsInputSchema = z.object({
  department: z.string().describe('The department of the user (e.g., Security Policy, VAPT, Monitoring, Audit, Training, Reporting, SOC, PowerCERT Coordination).'),
  role: z.string().describe('The role/designation of the user in the department (e.g., Compliance Officer, Security Analyst, Manager IT).'),
  // We could add existing answers here if the AI needs to adapt questions mid-flow,
  // but for initial question set generation, department and role are key.
});
export type TailorNepraQuestionsInput = z.infer<typeof TailorNepraQuestionsInputSchema>;

const TailoredQuestionSchema = z.object({
  questionText: z.string().describe('The text of the question.'),
  nepraCategory: z.string().describe('The NEPRA regulatory category this question primarily relates to (e.g., "Access Rights Management", "Security Incident Reporting", "Data Integrity, Confidentiality & Authenticity").'),
  // followUpPrompt: z.string().optional().describe('A suggestion for a follow-up question if the user provides a certain type of answer (e.g., "If a breach is reported, ask for impact and actions taken.")')
});

const TailorNepraQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).describe('A list of 5-10 tailored questions relevant to the user\'s department, role, and NEPRA compliance. The questions should cover mandatory NEPRA controls.'),
  // questions: z.array(TailoredQuestionSchema).describe('A list of tailored questions, each with its text and NEPRA category.'),
});
export type TailorNepraQuestionsOutput = z.infer<typeof TailorNepraQuestionsOutputSchema>;


// Wrapper function to be called from the application
export async function tailorNepraQuestions(input: TailorNepraQuestionsInput): Promise<TailorNepraQuestionsOutput> {
  return tailorNepraQuestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'tailorNepraQuestionsPrompt',
  input: {schema: TailorNepraQuestionsInputSchema},
  output: {schema: TailorNepraQuestionsOutputSchema},
  prompt: `You are an AI assistant specializing in cybersecurity compliance for Pakistan's power sector, aligned with NEPRA (National Electric Power Regulatory Authority) Security of Information Technology and Operational Technology Regulations, 2022.

Your task is to generate a concise list of 5-10 highly relevant cybersecurity questions for an employee based on their specific department and role. These questions should directly assess compliance with mandatory NEPRA controls.

User's Department: {{{department}}}
User's Role: {{{role}}}

Key NEPRA Regulatory Themes & Keywords to incorporate/consider:
- "Least Privilege Principle"
- "Access Rights Management" (Physical and Logical access)
- "Critical Infrastructure" (Protection of both IT and OT systems)
- "IDS/IPS" (Intrusion Detection/Prevention Systems)
- "SOC & PowerCERT" (Coordination, reporting, incident handling)
- "Security Incident Reporting" (Timeliness, details, impact assessment, actions taken)
- "Data Integrity, Confidentiality & Authenticity" (Encryption, backups, access controls)
- "Audit & Training Programs" (Awareness, roles-based training, audit trails)
- "Security Controls Monitoring" (Effectiveness, regular reviews)
- "Quarterly Reporting Requirements" (Data collection for these reports)
- "Vulnerability Assessment and Penetration Testing (VAPT)"
- "Data Backup and Recovery"
- "Change Management"
- "Risk Management"

Instructions:
1.  Generate 5-10 questions.
2.  Each question should be a single string.
3.  The questions MUST be specific to the given department and role, probing their responsibilities and knowledge concerning NEPRA regulations.
4.  Ensure questions cover a range of applicable NEPRA controls for that role.
5.  Phrase questions clearly and directly. Avoid jargon where possible, or explain it if necessary.
6.  Return ONLY a JSON object with a "questions" array containing the question strings. Do not add any other text or explanation.

Example for 'IT Operations' / 'System Administrator':
- "Describe the process you follow for granting or revoking access rights to critical IT systems, ensuring adherence to the 'Least Privilege Principle'."
- "How do you ensure that security patches for servers and network devices are applied Гали (in a timely manner) as per NEPRA guidelines?"
- "What is your role in the event of a security incident reported by the SOC, and how do you coordinate with PowerCERT?"

Example for 'HR' / 'HR Manager':
- "What procedures are in place for cybersecurity awareness training for new employees and regular refreshers for existing staff, as required by NEPRA?"
- "How does the HR department manage access rights for employees joining, leaving, or changing roles to ensure data security?"

Now, generate the questions for the provided department and role.
`,
});

const tailorNepraQuestionsFlow = ai.defineFlow(
  {
    name: 'tailorNepraQuestionsFlow',
    inputSchema: TailorNepraQuestionsInputSchema,
    outputSchema: TailorNepraQuestionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    // Ensure output is not null and has the questions property
    if (!output || !output.questions) {
        console.error('AI did not return questions. Output:', output);
        // Return an empty array or a default question set in case of AI failure
        return { questions: ["Failed to generate questions. Please check your role and department or try again."] };
    }
    return output;
  }
);
