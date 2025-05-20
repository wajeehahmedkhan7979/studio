
'use server';

/**
 * @fileOverview This file defines a Genkit flow for tailoring NEPRA-compliant cybersecurity questions
 * based on the user's department and role within Pakistan's power sector.
 * It aims to generate questions with an auditor's tone and structure,
 * as if trained on a large corpus of NEPRA-aligned prompts.
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
  // We could potentially pass existing answers if questions need to adapt mid-flow,
  // or a list of question categories already covered to ensure breadth.
  // numberOfQuestions: z.number().optional().default(7).describe('The desired number of questions, typically between 5 and 10.')
});
export type TailorNepraQuestionsInput = z.infer<typeof TailorNepraQuestionsInputSchema>;

// The output schema remains an array of strings for now.
// A future enhancement could be for the AI to return structured QuestionDefinition objects.
const TailorNepraQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).describe('A list of 5-10 tailored questions relevant to the user\'s department, role, and NEPRA compliance. The questions should reflect an auditor\'s perspective and cover mandatory NEPRA controls.'),
});
export type TailorNepraQuestionsOutput = z.infer<typeof TailorNepraQuestionsOutputSchema>;


// Wrapper function to be called from the application
export async function tailorNepraQuestions(input: TailorNepraQuestionsInput): Promise<AppTailoredQuestionsOutput> {
  const result = await tailorNepraQuestionsFlow(input);
  // Ensure the output matches the application's expected type, even if it's just string arrays for now.
  return result as AppTailoredQuestionsOutput;
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

Example (for 'IT Operations' / 'System Administrator'):
-   "Describe the documented procedure you follow for reviewing and recertifying user access rights to critical servers, ensuring alignment with the 'Least Privilege Principle' as mandated by NEPRA."
-   "Walk me through the steps you take, from identification to resolution, when a critical vulnerability is reported for a system under your administration, including your patch deployment timeline and any coordination with the SOC."
-   "How do you verify the integrity and completeness of system backups for critical IT infrastructure, and what is the defined RTO/RPO for these systems?"

Example (for 'HR' / 'HR Manager'):
-   "Explain the process for ensuring all new employees complete mandatory cybersecurity awareness training before gaining access to company IT resources, as per NEPRA guidelines."
-   "How does the HR department collaborate with IT/Security to ensure timely revocation of access rights for departing employees, and what documentation supports this process?"

Generate exactly 5-7 questions. Return ONLY a JSON object with a "questions" array containing the question strings. Do not add any other text, preamble, or explanation.
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
        console.error('AI did not return questions. Output:', output);
        return { questions: ["Error: Could not generate tailored questions at this time. The AI service might be experiencing issues or the provided role/department is not specific enough. Please try again later or rephrase your role/department."] };
    }
    return output;
  }
);

