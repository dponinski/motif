// The repository is pulled when a project is opened: its components are in the list and its tokens are a set linked to it, with nothing pressed.

// Waits for the components of the repository to be in the Components panel (which is open when the project is).
async function componentsReady(page) {
  await page.locator("aside button[title*='src/']").first().waitFor({ timeout: 90000 });
}

// Opens Source control (when it isn't) and waits for it to say the tokens are linked to the repository; leaves it open.
async function openSourceControl(page) {
  if (!(await page.locator("[data-token-link]").isVisible().catch(() => false))) {
    await page.locator('nav button[title="Source control"]').click();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  await page.locator("[data-token-link]").waitFor({ timeout: 90000 });
}

// The tokens are linked (see openSourceControl); the Components panel is shown again afterwards.
async function tokensLinked(page) {
  await openSourceControl(page);
  await page.locator('nav button[title="Components"]').click();
  await page.waitForLoadState("networkidle").catch(() => {});
}

// Opens the panel's "Repository" details (the scan summary, the branch to scan, the report), which are closed until they are wanted.
async function openDetails(page) {
  const details = page.locator("[data-details]");
  await details.waitFor({ timeout: 30000 });
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
}

module.exports = { componentsReady, openSourceControl, tokensLinked, openDetails };
