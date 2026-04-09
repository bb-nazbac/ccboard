import { test, expect } from "@playwright/test";

/**
 * Theme tests — verify dark/light theme toggle persists across navigation.
 */

test.describe("Theme", () => {
  test("defaults to dark theme", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    // Should be either "dark" or null (which means dark by default)
    expect(theme === "dark" || theme === null).toBe(true);
  });

  test("Cmd+Shift+P opens command palette", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await page.keyboard.press("Meta+Shift+p");
    await page.waitForTimeout(300);

    await expect(page.locator("input[placeholder*='command' i]")).toBeVisible();
  });

  test("command palette closes on Escape", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    await page.keyboard.press("Meta+Shift+p");
    await page.waitForTimeout(300);
    await expect(page.locator("input[placeholder*='command' i]")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(page.locator("input[placeholder*='command' i]")).not.toBeVisible();
  });

  test("theme toggle via command palette switches to light", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Open palette
    await page.keyboard.press("Meta+Shift+p");
    await page.waitForTimeout(300);

    // Type "light" to filter
    await page.locator("input[placeholder*='command' i]").fill("light");
    await page.waitForTimeout(200);

    // Press Enter to execute
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);

    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(theme).toBe("light");

    // Verify localStorage was set
    const stored = await page.evaluate(() =>
      localStorage.getItem("ccboard-theme")
    );
    expect(stored).toBe("light");
  });

  test("theme persists across page navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Set light theme via localStorage directly (simulating command palette)
    await page.evaluate(() => {
      localStorage.setItem("ccboard-theme", "light");
      document.documentElement.setAttribute("data-theme", "light");
    });

    // Navigate to a session page
    const sessions = await (await page.request.get("/api/sessions")).json();
    if (sessions.length === 0) { test.skip(); return; }

    await page.goto(`/session/${sessions[0].pid}`);
    await page.waitForTimeout(1000);

    // Theme should still be light
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(theme).toBe("light");
  });

  test("theme persists after navigating back to dashboard", async ({ page }) => {
    // Set light theme
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("ccboard-theme", "light");
    });

    // Navigate away and back
    const sessions = await (await page.request.get("/api/sessions")).json();
    if (sessions.length === 0) { test.skip(); return; }

    await page.goto(`/session/${sessions[0].pid}`);
    await page.waitForTimeout(500);
    await page.goto("/");
    await page.waitForTimeout(1000);

    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(theme).toBe("light");

    // Clean up: reset to dark
    await page.evaluate(() => {
      localStorage.setItem("ccboard-theme", "dark");
    });
  });
});
