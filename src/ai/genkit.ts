
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';
// To use IBM Watsonx:
// 1. Install the Watsonx plugin for Genkit (the package name might vary, e.g., @genkit-ai/ibm-watsonx or similar)
//    npm install @genkit-ai/ibm-watsonx 
// 2. Import the plugin:
//    import { ibmWatsonx } from '@genkit-ai/ibm-watsonx'; // Replace with actual import
// 3. Load environment variables if not already handled, ensure WATSONX_API_KEY and WATSONX_API_ENDPOINT are in .env
//    import { config } from 'dotenv';
//    config();

export const ai = genkit({
  plugins: [
    // Current configuration uses Google AI.
    // This will fail if GOOGLE_API_KEY is not set in .env
    googleAI(),

    // Example of how to add Watsonx plugin once installed:
    // ibmWatsonx({
    //   apiKey: process.env.WATSONX_API_KEY,
    //   endpoint: process.env.WATSONX_API_ENDPOINT,
    //   // Depending on the plugin, other parameters like a project ID might be needed.
    //   // projectId: process.env.WATSONX_PROJECT_ID, // Example if needed
    // }),
  ],
  // If switching to Watsonx, update the default model to a Watsonx-compatible model identifier.
  // For example: model: 'watsonx/your-chosen-watsonx-model-name',
  // Keeping Gemini as default for now; it will fail if GOOGLE_API_KEY is missing.
  model: 'googleai/gemini-2.0-flash',
});
