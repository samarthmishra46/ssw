import { expect, test } from "@playwright/test";

/**
 * Booking with doctors from I AM (server running with CALENDAR_MODE=iam against I AM staging).
 * Skipped unless E2E_IAM=1. Creates a real booking on I AM staging (test-mode payment).
 */
test.skip(process.env.E2E_IAM !== "1", "needs a server in I AM mode (E2E_IAM=1)");

const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

test("chooses an I AM doctor, sees their fee, books and pays", async ({ page }) => {
  await page.goto("/ahmedabad/joints");
  await page.locator("#who").selectOption("Myself");
  await page.locator("#nm").fill("SSW QA Tester");
  await page.locator("#mob").fill(phone());
  await page.locator("#lang").selectOption("Hindi");
  await page.locator(".check input").first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.locator(".stepper .on")).toContainText("Doctor and time");
  const doctors = page.getByRole("group", { name: "Doctor" }).getByRole("button");
  await doctors.first().waitFor();
  const count = await doctors.count();

  // First doctor with a free time.
  let fee = "";
  let name = "";
  for (let i = 0; i < count; i++) {
    const d = doctors.nth(i);
    await d.click();
    const days = page.getByRole("group", { name: "Day" }).getByRole("button", { disabled: false });
    const none = page.getByText(/has no free times/);
    await expect(days.first().or(none)).toBeVisible({ timeout: 30_000 });
    if (await none.isVisible()) continue;
    name = (await d.locator(".doc-name").textContent()) ?? "";
    fee = (await d.locator(".doc-fee").textContent()) ?? "";
    // Random day and time, so parallel runs (phone + desktop) don't compete for one slot.
    await days.nth(Math.floor(Math.random() * (await days.count()))).click();
    const times = page.getByRole("group", { name: "Time" }).getByRole("button");
    await times.first().waitFor();
    await times.nth(Math.floor(Math.random() * (await times.count()))).click();
    break;
  }
  expect(fee, "no doctor with free times").toMatch(/^₹[\d.]+$/);

  const emailBox = page.locator("#appem");
  if (await emailBox.isVisible()) await emailBox.fill(`ssw.qa+${Date.now()}@example.com`);
  await page.getByRole("button", { name: `Continue to pay ${fee}` }).click();

  await expect(page.locator(".summary")).toContainText(name);
  await expect(page.locator(".summary .amt")).toContainText(fee);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: `Pay ${fee} and confirm` }).click();
  await page.getByRole("button", { name: "Payment succeeds" }).click();
  await expect(page.getByRole("heading", { name: /You're booked, SSW/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(name).first()).toBeVisible();
});
