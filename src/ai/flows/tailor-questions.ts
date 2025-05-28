
'use server';

/**
 * @fileOverview This file defines a Genkit flow for tailoring NEPRA-compliant cybersecurity questions
 * based on the user's department and role within Pakistan's power sector.
 * It aims to generate questions with an auditor's tone and structure,
 * as if trained on a large corpus of NEPRA-aligned prompts.
 * Questions should include brief NEPRA contextual hints.
 *
 * - tailorNepraQuestions - A function that takes user's department and role and returns tailored NEPRA questions.
 * - TailorNepraQuestionsInput - The input type for the tailorNepraQuestions function.
 * - TailorNepraQuestionsOutput - The return type for the tailorNepraQuestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import type { TailoredQuestionsOutput as AppTailoredQuestionsOutput } from '@/lib/types'; // Using the app's type for output

const TailorNepraQuestionsInputSchema = z.object({
  department: z.string().describe('The department of the user (e.g., Security Policy, VAPT, Monitoring, Audit, Training, Reporting, SOC, PowerCERT Coordination, IT Operations, OT Operations, Human Resources, Legal).'),
  role: z.string().describe('The role/designation of the user in the department (e.g., Compliance Officer, Security Analyst, Manager IT, System Administrator, HR Manager).'),
  // numberOfQuestions: z.number().optional().default(7).describe('The desired number of questions, typically between 5 and 10.') // Kept for potential future use
});
export type TailorNepraQuestionsInput = z.infer<typeof TailorNepraQuestionsInputSchema>;

const TailorNepraQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).describe('A list of 5-7 tailored questions relevant to the user\'s department, role, and NEPRA compliance. Each question should be prepended with a brief NEPRA contextual hint (e.g., "🛈 NEPRA Section X.Y requires..."). The questions should reflect an auditor\'s perspective and cover mandatory NEPRA controls. Complex topics should be broken into simpler, sequential questions.'),
});
export type TailorNepraQuestionsOutput = z.infer<typeof TailorNepraQuestionsOutputSchema>;


// Wrapper function to be called from the application
export async function tailorNepraQuestions(input: TailorNepraQuestionsInput): Promise<AppTailoredQuestionsOutput> {
  const result = await tailorNepraQuestionsFlow(input);
  return result as AppTailoredQuestionsOutput; // Assuming the output directly matches
}

const prompt = ai.definePrompt({
  name: 'tailorNepraQuestionsPrompt',
  input: {schema: TailorNepraQuestionsInputSchema},
  output: {schema: TailorNepraQuestionsOutputSchema},
  prompt: `You are an expert AI assistant acting as a seasoned cybersecurity auditor for Pakistan's power sector. Your expertise is rooted in the NEPRA Security of Information Technology and Operational Technology Regulations, 2022. You have been "trained" on over 600 NEPRA-aligned prompts and real-world audit questions, ensuring your questions are precise, insightful, and directly assess compliance.

Your task is to generate a concise list of 5-7 highly relevant cybersecurity questions for an employee based on their specific department and role. These questions MUST:
1.  Reflect an auditor's tone: Professional, direct, and investigative, seeking specific evidence or process descriptions.
2.  Be specific to the provided department and role, probing their direct responsibilities and knowledge concerning NEPRA regulations.
3.  Directly assess compliance with mandatory NEPRA controls.
4.  Cover a range of applicable NEPRA regulatory themes. If possible, try to touch upon different categories relevant to the role.
5.  Be phrased clearly. Avoid ambiguity. Define acronyms if essential and not commonly understood by the target role.
6.  Be open-ended to encourage detailed responses, rather than simple yes/no answers, unless a yes/no is a deliberate precursor to a follow-up.
7.  **IMPORTANT**: Prepend each question with a brief, relevant NEPRA contextual hint using the "🛈" symbol. For example: "🛈 NEPRA Section 4.3 requires documenting incident response procedures. How does your team document these?" or "🛈 The Least Privilege Principle is a key NEPRA mandate. How do you ensure it's applied to user access for critical OT systems?"
8.  **BREAK DOWN COMPLEX QUESTIONS**: If a NEPRA control is multifaceted (e.g., full incident lifecycle reporting), break it down into 2-3 simpler, sequential questions instead of one large, complex question. Each sub-question should still have its own NEPRA hint.

User's Department: {{{department}}}
User's Role: {{{role}}}

Key NEPRA Regulatory Themes, Controls & Keywords to ensure are covered appropriately (select those most relevant to the role/department):
-   **Governance & Policy:** Security Policy awareness, roles & responsibilities.
-   **Access Control:** "Least Privilege Principle", "Access Rights Management" (Physical and Logical for IT/OT), password policies, multi-factor authentication, account management (onboarding, offboarding, changes).
-   **Critical Infrastructure Protection:** Protection of "Critical Infrastructure" (IT and OT systems), network segmentation, specific OT security measures.
-   **Monitoring & Incident Response:** "IDS/IPS" (Intrusion Detection/Prevention Systems), "SOC & PowerCERT" coordination, security event logging and monitoring, "Security Incident Reporting" (timeliness, details, impact assessment, actions taken, escalation paths), incident response plans.
-   **Vulnerability Management:** "VAPT (Vulnerability Assessment and Penetration Testing)" processes, patch management, secure configuration.
-   **Data Security:** "Data Integrity, Confidentiality & Authenticity", data classification, encryption (in transit and at rest), "Data Backup and Recovery" procedures and testing.
-   **Training & Awareness:** Cybersecurity "Audit & Training Programs", role-based training, awareness campaigns, phishing simulations.
-   **Compliance & Reporting:** "Security Controls Monitoring" (effectiveness, regular reviews), audit trails, "Quarterly Reporting Requirements" to NEPRA, documentation practices.
-   **Risk Management:** Risk assessment processes, risk treatment plans.
-   **Change Management:** Secure software development lifecycle (if applicable), secure change control processes.

Example (for 'IT Operations' / 'System Administrator' - showing breakdown and hints):
1.  "🛈 NEPRA's Access Control guidelines emphasize regular review. Describe the documented procedure you follow for recertifying user access rights to critical servers."
2.  "🛈 The 'Least Privilege Principle' is central to NEPRA. How do you ensure this principle is specifically applied during the access recertification process you just described?"
3.  "🛈 NEPRA mandates timely vulnerability remediation. Walk me through the steps you take, from identification to resolution, when a critical vulnerability is reported for a system under your administration."
4.  "🛈 Regarding patch deployment timelines within vulnerability management, what is your defined SLA and how do you coordinate with the SOC?"

Generate exactly 5-7 questions in total. Return ONLY a JSON object with a "questions" array containing the question strings. Do not add any other text, preamble, or explanation.
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
    if (!output || !output.questions || output.questions.length === 0) {
        // Log error for server-side debugging
        console.error('AI did not return questions or returned an empty list. Input:', input, 'Output:', output);
        // Provide a generic error message for the client
        return { questions: ["Error: Could not generate tailored questions at this time. The AI service might be experiencing issues or the provided role/department is not specific enough. Please try again later or rephrase your role/department."] };
    }
    return output;
  }
);
