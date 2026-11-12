// "owner/name", a github.com URL or an ssh/clone address, as the owner and name of a repository.
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const match = input.trim().replace(/\/$/, "").replace(/\.git$/, "").match(/(?:^|github\.com[/:])([\w.-]+)\/([\w.-]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}
