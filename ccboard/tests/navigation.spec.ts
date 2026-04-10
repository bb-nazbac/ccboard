import { test, expect } from "@playwright/test";

test("CCBOARD logo navigates to dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const sessions = await (await page.request.get("http://localhost:3200/api/sessions")).json();
  if (sessions.length === 0) { test.skip(); return; }

  await page.goto(`http://localhost:3200/session/${sessions[0].pid}`);
  await page.waitForTimeout(2000);

  // Click CCBOARD logo
  await page.locator("text=CCBOARD").first().click();
  await page.waitForURL("**/", { timeout: 5000 });
  expect(page.url()).toBe("http://localhost:3200/");

  const critical = errors.filter(e => !e.includes("favicon"));
  expect(critical).toEqual([]);
});

test("clicking session tab navigates to that session", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const sessions = await (await page.request.get("http://localhost:3200/api/sessions")).json();
  if (sessions.length < 2) { test.skip(); return; }

  await page.goto(`http://localhost:3200/session/${sessions[0].pid}`);
  await page.waitForTimeout(3000);

  // Find a tab that's NOT the current session
  const otherSession = sessions[1];
  const tab = page.locator(`text=${otherSession.shortName}`).first();
  await expect(tab).toBeVisible({ timeout: 5000 });

  console.log("Clicking tab for", otherSession.shortName, otherSession.pid);
  await tab.click();

  // Should navigate
  await page.waitForURL(`**/session/${otherSession.pid}`, { timeout: 5000 });
  expect(page.url()).toContain(`/session/${otherSession.pid}`);

  const critical = errors.filter(e => !e.includes("favicon"));
  expect(critical).toEqual([]);
});

test("session page doesn't have JS errors on load", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    console.log("JS ERROR:", err.message);
    errors.push(err.message);
  });

  const sessions = await (await page.request.get("http://localhost:3200/api/sessions")).json();
  if (sessions.length === 0) { test.skip(); return; }

  await page.goto(`http://localhost:3200/session/${sessions[0].pid}`);
  await page.waitForTimeout(5000);

  const critical = errors.filter(e => !e.includes("favicon") && !e.includes("net::ERR"));
  if (critical.length > 0) console.log("ERRORS:", critical);
  expect(critical).toEqual([]);
});
