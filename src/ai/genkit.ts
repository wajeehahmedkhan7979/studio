
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';
// To use IBM Watsonx:
// 1. Install the Watsonx plugin for Genkit. The package name might be specific,
//    e.g., `@genkit-ai/ibm-watsonx` or similar. Check Genkit documentation.
//    Example command: npm install @genkit-ai/ibm-watsonx
// 2. Import the plugin:
//    import { ibmWatsonx } from '@genkit-ai/ibm-watsonx'; // Replace with the actual import path
// 3. Ensure WATSONX_API_KEY, WATSONX_API_ENDPOINT (and potentially WATSONX_PROJECT_ID)
//    are set in your .env file. The `dotenv` package is used in `src/ai/dev.ts`
//    which should load these if that dev script is run. For Next.js, these should
//    be prefixed with NEXT_PUBLIC_ if accessed client-side, but Genkit flows run server-side.
//    No, for Genkit server-side, they don't need NEXT_PUBLIC_ prefix.
//    Ensure they are loaded in the environment where Genkit flows execute.

import { config } from 'dotenv';
config(); // Ensures .env variables are loaded for Genkit server-side execution

export const ai = genkit({
  plugins: [
    // Current configuration uses Google AI (Gemini).
    // This will fail if GOOGLE_API_KEY is not set in .env and Genkit attempts to use it.
    googleAI(),

    // Example of how to add and configure the Watsonx plugin (once installed):
    // ibmWatsonx({
    //   apiKey: process.env.WATSONX_API_KEY, // Loaded from .env
    //   endpoint: process.env.WATSONX_API_ENDPOINT, // Loaded from .env
    //   // Depending on the plugin, other parameters like a project ID might be needed.
    //   // projectId: process.env.WATSONX_PROJECT_ID, // Example, if needed
    // }),
  ],
  // If switching to Watsonx, update the default model to a Watsonx-compatible model identifier.
  // For example: model: 'watsonx/your-chosen-watsonx-model-name',
  //
  // For now, keeping Gemini as the default. AI calls will fail if GOOGLE_API_KEY is missing
  // and no alternative provider is fully configured and selected.
  model: 'googleai/gemini-2.0-flash', // Default model
  // To enable Genkit flow tracing and debugging locally:
  // enableTracing: true, // Or configure via environment variable GENKIT_ENV=dev
  // logLeve: 'debug', // More verbose logging
});
