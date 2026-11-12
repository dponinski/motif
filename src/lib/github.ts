import { DOCUMENT_EXTENSION } from "./motif-document";

export interface RemoteFile {
  text: string;
  sha: string;
}

export interface RemoteEntry {
  path: string;
  name: string;
}

export interface PutFileArgs {
  path: string;
  branch: string;
  text: string;
  message: string;
  // Blob sha being replaced; omit when creating the file.
  sha?: string;
}

// The surface sync needs from a git host. GitHub is the only implementation today.
export interface GitHost {
  getRepo(): Promise<{ defaultBranch: string; canPush: boolean }>;
  listBranches(): Promise<string[]>;
  createBranch(name: string, from: string): Promise<void>;
  listDocuments(dir: string, branch: string): Promise<RemoteEntry[]>;
  getFile(path: string, branch: string): Promise<RemoteFile | null>;
  getBlob(sha: string): Promise<string | null>;
  putFile(args: PutFileArgs): Promise<{ sha: string; commitUrl: string }>;
}

export class GitHostError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
  // The file moved on the remote between our read and our write.
  get isStale() {
    return this.status === 409 || this.status === 422;
  }
}

export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(header.length + body.length);
  bytes.set(header);
  bytes.set(body, header.length);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function createGitHubClient(conn: { owner: string; repo: string; token: string }): GitHost {
  const root = `https://api.github.com/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}`;

  async function request<T>(path: string, init: { method?: string; body?: unknown; allow404?: boolean } = {}): Promise<T | null> {
    const res = await fetch(root + path, {
      method: init.method ?? "GET",
      // GitHub marks GETs cacheable for 60s; a stale sha would defeat conflict detection.
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${conn.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 404 && init.allow404) return null;
    if (!res.ok) {
      const detail = await res.json().then((j) => j?.message as string | undefined, () => undefined);
      const message =
        res.status === 401 ? "GitHub rejected the token" :
        res.status === 404 ? "Repository not found, or the token cannot access it" :
        detail ?? `GitHub request failed (${res.status})`;
      throw new GitHostError(message, res.status);
    }
    return res.json();
  }

  const getBlob = async (sha: string) => {
    const blob = await request<{ content: string }>(`/git/blobs/${sha}`, { allow404: true });
    return blob ? fromBase64(blob.content) : null;
  };

  return {
    async getRepo() {
      const repo = await request<{ default_branch: string; permissions?: { push?: boolean } }>("");
      return { defaultBranch: repo!.default_branch, canPush: repo!.permissions?.push ?? false };
    },

    async listBranches() {
      const names: string[] = [];
      for (let page = 1; ; page++) {
        const batch = await request<{ name: string }[]>(`/branches?per_page=100&page=${page}`);
        names.push(...batch!.map((b) => b.name));
        if (batch!.length < 100) return names;
      }
    },

    async createBranch(name, from) {
      const ref = await request<{ object: { sha: string } }>(`/git/ref/heads/${encodePath(from)}`);
      await request("/git/refs", { method: "POST", body: { ref: `refs/heads/${name}`, sha: ref!.object.sha } });
    },

    async listDocuments(dir, branch) {
      const entries = await request<{ type: string; name: string; path: string }[]>(
        `/contents/${encodePath(dir)}?ref=${encodeURIComponent(branch)}`,
        { allow404: true }
      );
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((e) => e.type === "file" && e.name.endsWith(DOCUMENT_EXTENSION))
        .map((e) => ({ path: e.path, name: e.name }));
    },

    async getFile(path, branch) {
      const file = await request<{ sha: string; content?: string; encoding?: string }>(
        `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
        { allow404: true }
      );
      if (!file) return null;
      // Files over 1 MB come back without inline content.
      const text = file.encoding === "base64" && file.content ? fromBase64(file.content) : await getBlob(file.sha);
      return text === null ? null : { text, sha: file.sha };
    },

    getBlob,

    async putFile({ path, branch, text, message, sha }) {
      const res = await request<{ content: { sha: string }; commit: { html_url: string } }>(
        `/contents/${encodePath(path)}`,
        { method: "PUT", body: { message, branch, content: toBase64(text), sha } }
      );
      return { sha: res!.content.sha, commitUrl: res!.commit.html_url };
    },
  };
}
