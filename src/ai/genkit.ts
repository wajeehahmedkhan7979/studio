
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';


import { config } from 'dotenv';
config(); // Ensures .env variables are loaded for Genkit server-side execution

export const ai = genkit({
  plugins: [
   
    googleAI(),

  ],
  
  model: 'googleai/gemini-2.0-flash', // Default model
  // To enable Genkit flow tracing and debugging locally:
  // enableTracing: true, // Or configure via environment variable GENKIT_ENV=dev
  // logLeve: 'debug', // More verbose logging
});
