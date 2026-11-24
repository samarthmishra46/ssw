import { expect, test } from "@playwright/test";

/** The centre page, moving between consultations, and the redirect for unknown addresses. */

test("unknown addresses go to the Ahmedabad page, keeping ad parameters", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ahmedabad$/);

  await page.goto("/mumbai/knees?utm_source=facebook&fbclid=abc");
  await expect(page).toHaveURL(/\/ahmedabad\?utm_source=facebook&fbclid=abc$/);

  await page.goto("/ahmedabad/not-a-page");
  await expect(page).toHaveURL(/\/ahmedabad$/);

  // Real pages are left alone.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
});

test("the Ahmedabad page offers all three consultations", async ({ page }) => {
  await page.goto("/ahmedabad");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ahmedabad");

  const cards = page.locator("#concerns").getByRole("link");
  await expect(cards).toHaveText(["Knees · Back · Joints", "Sleep · Stress · Relaxation", "Women's wellness"]);

  const nav = page.getByRole("navigation", { name: /Consultations at/ });
  await expect(nav.getByRole("link", { name: "All consultations" })).toHaveAttribute("aria-current", "page");

  await page.locator("#concerns").getByRole("link", { name: "Sleep · Stress · Relaxation" }).click();
  await expect(page).toHaveURL(/\/ahmedabad\/sleep$/);
  await expect(page.locator("#flow")).toBeVisible(); // the booking form is on the consultation page
});

test("each consultation page links to the other two", async ({ page }) => {
  for (const [slug, others] of [
    ["joints", ["Sleep · Stress · Relaxation", "Women's wellness"]],
    ["sleep", ["Knees · Back · Joints", "Women's wellness"]],
    ["women", ["Knees · Back · Joints", "Sleep · Stress · Relaxation"]],
  ] as const) {
    await page.goto(`/ahmedabad/${slug}`);
    const nav = page.getByRole("navigation", { name: /Consultations at/ });
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute("href", `/ahmedabad/${slug}`);
    await expect(page.locator("section.concerns").getByRole("link")).toHaveText([...others]);
  }

  // From Joints to Women through the switcher, and back to all consultations through the logo.
  await page.goto("/ahmedabad/joints");
  await page.getByRole("navigation", { name: /Consultations at/ }).getByRole("link", { name: "Women's wellness" }).click();
  await expect(page).toHaveURL(/\/ahmedabad\/women$/);
  await page.getByRole("link", { name: /all consultations/ }).first().click();
  await expect(page).toHaveURL(/\/ahmedabad$/);
});
