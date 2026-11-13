import { GitHostError } from "./github";

// What a signed-in person has given the GitHub App access to: the accounts it is installed on, and the repositories
// of each. The app can only reach a repository where it is installed and the person has access, so this is the list
// of what a project can be made from.

export interface Installation {
  id: number;
  account: string;
  // "all" repositories of the account, or only the ones that were chosen.
  selection: "all" | "selected";
}

export interface InstalledRepo {
  owner: string;
  name: string;
  private: boolean;
  installation: number;
}

export interface Viewer {
  login: string;
  avatar: string | null;
}

const API = "https://api.github.com";
const MAX_REPOS = 500;

async function get<T>(token: string, path: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) {
    const detail = await res.json().then((j) => j?.message as string | undefined, () => undefined);
    throw new GitHostError(res.status === 401 ? "Your GitHub sign-in has expired. Sign in again." : detail ?? `GitHub request failed (${res.status})`, res.status);
  }
  return res.json();
}

export async function getViewer(token: string, fetchImpl: typeof fetch = fetch): Promise<Viewer> {
  const user = await get<{ login: string; avatar_url?: string }>(token, "/user", fetchImpl);
  return { login: user.login, avatar: typeof user.avatar_url === "string" ? user.avatar_url : null };
}

export async function listInstallations(token: string, fetchImpl: typeof fetch = fetch): Promise<Installation[]> {
  const out: Installation[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = await get<{ installations: { id: number; account?: { login?: string } | null; repository_selection?: string }[] }>(token, `/user/installations?per_page=100&page=${page}`, fetchImpl);
    for (const i of body.installations) out.push({ id: i.id, account: i.account?.login ?? "unknown", selection: i.repository_selection === "all" ? "all" : "selected" });
    if (body.installations.length < 100) break;
  }
  return out;
}

export async function listInstalledRepos(token: string, installation: number, fetchImpl: typeof fetch = fetch): Promise<InstalledRepo[]> {
  const out: InstalledRepo[] = [];
  for (let page = 1; out.length < MAX_REPOS; page++) {
    const body = await get<{ repositories: { name: string; private?: boolean; owner?: { login?: string } }[] }>(token, `/user/installations/${installation}/repositories?per_page=100&page=${page}`, fetchImpl);
    for (const r of body.repositories) out.push({ owner: r.owner?.login ?? "", name: r.name, private: !!r.private, installation });
    if (body.repositories.length < 100) break;
  }
  return out.filter((r) => r.owner).slice(0, MAX_REPOS);
}

// Every repository the app can be used on, with the accounts it is installed on.
export async function listAll(token: string, fetchImpl: typeof fetch = fetch): Promise<{ installations: Installation[]; repos: InstalledRepo[] }> {
  const installations = await listInstallations(token, fetchImpl);
  const lists = await Promise.all(installations.map((i) => listInstalledRepos(token, i.id, fetchImpl)));
  const repos = lists.flat().sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
  return { installations, repos };
}
