import { NextRequest, NextResponse } from "next/server";
import { PROJECT_ID, getProject, removeProject, saveProject } from "@/lib/auth/projects";
import { fail, noStore, signedInFor } from "@/lib/auth/projects-http";
import { MAX_PAYLOAD_CHARS, readPayload } from "@/lib/sync/payload";

type Ctx = { params: Promise<{ id: string }> };

const view = (p: { id: string; version: number; updatedAt: number; deleted: boolean; name: string; data: unknown }) =>
  ({ id: p.id, version: p.version, updatedAt: p.updatedAt, deleted: p.deleted, data: p.data });

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!PROJECT_ID.test(id)) return fail(400, "Not a project");
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const project = await getProject(who.auth.db, who.user.id, id);
  if (!project) return fail(404, "There is no such project");
  return NextResponse.json(view(project), { headers: noStore });
}

// Saves a project. `baseVersion` is the version the device last had (0 for a new project): if the server has moved on,
// nothing is changed and the answer (409) is what the server has.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!PROJECT_ID.test(id)) return fail(400, "Not a project");
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PAYLOAD_CHARS * 2) return fail(413, "This project is too large to save to your account");

  const body = (await req.json().catch(() => null)) as { baseVersion?: unknown; data?: unknown } | null;
  const baseVersion = body?.baseVersion;
  if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) return fail(400, "The version is missing");
  const read = readPayload(body?.data);
  if (!read.ok) return fail(422, read.error);

  const result = await saveProject(who.auth.db, who.user.id, id, baseVersion, read.payload);
  if (result.ok) return NextResponse.json({ version: result.version, updatedAt: result.updatedAt }, { headers: noStore });
  if (result.reason === "limit") return fail(409, "You have reached the limit of projects saved to your account", { limit: true });
  return fail(409, "This project was changed somewhere else", { conflict: true, current: view(result.current) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!PROJECT_ID.test(id)) return fail(400, "Not a project");
  const who = await signedInFor(req);
  if (who instanceof NextResponse) return who;
  const base = Number(req.nextUrl.searchParams.get("baseVersion"));
  if (!Number.isInteger(base) || base < 0) return fail(400, "The version is missing");
  const result = await removeProject(who.auth.db, who.user.id, id, base);
  if (result.ok) return NextResponse.json({ ok: true }, { headers: noStore });
  return fail(409, "This project was changed somewhere else", { conflict: true, current: view(result.current) });
}
