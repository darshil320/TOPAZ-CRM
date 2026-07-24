import { test, expect } from "@playwright/test";

/**
 * Phase 2A money path (module 07 gate). MANUAL / CI only — needs the full stack
 * (supabase + api + worker + dashboard) and a seeded sales login. Selectors are
 * intentionally text-based to survive minor markup changes; adjust the login
 * step + credentials to the environment before running.
 *
 * Flow: login (sales) → build quote (2 items + discount) → send → open public
 * /q/[token] → approve → order auto-creatable → record advance → outstanding drops.
 */

const SALES_EMAIL = process.env.E2E_SALES_EMAIL ?? "sales@topaz.test";
const SALES_PASSWORD = process.env.E2E_SALES_PASSWORD ?? "";

test.skip(!SALES_PASSWORD, "Set E2E_SALES_EMAIL / E2E_SALES_PASSWORD to run the money path");

test("quote → approve → order → payment", async ({ page }) => {
  // 1. Login
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(SALES_EMAIL);
  await page.getByLabel(/password/i).fill(SALES_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // 2. New quote
  await page.goto("/dashboard/quotes/new");
  await page.getByPlaceholder(/search customer/i).click();
  await page.getByRole("button").filter({ hasText: /.+/ }).first().click(); // pick first customer
  await page.getByPlaceholder(/leather sofa/i).first().fill("Test Sofa");
  // unit price on the first line
  await page.getByLabel(/unit price/i).first().fill("10000");
  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/quotes\/[0-9a-f-]{36}/);

  // 3. Send → status becomes Sent
  await page.getByRole("button", { name: /send to customer/i }).click();
  await expect(page.getByText(/queued|sent/i)).toBeVisible();

  // NOTE: the public approval step + order creation + payment recording continue
  // here once a mock-WA flag or a captured approval_token is wired for CI.
  // The backend halves of this flow are covered by the empirical pytest suites
  // (test_quotations_send_empirical, test_orders_empirical, test_payments_empirical).
});
