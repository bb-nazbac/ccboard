import { test, expect } from "@playwright/test";

test("clicking review row opens modal without crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    console.log("JS ERROR:", err.message);
    errors.push(err.message);
  });

  const sessions = await (await page.request.get("http://localhost:3200/api/sessions")).json();
  const dialler = sessions.find((s: Record<string, unknown>) => s.shortName === "Dialler");
  if (!dialler) { console.log("No Dialler session"); test.skip(); return; }

  console.log("Navigating to session", dialler.pid);
  await page.goto(`http://localhost:3200/session/${dialler.pid}`);

  // Wait for reviews to load (15s poll cycle)
  console.log("Waiting for reviews to appear...");
  try {
    await page.waitForSelector("text=/SECURITY|CORRECTNESS|PERFORMANCE/i", { timeout: 20000 });
  } catch {
    console.log("Reviews never appeared. Page text:", await page.evaluate(() => document.body.innerText.slice(0, 500)));
    await page.screenshot({ path: "test-results/no-reviews.png" });
    test.fail();
    return;
  }

  await page.screenshot({ path: "test-results/before-click.png" });
  console.log("Reviews visible, clicking first row...");

  // Click the first review text
  const row = page.locator("text=/SECURITY|CORRECTNESS|PERFORMANCE/i").first();
  await row.click();
  await page.waitForTimeout(1000);

  await page.screenshot({ path: "test-results/after-click.png" });

  // Check body isn't blank
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("Body text length after click:", bodyText.length);

  const critical = errors.filter(e => !e.includes("favicon"));
  if (critical.length > 0) {
    console.log("CRITICAL ERRORS:", JSON.stringify(critical, null, 2));
  }

  // Must not be blank AND must not have errors
  expect(bodyText.length).toBeGreaterThan(50);
  expect(critical).toEqual([]);
});
