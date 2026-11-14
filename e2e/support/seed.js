// Puts a project for a repository in the browser's storage, as creating one from the dashboard would.
const { APP_URL, APP_URL_OWN } = require("./env");

async function seedAt(base, page, id, { repo = "acme/ds", token = "t", name = "Acme DS", extra = {} } = {}) {
  await page.goto(`${base}/`);
  await page.evaluate(([id, repo, token, name, extra]) => {
    const [owner, r] = repo.split("/");
    const project = {
      id, name, createdAt: 1, updatedAt: 2,
      repo: { connection: { owner, repo: r, token, defaultBranch: "main" }, analysis: null, tokenLink: null },
      library: { source: null, components: [] },
      tokens: { sets: [{ id: "set-global", name: "Global", themes: [{ id: "theme-default", name: "Default" }], activeThemeId: "theme-default" }], colors: [], typography: [], spacing: [], radii: [], shadows: [], components: [] },
      docs: [],
      ...extra,
    };
    localStorage.setItem("motif-projects", JSON.stringify({ state: { projects: [project] }, version: 1 }));
    localStorage.setItem("motif-theme", JSON.stringify({ state: { mode: "light" }, version: 0 }));
  }, [id, repo, token, name, extra]);
}
// For the suites that use the shared server, and for those that start their own.
const seed = (page, id, options) => seedAt(APP_URL, page, id, options);
const seedDb = (page, id, options) => seedAt(APP_URL_OWN, page, id, options);
module.exports = { seed, seedDb };
