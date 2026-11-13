import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SESSION_CHECK_MS = 2500;

// Keeps a Supabase session fresh: asks Supabase about the session in the request's cookies (which renews an expired
// token) and passes the renewed cookies on to the request and the response. Called from proxy.ts.
export const createClient = async (request: NextRequest) => {
  // Create an unmodified response
  let supabaseResponse = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Without Supabase set up on this server there is nothing to refresh, and the rest of the app works as it did.
  if (!supabaseUrl || !supabaseKey) return supabaseResponse;

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    },
  );

  // This is what refreshes the session. Nothing may run between creating the client and this call. A request with no
  // Supabase cookie costs nothing: there is no session to ask about. A Supabase that doesn't answer in a couple of
  // seconds is given up on for this request, so an outage there can't make every page wait for it.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, SESSION_CHECK_MS); }),
    ]);
  } catch {
    // The session is looked at again with the next request.
  } finally {
    clearTimeout(timer);
  }

  return supabaseResponse
};
