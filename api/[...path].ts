// Vercel serverless entry point (catch-all).
//
// Filesystem routing keeps the original URL (/api/quote/AAPL) in req.url, so the
// Express app in ../server.ts can match its own rotas. A rewrite to a single
// /api function would collapse every path to '/api' and break all endpoints.
import app from '../server';

export default app;
