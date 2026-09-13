// Vercel serverless entry point.
//
// The whole Express app (all /api/* routes backed by Yahoo Finance and
// Frankfurter) lives in ../server.ts. In the v0 preview that file runs as a
// long-lived Node server via `tsx server.ts`. On Vercel there is no persistent
// server, so we re-use the exact same Express instance here and let Vercel run
// it as a serverless function. `vercel.json` rewrites every `/api/*` request to
// this function, and Express handles the routing from the original URL.
import app from '../server';

export default app;
