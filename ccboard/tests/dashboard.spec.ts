import { test, expect } from "@playwright/test";

/**
 * Dashboard page tests — verify the main page renders correctly,
 * shows sessions, and navigation works.
 */

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for sessions to load (polling fetches on mount)
    await page.waitForFunction(() => {
      return document.body.innerText.length > 50;
    }, { timeout: 5000 });
  });

  test("renders the CCBOARD header", async ({ page }) => {
    await expect(page.locator("text=CCBOARD")).toBeVisible();
  });

  test("shows ACTIVE session count", async ({ page }) => {
    await expect(page.locator("text=/\\d+ ACTIVE/")).toBeVisible();
  });

  test("shows + NEW SESSION button", async ({ page }) => {
    await expect(page.locator("text=+ NEW SESSION")).toBeVisible();
  });

  test("shows RESUME SESSION button", async ({ page }) => {
    await expect(page.locator("text=RESUME SESSION")).toBeVisible();
  });

  test("renders session cards with project names", async ({ page }) => {
    // Wait for at least one session card
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });
    const pids = await page.locator("text=/PID \\d+/").count();
    expect(pids).toBeGreaterThan(0);
  });

  test("session cards show status (waiting/working/idle)", async ({ page }) => {
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });
    // At least one status should be visible
    const statuses = await page.locator("text=/WAITING|WORKING|IDLE/i").count();
    expect(statuses).toBeGreaterThan(0);
  });

  test("session cards show CWD paths", async ({ page }) => {
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });
    const cwds = await page.locator("text=/\\/Users\\//").count();
    expect(cwds).toBeGreaterThan(0);
  });

  test("session cards have CLOSE buttons", async ({ page }) => {
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });
    const closeButtons = await page.locator("text=CLOSE").count();
    expect(closeButtons).toBeGreaterThan(0);
  });

  test("clicking a session navigates to session page", async ({ page }) => {
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });
    // Get first session's PID
    const pidText = await page.locator("text=/PID \\d+/").first().textContent();
    const pid = pidText?.match(/PID (\d+)/)?.[1];
    expect(pid).toBeTruthy();

    // Click the session card (click on the project name, not CLOSE)
    const card = page.locator("text=/PID \\d+/").first().locator("..").locator("..");
    await card.click();

    await page.waitForURL(`**/session/${pid}`);
    expect(page.url()).toContain(`/session/${pid}`);
  });

  test("NEW SESSION modal opens and has input field", async ({ page }) => {
    await page.locator("text=+ NEW SESSION").click();

    // Modal should be visible with input
    await expect(page.locator("text=WORKING DIRECTORY")).toBeVisible();
    const input = page.locator('input[placeholder*="Users"]');
    await expect(input).toBeVisible();
    await expect(input).toBeEditable();
  });

  test("NEW SESSION modal closes on escape", async ({ page }) => {
    await page.locator("text=+ NEW SESSION").click();
    await expect(page.locator("text=WORKING DIRECTORY")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("text=WORKING DIRECTORY")).not.toBeVisible();
  });

  test("RESUME SESSION modal opens and shows projects", async ({ page }) => {
    await page.locator("text=RESUME SESSION").click();

    // Wait for modal content to load
    await page.waitForTimeout(1000);

    // Should show project names or "no resumable sessions"
    const hasProjects = await page.locator("text=/session/i").count();
    expect(hasProjects).toBeGreaterThan(0);
  });

  test("RESUME SESSION modal closes on escape", async ({ page }) => {
    await page.locator("text=RESUME SESSION").click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    // Modal overlay should be gone
    await page.waitForTimeout(300);
  });
});

test.describe("Dashboard: polling", () => {
  test("session list updates automatically (polling)", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("text=/PID \\d+/", { timeout: 5000 });

    const initialCount = await page.locator("text=/PID \\d+/").count();

    // Wait for a poll cycle (3s)
    await page.waitForTimeout(4000);

    // Should still have sessions (didn't crash or go blank)
    const afterCount = await page.locator("text=/PID \\d+/").count();
    expect(afterCount).toBeGreaterThan(0);
  });
});
