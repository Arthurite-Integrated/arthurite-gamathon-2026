import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  if (mode === 'devauth') {
    // `npm run dev:local`: talk to the local realtime server and skip Cognito.
    // Values set here beat .env.local (which holds the DEPLOYED urls after `npm run env:frontend`),
    // because Vite gives variables that already exist in the process the highest priority.
    // To use another port: VITE_LOCAL_WS_URL=ws://localhost:8788 npm run dev:local
    process.env.VITE_DEV_AUTH = 'true';
    process.env.VITE_WS_URL = process.env.VITE_LOCAL_WS_URL ?? 'ws://localhost:8787';
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
  };
});
