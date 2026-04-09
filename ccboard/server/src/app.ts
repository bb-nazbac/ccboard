import express from "express";
import type { Request, Response, NextFunction } from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "./lib/logger.js";
import sessionsRouter from "./routes/sessions.js";
import launchRouter from "./routes/launch.js";
import reviewsRouter from "./routes/reviews.js";
import sseRouter from "./routes/sse.js";
import supervisorRouter from "./routes/supervisor.js";
import { backfillAllPairings } from "./services/pairing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger("http");

const app = express();

// Middleware
app.use(express.json());

// Request logging (dev only — pino level controls whether this actually logs)
app.use((req: Request, _res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api")) {
    log.debug({ method: req.method, path: req.path, query: req.query }, "request");
  }
  next();
});

// API routes
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", reviewsRouter);
app.use("/api", launchRouter);
app.use("/api/sessions", supervisorRouter);
app.use("/api/sessions", sseRouter);

// Static files — serve the Vite build output in server/public/
const publicDir = join(__dirname, "..", "public");
app.use(express.static(publicDir));

// SPA fallback: /session/:pid and root serve index.html
app.get("/session/:pid", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

// Backfill pairing metadata for all known projects on startup
void backfillAllPairings();

export default app;
