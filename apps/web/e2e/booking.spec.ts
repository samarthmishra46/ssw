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

/** Pick a time and hold it. Another test running in parallel may take it first: then pick again. */
async function holdRandomSlot(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await pickRandomSlot(page);
    await page.getByRole("button", { name: /Continue to pay/ }).click();
    const held = page.getByText(/Held for you until/);
    const taken = page.getByText(/that time was just taken/);
    await expect(held.or(taken)).toBeVisible();
    if (await held.isVisible()) return;
  }
  throw new Error("could not hold a slot");
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
  // Typed or autofilled with the country code: the form keeps the 10-digit number.
  const mobile = phone();
  await page.locator("#mob").fill(`+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`);
  await page.locator("#mob").blur();
  await expect(page.locator("#mob")).toHaveValue(mobile);
  await page.locator(".check input").first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 2 opens in a pop-up, with the page's centre shown and not editable.
  const popup = page.getByRole("dialog", { name: "Book your consultation" });
  await expect(popup).toBeVisible();
  await expect(popup.locator(".stepper .on")).toContainText("Day and time");
  await expect(popup.locator(".bk-centre")).toContainText("Ahmedabad");
  await expect(popup.locator(".bk-centre").locator("input, select")).toHaveCount(0);

  // Closing keeps the booking: the card offers to continue.
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await page.getByRole("button", { name: "Continue booking" }).click();
  await expect(popup).toBeVisible();

  await holdRandomSlot(page);

  // Step 3 (Esc still closes the pop-up after the step changed)
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await page.getByRole("button", { name: "Continue booking" }).click();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await expect(page.locator(".err")).toContainText("agree to the Terms");
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await page.getByRole("button", { name: "Payment succeeds" }).click();

  await expect(popup.getByRole("heading", { name: /You're booked, Asha/ })).toBeVisible();
  await expect(popup.getByText(/AHM-\d{6}/)).toBeVisible();
  await expect(popup.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", /\/api\/bookings\/ics\?token=/);

  // Closed, the card keeps a short summary of the booking.
  await popup.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("#flow").getByRole("heading", { name: /You're booked, Asha/ })).toBeVisible();
});

test("failed payment keeps the slot and allows a retry", async ({ page }) => {
  await page.goto("/ahmedabad/sleep");
  await page.locator("#nm").fill("Neha Shah");
  await page.locator("#mob").fill(phone());
  await page.locator(".check input").first().check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await holdRandomSlot(page);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole("button", { name: /Pay ₹500 and confirm/ }).click();
  await page.getByRole("button", { name: "Payment fails" }).click();

  await expect(page.getByRole("dialog").getByRole("heading", { name: /payment didn't go through/ })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /Pay ₹500 and confirm/ })).toBeVisible();
});
