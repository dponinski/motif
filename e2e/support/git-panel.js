// The repository's tokens come into a Motif set with the first pull, when the project is opened (and the set is linked to the repository);
// the Sync tokens dialog then says the two have the same tokens. Waits for that, then closes the dialog.
async function tokensLinked(page) {
  await page.getByRole("button", { name: "Sync tokens" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Motif and the repository have the same tokens.").waitFor({ timeout: 60000 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

module.exports = { tokensLinked };
