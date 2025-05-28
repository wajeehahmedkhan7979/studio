
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
import type { TailoredQuestionsOutput as AppTailoredQuestionsOutput, TailorNepraQuestionsInput as AppTailorNepraQuestionsInput } from '@/lib/types';

// Using types from lib/types.ts for consistency with the app
const TailorNepraQuestionsInputSchema = z.object({
  department: z.string().describe('The department of the user (e.g., Access Control, VAPT, Monitoring, Audit, Training, System and Information Integrity). This MUST match one of the NEPRA-aligned department categories to ensure relevant question generation.'),
  role: z.string().describe('The role/designation of the user in the department (e.g., Compliance Officer, Security Analyst, Manager IT, System Administrator, OT Engineer). This helps in further personalizing the questions.'),
});

const TailorNepraQuestionsOutputSchema = z.object({
  questions: z.array(z.string()).describe('A list of 5-7 tailored questions relevant to the user\'s department, role, and NEPRA compliance. Each question MUST be prepended with a brief NEPRA contextual hint using the "🛈" symbol (e.g., "🛈 NEPRA Section X.Y requires..."). The questions should reflect an auditor’s perspective, cover mandatory NEPRA controls, and be broken into simpler, sequential questions if the topic is complex. Questions should be open-ended and specific to the user\'s context.'),
});


// Wrapper function to be called from the application
export async function tailorNepraQuestions(input: AppTailorNepraQuestionsInput): Promise<AppTailoredQuestionsOutput> {
  const result = await tailorNepraQuestionsFlow(input);
  // Ensure the output matches the application's expected type, handling potential errors.
  if (result && result.questions && result.questions.length > 0) {
    return result as AppTailoredQuestionsOutput;
  }
  // Fallback or error handling if AI fails to generate questions
  return { questions: ["Error: Could not generate tailored questions at this time. Please ensure your department and role are clearly defined, or try again later."] };
}

const prompt = ai.definePrompt({
  name: 'tailorNepraQuestionsPrompt',
  input: {schema: TailorNepraQuestionsInputSchema},
  output: {schema: TailorNepraQuestionsOutputSchema},
  prompt: `You are an expert AI assistant acting as a seasoned cybersecurity auditor for Pakistan's power sector, specializing in NEPRA Security of Information Technology and Operational Technology Regulations, 2022. Your questioning style is professional, direct, investigative, and aims to assess compliance thoroughly.

Your task is to generate a concise list of 5-7 highly relevant cybersecurity questions for an employee based on their specific department and role. These questions MUST:
1.  **Auditor's Tone**: Be phrased as a real cybersecurity auditor would, seeking specific evidence, process descriptions, or confirmations of practices.
2.  **Department & Role Specificity**: Be highly personalized to the provided department (e.g., "{{{department}}}") and role (e.g., "{{{role}}}"), probing their direct responsibilities and knowledge concerning NEPRA regulations.
3.  **NEPRA Control Alignment**: Directly assess compliance with mandatory NEPRA controls relevant to the given department/role.
4.  **NEPRA Contextual Hint**: CRITICAL - Prepend EACH question with a brief, relevant NEPRA contextual hint using the "🛈" symbol. For example: "🛈 NEPRA Section 4.3 mandates documented incident response procedures. Describe your team's process for documenting OT security incidents." or "🛈 The Least Privilege Principle is key under NEPRA. How do you ensure it's applied to user access for {{{department}}}-specific critical systems?"
5.  **Clarity & Simplicity**: Be phrased clearly. Define acronyms if essential and not commonly understood by the target role.
6.  **Open-Ended**: Favor open-ended questions to encourage detailed responses, rather than simple yes/no answers, unless a yes/no is a deliberate precursor to a follow-up.
7.  **Break Down Complex Topics**: If a NEPRA control is multifaceted (e.g., full incident lifecycle reporting, comprehensive risk assessment), break it down into 2-3 simpler, sequential questions. Each sub-question must still have its own NEPRA hint and contribute to assessing the broader control.
8.  **NEPRA Departments Focus**: The questions should be tailored for one of these NEPRA-aligned departments: Access Control, Awareness and Training, Audit and Accountability, Configuration Management, Incident Response, Maintenance, Media Protection, Physical and Environmental Protection, Planning, Personnel Security, Risk Assessment, System and Communications Protection, System and Information Integrity, System and Services Acquisition, Monitoring, VAPT. The user's department is: {{{department}}}.

Consider these NEPRA Regulatory Themes, Controls & Keywords (select most relevant to role/department):
-   Policy and Procedures: Awareness, documentation, roles & responsibilities.
-   Implementation: Enforcement, real-world application of policies.
-   Review and Audits: Periodic reviews, audit trails, logs, compliance checks.
-   Incident Handling: Detection, reporting (e.g., to PowerCERT within 72 hours), escalation, response plans.
-   Training: Role-based security training, awareness campaigns.
-   Controls: Technical (e.g., IDS/IPS, MFA), physical, procedural controls; their effectiveness and verification.
-   Specifics: "Least Privilege Principle", "Access Rights Management", "Critical Infrastructure" (IT/OT), "Data Integrity, Confidentiality & Authenticity", "VAPT", "Data Backup and Recovery", "Change Management", "Risk Management Framework".

Example (for Department: 'Incident Response', Role: 'Analyst'):
1.  "🛈 NEPRA Section 7.1 requires timely detection of security incidents. What tools and methods does your team primarily use to detect security incidents within OT systems?"
2.  "🛈 Following detection, NEPRA Section 7.2 outlines reporting duties. Can you describe the established procedure for an analyst in your role to report a confirmed OT security incident, including to whom and within what initial timeframe?"
3.  "🛈 NEPRA's guidelines emphasize coordination with PowerCERT for significant incidents. What is your understanding of the criteria that escalate an incident to involve PowerCERT?"

Generate exactly 5-7 questions in total. Return ONLY a JSON object with a "questions" array containing the question strings. Do not add any other text, preamble, or explanation.
`,
});

const tailorNepraQuestionsFlow = ai.defineFlow(
  {
    name: 'tailorNepraQuestionsFlow',
    inputSchema: TailorNepraQuestionsInputSchema, // Genkit flow uses its own Zod schema
    outputSchema: TailorNepraQuestionsOutputSchema,
  },
  async (input: z.infer<typeof TailorNepraQuestionsInputSchema>) => { // Explicitly type input for the flow
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
