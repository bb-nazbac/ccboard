/**
 * REST API routes for feature tracking.
 * Mounted under /api/sessions — all routes are relative to that base.
 */

import { Router } from "express";
import { getSessions } from "../services/session-reader.js";
import {
  listFeatures,
  getActiveFeature,
  createFeature,
  updateFeature,
  completeFeature,
  generateFeatureMarkdown,
  switchFeature,
} from "../services/features.js";
import type { Session } from "../schemas/session.js";

const router = Router();

async function findSession(pid: number): Promise<Session | undefined> {
  const sessions = await getSessions();
  return sessions.find((s) => s.pid === pid);
}

// GET /api/sessions/:pid/features — list all features
router.get("/:pid/features", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const features = await listFeatures(session.cwd);
  res.json(features);
});

// GET /api/sessions/:pid/features/active — get active feature
router.get("/:pid/features/active", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const feature = await getActiveFeature(session.cwd);
  res.json(feature);
});

// POST /api/sessions/:pid/features — create a new feature
router.post("/:pid/features", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const slug = body.slug as string | undefined;
  const title = body.title as string | undefined;
  const description = (body.description as string) ?? "";
  const acceptanceCriteria = (body.acceptanceCriteria as string[]) ?? [];
  const branch = body.branch as string | undefined;

  if (!slug || !title) {
    res.status(400).json({ error: "slug and title are required" });
    return;
  }

  // Pause any active feature before creating a new one
  await switchFeature(session.cwd, "__none__").catch(() => { /* ignore */ });

  const content = generateFeatureMarkdown({
    title,
    description,
    acceptanceCriteria,
    branch,
    cwd: session.cwd,
  });

  const feature = await createFeature(session.cwd, slug, content);
  res.json(feature);
});

// PUT /api/sessions/:pid/features/:slug — update feature (raw markdown)
router.put("/:pid/features/:slug", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const content = body.content as string | undefined;
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const slug = req.params.slug as string;
  const feature = await updateFeature(session.cwd, slug, content);
  res.json(feature);
});

// POST /api/sessions/:pid/features/:slug/complete — mark as completed
router.post("/:pid/features/:slug/complete", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const slug = req.params.slug as string;
  await completeFeature(session.cwd, slug);
  res.json({ ok: true });
});

// POST /api/sessions/:pid/features/:slug/activate — switch active feature
router.post("/:pid/features/:slug/activate", async (req, res) => {
  const session = await findSession(Number(req.params.pid));
  if (!session) { res.status(404).json({ error: "session not found" }); return; }

  const slug = req.params.slug as string;
  await switchFeature(session.cwd, slug);
  res.json({ ok: true });
});

export default router;
