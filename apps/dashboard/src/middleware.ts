import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // `q/` (public, token-gated customer approval page) is excluded — it needs
    // no auth session and must be reachable by anonymous customers.
    // `zxing/` (the scanner's static .wasm) needs no session either — refreshing one
    // on a 1 MB asset request would only delay the scanner's first frame.
    "/((?!_next/static|_next/image|favicon.ico|q/|zxing/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm)$).*)",
  ],
};
