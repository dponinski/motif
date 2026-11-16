// Sending the editor's changes through the Sync panel, for the suites that used to open the pull request dialog.
async function openSync(page) {
  // The panel is loaded when first opened: give one that was just asked for a moment to appear before opening it again.
  await page.getByRole("status", { name: "Sync status" }).waitFor({ timeout: 2000 }).catch(() => {});
  if (!(await page.getByRole("status", { name: "Sync status" }).count())) await page.locator('nav button[title="Source control"]').click();
  await page.getByRole("status", { name: "Sync status" }).waitFor();
}
async function syncNow(page, number) {
  await openSync(page);
  await page.getByRole("button", { name: "Push" }).click();
  await page.waitForFunction((n) => new RegExp(`In sync with pull request #${n ?? "\\d+"}`).test(document.querySelector('[aria-label="Sync status"]')?.textContent ?? ""), number, { timeout: 30000 });
}
module.exports = { openSync, syncNow };
