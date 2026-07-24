import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // `q/` (public, token-gated customer approval page) is excluded — it needs
    // no auth session and must be reachable by anonymous customers.
    "/((?!_next/static|_next/image|favicon.ico|q/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
