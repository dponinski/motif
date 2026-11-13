import type { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

// Runs before pages are rendered (what Next.js calls a proxy, formerly middleware): keeps a Supabase session fresh.
export async function proxy(request: NextRequest) {
  return createClient(request);
}

export const config = {
  // Everything except static files, images and the like.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|map|json|txt)$).*)"],
};
