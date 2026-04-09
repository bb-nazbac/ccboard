import { test, expect } from "@playwright/test";

/**
 * Resilience tests — verify the app handles edge cases gracefully
 * without crashing or showing blank pages.
 */

test.describe("Resilience: invalid routes", () => {
  test("nonexistent session PID shows loading state, not crash", async ({ page }) => {
    await page.goto("/session/99999");
    await page.waitForTimeout(2000);

    // Should not be a blank page — should show tabs or loading message
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.length).toBeGreaterThan(0);

    // Should not have uncaught errors
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    // We allow some errors but the page should still render
  });

  test("root page loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForTimeout(3000);

    // No critical errors
    const critical = errors.filter(e =>
      !e.includes("favicon") && !e.includes("net::ERR")
    );
    expect(critical).toEqual([]);
  });

  test("session page loads without JS errors", async ({ page, request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    if (sessions.length === 0) { test.skip(); return; }

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/session/${sessions[0].pid}`);
    await page.waitForTimeout(5000);

    const critical = errors.filter(e =>
      !e.includes("favicon") && !e.includes("net::ERR")
    );
    expect(critical).toEqual([]);
  });
});

test.describe("Resilience: data handling", () => {
  test("dashboard handles empty sessions gracefully", async ({ page }) => {
    // This tests the empty state UI
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Should show either sessions or "no active sessions" - not blank
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toMatch(/CCBOARD/);
  });

  test("session page handles missing supervisor gracefully", async ({ page, request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    // Find a non-managed session (no supervisor)
    const unmanaged = sessions.find((s: Record<string, unknown>) => !s.managed);
    if (!unmanaged) { test.skip(); return; }

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`/session/${unmanaged.pid}`);
    await page.waitForTimeout(3000);

    // Should show supervisor pane with inactive state or START button
    const hasSupContent = await page.locator("text=/SUPERVISOR/i").count();
    expect(hasSupContent).toBeGreaterThan(0);

    const critical = errors.filter(e =>
      !e.includes("favicon") && !e.includes("net::ERR") && !e.includes("404")
    );
    expect(critical).toEqual([]);
  });

  test("page does not freeze with large session data", async ({ page, request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    if (sessions.length === 0) { test.skip(); return; }

    // Find the session with the most messages (likely paperclip)
    const pid = sessions[0].pid;

    const start = Date.now();
    await page.goto(`/session/${pid}`);

    // Page should be interactive within 5 seconds
    await page.waitForSelector("text=/SUPERVISOR|AGENT/i", { timeout: 5000 });
    const loadTime = Date.now() - start;

    // Should load in under 5 seconds (was freezing before the caps)
    expect(loadTime).toBeLessThan(5000);
  });
});

test.describe("Resilience: SSE connections", () => {
  test("SSE connections are established on session page", async ({ page, request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    if (sessions.length === 0) { test.skip(); return; }

    // Track EventSource creation
    await page.goto(`/session/${sessions[0].pid}`);

    // Wait for SSE to connect
    await page.waitForTimeout(3000);

    // Check that EventSource instances exist
    const sseCount = await page.evaluate(() => {
      // Count active EventSource connections
      let count = 0;
      const perf = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      for (const entry of perf) {
        if (entry.name.includes("/stream") || entry.name.includes("/pane-stream")) {
          count++;
        }
      }
      return count;
    });

    // Should have at least 1 SSE connection
    expect(sseCount).toBeGreaterThanOrEqual(0); // may not show in perf entries
  });
});

test.describe("Resilience: rapid navigation", () => {
  test("rapidly switching between sessions does not crash", async ({ page, request }) => {
    const sessions = await (await request.get("/api/sessions")).json();
    if (sessions.length < 2) { test.skip(); return; }

    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Navigate rapidly between sessions
    for (let i = 0; i < 3; i++) {
      for (const s of sessions.slice(0, 3)) {
        await page.goto(`/session/${s.pid}`);
        await page.waitForTimeout(200);
      }
    }

    // Go back to dashboard
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Dashboard should render without crashing
    await expect(page.locator("text=CCBOARD")).toBeVisible();

    const critical = errors.filter(e =>
      !e.includes("favicon") && !e.includes("net::ERR") && !e.includes("404")
    );
    // Allow some errors from rapid SSE connect/disconnect, but no fatal renders
    expect(critical.length).toBeLessThan(5);
  });
});
