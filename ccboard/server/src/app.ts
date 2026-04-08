import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sessionsRouter from "./routes/sessions.js";
import launchRouter from "./routes/launch.js";
import reviewsRouter from "./routes/reviews.js";
import sseRouter from "./routes/sse.js";
import supervisorRouter from "./routes/supervisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// Middleware
app.use(express.json());

// API routes
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", reviewsRouter);
app.use("/api", launchRouter);
app.use("/api/sessions", supervisorRouter);
app.use("/api/sessions", sseRouter);

// Static files — serve the Vite build output in server/public/
const publicDir = join(__dirname, "..", "public");
app.use(express.static(publicDir));

// SPA fallback: /session/:pid serves index.html so client-side routing works
app.get("/session/:pid", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

export default app;
