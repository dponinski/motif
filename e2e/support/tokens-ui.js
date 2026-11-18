// The controls of the Tokens screen that sit in menus: narrowing the list (Filter), and the table's own actions.

// Chooses what the list shows (the name of a filter: "Changed", "Not in repository", "Read-only", "Unused", "Differ between themes", "Same in every theme", or "All").
async function setFilter(page, name) {
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("group", { name: "Show" }).getByRole("button", { name: new RegExp(`^${name}(?![A-Za-z])`) }).click();
}

// The filters on offer.
async function filtersOffered(page) {
  await page.getByRole("button", { name: "Filter" }).click();
  const names = await page.getByRole("group", { name: "Show" }).getByRole("button").evaluateAll((els) => els.map((e) => e.querySelector("span")?.textContent.trim()));
  await page.keyboard.press("Escape");
  return names;
}

// Puts each color in the group its name says.
async function regroup(page) {
  await page.getByRole("button", { name: "More table actions" }).click();
  await page.getByRole("menuitem", { name: /Regroup colors by name/ }).click();
}

// A color's row, by its name, and the button that opens its color editor (the swatch of its first theme).
const rowOf = (page, name) => page.locator('[data-token-id][data-token-kind="color"]').filter({ has: page.getByLabel(`Select ${name}`, { exact: true }) });
const swatchOf = (page, name) => rowOf(page, name).getByRole("button", { name: /^Edit .* \(.+\)$/ }).first();
// "name: #111827, #f9fafb": the values a color's row shows, a theme after another.
const labelOf = async (page, name) => `${name}: ${(await rowOf(page, name).locator('input[aria-label*=" value of "]').evaluateAll((els) => els.map((e) => e.value))).join(", ")}`;

module.exports = { setFilter, filtersOffered, regroup, rowOf, swatchOf, labelOf };
