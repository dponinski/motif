import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { OidcError, appleClientSecret, authorizeUrl, discover, exchangeCode, forgetDiscoveries, pkce, verifyIdToken, type Discovery } from "./oidc";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";

// A provider that publishes keys over a real (local) HTTP server, since the keys are fetched the way a real
// provider's are.
async function provider(): Promise<{ d: Discovery; sign: (claims: Record<string, unknown>, opts?: { exp?: string }) => Promise<string>; close: () => void; server: Server }> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const d: Discovery = { issuer: "https://idp.test", authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` };
  const sign = (claims: Record<string, unknown>, opts: { exp?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime(opts.exp ?? "5m").sign(privateKey);
  return { d, sign, close: () => server.close(), server };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => forgetDiscoveries());

describe("discovering a provider", () => {
  it("reads where its endpoints and keys are, and remembers for an hour", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return json({ issuer: "https://idp.test", authorization_endpoint: "https://idp.test/a", token_endpoint: "https://idp.test/t", jwks_uri: "https://idp.test/k" }); }) as unknown as typeof fetch;
    const d = await discover("https://idp.test", fetchImpl, 0);
    expect(d.token_endpoint).toBe("https://idp.test/t");
    await discover("https://idp.test", fetchImpl, 30 * 60_000);
    expect(calls).toBe(1);
    await discover("https://idp.test", fetchImpl, 61 * 60_000);
    expect(calls).toBe(2);
  });

  it("refuses an answer that is missing endpoints, or a provider that doesn't answer", async () => {
    await expect(discover("https://a.test", (async () => json({ issuer: "x" })) as unknown as typeof fetch)).rejects.toThrow(/incomplete/);
    await expect(discover("https://b.test", (async () => json({}, 500)) as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});

describe("the way to the provider and back", () => {
  it("builds the address with its parameters, and a PKCE pair that matches", () => {
    const url = new URL(authorizeUrl({ issuer: "i", authorization_endpoint: "https://idp.test/authorize?x=1", token_endpoint: "", jwks_uri: "" }, { client_id: "c", state: "s s" }));
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("client_id")).toBe("c");
    expect(url.searchParams.get("state")).toBe("s s");
    const { verifier, challenge } = pkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkce().verifier).not.toBe(verifier);
  });

  it("trades a code for a token, and says when the provider is down or refuses", async () => {
    const d = { issuer: "i", authorization_endpoint: "", token_endpoint: "https://idp.test/token", jwks_uri: "" };
    const seen: string[] = [];
    const ok = (async (_u: string, init: RequestInit) => { seen.push(String(init.body)); return json({ id_token: "T" }); }) as unknown as typeof fetch;
    expect(await exchangeCode(d, { code: "c1", grant_type: "authorization_code" }, ok)).toEqual({ id_token: "T" });
    expect(seen[0]).toContain("code=c1");
    await expect(exchangeCode(d, {}, (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch)).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(exchangeCode(d, {}, (async () => json({}, 503)) as unknown as typeof fetch)).rejects.toMatchObject({ code: "unavailable" });
    await expect(exchangeCode(d, {}, (async () => { throw new TypeError("network"); }) as unknown as typeof fetch)).rejects.toMatchObject({ code: "unavailable" });
    await expect(exchangeCode(d, {}, (async () => json({ nothing: true })) as unknown as typeof fetch)).rejects.toBeInstanceOf(OidcError);
  });
});

describe("believing an ID token", () => {
  it("accepts one signed by the provider's key, for this app, with this nonce", async () => {
    const p = await provider();
    try {
      const token = await p.sign({ iss: "https://idp.test", aud: "app", sub: "u1", nonce: "n1", email: "ada@example.com" });
      const claims = await verifyIdToken(token, p.d, { audience: "app", nonce: "n1" });
      expect(claims.sub).toBe("u1");
      expect(claims.email).toBe("ada@example.com");
    } finally { p.close(); }
  });

  it("refuses the wrong nonce, audience, issuer, an expired token and one signed with another key", async () => {
    const p = await provider();
    const other = await provider();
    try {
      const good = { iss: "https://idp.test", aud: "app", sub: "u1", nonce: "n1" };
      await expect(verifyIdToken(await p.sign({ ...good, nonce: "other" }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_nonce" });
      await expect(verifyIdToken(await p.sign({ ...good, nonce: undefined }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_nonce" });
      await expect(verifyIdToken(await p.sign({ ...good, aud: "someone-else" }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_token" });
      await expect(verifyIdToken(await p.sign({ ...good, iss: "https://evil.test" }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_token" });
      await expect(verifyIdToken(await p.sign(good, { exp: "-10m" }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_token" });
      await expect(verifyIdToken(await p.sign({ ...good, sub: "" }), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_token" });
      // Signed by a key the provider doesn't publish
      await expect(verifyIdToken(await other.sign(good), p.d, { audience: "app", nonce: "n1" })).rejects.toMatchObject({ code: "bad_token" });
      // Several issuers allowed, as Google has
      expect((await verifyIdToken(await p.sign({ ...good, iss: "accounts.google.com" }), p.d, { audience: "app", nonce: "n1", issuers: ["https://idp.test", "accounts.google.com"] })).sub).toBe("u1");
    } finally { p.close(); other.close(); }
  });
});

describe("Apple's secret", () => {
  it("is a short-lived token signed with the app's key, naming the team, the app and Apple", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const secret = await appleClientSecret({ clientId: "com.example.app", teamId: "TEAM", keyId: "KEYID", privateKey: await exportPKCS8(privateKey) }, "https://appleid.apple.com", 1_700_000_000_000);
    const { payload, protectedHeader } = await jwtVerify(secret, publicKey, { issuer: "TEAM", audience: "https://appleid.apple.com", subject: "com.example.app", currentDate: new Date(1_700_000_100_000) });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "KEYID" });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(600);
  });

  it("refuses a key that isn't one", async () => {
    await expect(appleClientSecret({ clientId: "a", teamId: "t", keyId: "k", privateKey: "not a key" }, "https://appleid.apple.com")).rejects.toThrow();
  });
});
