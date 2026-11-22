import { expect, test } from "@playwright/test";

const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

/** Pick a random open day and time, so parallel runs don't compete for the same slot. */
async function pickRandomSlot(page: import("@playwright/test").Page) {
  const days = page.getByRole("group", { name: "Day" }).getByRole("button", { disabled: false });
  await days.first().waitFor();
  await days.nth(Math.floor(Math.random() * (await days.count()))).click();
  const times = page.getByRole("group", { name: "Time" }).getByRole("button");
  await times.first().waitFor();
  await times.nth(Math.floor(Math.random() * (await times.count()))).click();
}

test("books and pays for a consultation for a parent (test-mode payment)", async ({ page }) => {
  await page.goto("/ahmedabad/joints?utm_source=facebook&utm_campaign=e2e");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("stairs");

  // The aside button preselects "My parent".
  await page.getByRole("link", { name: "Book for my parent" }).click();
  await expect(page.locator("#who")).toHaveValue("My parent");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".err")).toContainText("tick the box");

  await page.locator("#nm").fill("Asha Patel");
  await page.locator("#their").fill("Ramesh Patel");
  await page.locator("#mob").fill(phone());
  await page.locator(".check input").first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 2: pick the first available day and time.
  await expect(page.locator(".stepper .on")).toContainText("Day and time");
  await pickRandomSlot(page);
  await page.getByRole("button", { name: /Continue to pay/ }).click();

  // Step 3
  await expect(page.getByText(/Held for you until/)).toBeVisible();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await expect(page.locator(".err")).toContainText("agree to the Terms");
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await page.getByRole("button", { name: "Payment succeeds" }).click();

  await expect(page.getByRole("heading", { name: /You're booked, Asha/ })).toBeVisible();
  await expect(page.getByText(/AHM-\d{6}/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", /\/api\/bookings\/ics\?token=/);
});

test("failed payment keeps the slot and allows a retry", async ({ page }) => {
  await page.goto("/ahmedabad/sleep");
  await page.locator("#nm").fill("Neha Shah");
  await page.locator("#mob").fill(phone());
  await page.locator(".check input").first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await pickRandomSlot(page);
  await page.getByRole("button", { name: /Continue to pay/ }).click();
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await page.getByRole("button", { name: "Payment fails" }).click();

  await expect(page.getByRole("heading", { name: /payment didn't go through/ })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /Pay ₹500 and confirm/ })).toBeVisible();
});
