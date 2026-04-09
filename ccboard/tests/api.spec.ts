import { test, expect } from "@playwright/test";

/**
 * API endpoint tests — verify every endpoint returns correct shapes.
 * These run against the live server (localhost:3200).
 */

test.describe("API: /api/sessions", () => {
  test("GET /api/sessions returns array of sessions with required fields", async ({ request }) => {
    const res = await request.get("/api/sessions");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);

    // Every session must have these fields
    for (const s of data) {
      expect(s).toHaveProperty("pid");
      expect(s).toHaveProperty("sessionId");
      expect(s).toHaveProperty("cwd");
      expect(s).toHaveProperty("shortName");
      expect(s).toHaveProperty("status");
      expect(s).toHaveProperty("tty");
      expect(s).toHaveProperty("managed");
      expect(typeof s.pid).toBe("number");
      expect(typeof s.cwd).toBe("string");
      expect(["waiting", "working", "idle", "dead"]).toContain(s.status);
      expect(typeof s.managed).toBe("boolean");
    }
  });

  test("GET /api/sessions/:pid/context returns token counts", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    const res = await request.get(`/api/sessions/${pid}/context`);
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data).toHaveProperty("totalContextTokens");
    expect(data).toHaveProperty("totalTurns");
    expect(data).toHaveProperty("totalToolCalls");
    expect(data).toHaveProperty("totalMessages");
    expect(typeof data.totalContextTokens).toBe("number");
    expect(typeof data.totalTurns).toBe("number");
    expect(data.totalContextTokens).toBeGreaterThanOrEqual(0);
  });

  test("GET /api/sessions/:pid/messages returns array of chat messages", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    const res = await request.get(`/api/sessions/${pid}/messages`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      expect(data[0]).toHaveProperty("role");
      expect(data[0]).toHaveProperty("text");
      expect(["human", "assistant"]).toContain(data[0].role);
      expect(typeof data[0].text).toBe("string");
    }
  });

  test("GET /api/sessions/:pid/actions returns array of action turns", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    const res = await request.get(`/api/sessions/${pid}/actions`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      expect(data[0]).toHaveProperty("humanMessage");
      expect(data[0]).toHaveProperty("actions");
      expect(Array.isArray(data[0].actions)).toBe(true);
    }
  });

  test("GET /api/sessions/99999/context returns 404 for nonexistent PID", async ({ request }) => {
    const res = await request.get("/api/sessions/99999/context");
    expect(res.status()).toBe(404);
  });
});

test.describe("API: /api/sessions/:pid/supervisor", () => {
  test("GET supervisor status returns active/inactive", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    const res = await request.get(`/api/sessions/${pid}/supervisor`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("active");
    expect(typeof data.active).toBe("boolean");
    if (data.active) {
      expect(data).toHaveProperty("tmuxSession");
      expect(typeof data.tmuxSession).toBe("string");
    }
  });

  test("GET supervisor messages returns array", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    // Find a session with an active supervisor
    const managed = sessions.find((s: Record<string, unknown>) => s.managed);
    if (!managed) { test.skip(); return; }

    const res = await request.get(`/api/sessions/${managed.pid}/supervisor/messages`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET supervisor messages supports ?limit parameter", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const managed = sessions.find((s: Record<string, unknown>) => s.managed);
    if (!managed) { test.skip(); return; }

    const res = await request.get(`/api/sessions/${managed.pid}/supervisor/messages?limit=5`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);
  });
});

test.describe("API: /api/sessions/:pid/supervisor/reviews", () => {
  test("GET reviews returns categories array with normalised fields", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    // Find Dialler which has reviews
    const dialler = sessions.find((s: Record<string, unknown>) => s.shortName === "Dialler");
    if (!dialler) { test.skip(); return; }

    const res = await request.get(`/api/sessions/${dialler.pid}/supervisor/reviews`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("categories");
    expect(Array.isArray(data.categories)).toBe(true);

    for (const cat of data.categories) {
      // Every category must have normalised fields
      expect(cat).toHaveProperty("category");
      expect(cat).toHaveProperty("status");
      expect(cat).toHaveProperty("summary");
      expect(cat).toHaveProperty("findingCount");
      expect(cat).toHaveProperty("isVerdict");
      expect(cat).toHaveProperty("report");
      expect(typeof cat.category).toBe("string");
      expect(typeof cat.summary).toBe("string"); // MUST be string, not object
      expect(typeof cat.findingCount).toBe("number");
      expect(typeof cat.isVerdict).toBe("boolean");
      expect(["ok", "warning", "issue", "critical"]).toContain(cat.status);

      // Report must be normalised
      expect(cat.report).toHaveProperty("_normalised");
      expect(cat.report._normalised).toBe(true);
      expect(cat.report).toHaveProperty("findings");
      expect(Array.isArray(cat.report.findings)).toBe(true);
    }
  });

  test("reviews categories are sorted with verdict first", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const dialler = sessions.find((s: Record<string, unknown>) => s.shortName === "Dialler");
    if (!dialler) { test.skip(); return; }

    const res = await request.get(`/api/sessions/${dialler.pid}/supervisor/reviews`);
    const data = await res.json();
    if (data.categories.length === 0) { test.skip(); return; }

    const verdictIdx = data.categories.findIndex((c: Record<string, unknown>) => c.isVerdict);
    if (verdictIdx >= 0) {
      expect(verdictIdx).toBe(0); // verdict must be first
    }
  });

  test("review findings have _group tags", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const dialler = sessions.find((s: Record<string, unknown>) => s.shortName === "Dialler");
    if (!dialler) { test.skip(); return; }

    const res = await request.get(`/api/sessions/${dialler.pid}/supervisor/reviews`);
    const data = await res.json();

    for (const cat of data.categories) {
      for (const finding of cat.report.findings) {
        expect(finding).toHaveProperty("_group");
        expect(typeof finding._group).toBe("string");
      }
    }
  });
});

test.describe("API: /api/resumable", () => {
  test("GET /api/resumable returns array of resumable sessions", async ({ request }) => {
    const res = await request.get("/api/resumable");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);

    if (data.length > 0) {
      expect(data[0]).toHaveProperty("sessionId");
      expect(data[0]).toHaveProperty("cwd");
      expect(data[0]).toHaveProperty("shortName");
      expect(data[0]).toHaveProperty("lastModified");
      expect(typeof data[0].sessionId).toBe("string");
      expect(typeof data[0].lastModified).toBe("number");
    }
  });
});

test.describe("API: SSE endpoints", () => {
  test("GET /api/sessions/:pid/stream returns SSE with connected event", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    // Fetch with a short timeout — SSE will send at least the connected event
    const res = await request.get(`/api/sessions/${pid}/stream`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain('"type":"connected"');
  });

  test("GET /api/sessions/:pid/action-stream returns SSE", async ({ request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    const pid = sessions[0].pid;

    const res = await request.get(`/api/sessions/${pid}/action-stream`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
  });
});
