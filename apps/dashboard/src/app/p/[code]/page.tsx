import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, ScanLine } from "lucide-react";
import { getCurrentSalesperson } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getStaffProduct } from "@/lib/products/reads";
import { loadPublicProduct, type PublicProduct } from "@/lib/products/publicRead";
import { normalizeProductCode } from "@/lib/scan/productCode";
import type { StaffProduct } from "@/lib/products/types";
import ProductPhotos from "@/components/products/ProductPhotos";
import ProductSpecs from "@/components/products/ProductSpecs";
import StaffProductPanel from "@/components/products/StaffProductPanel";

/**
 * What a product QR sticker opens. ONE URL, two audiences:
 *
 *   signed-in staff → the staff view (price/GST/stock/location as their role allows),
 *                     read under their own RLS session;
 *   everyone else   → the customer view, fetched server-side from the API's public,
 *                     column-allowlisted route.
 *
 * The customer branch never queries Supabase and never receives a price — there is
 * nothing to find in the page source, the RSC payload or the network tab, and the
 * API it calls cannot return one (api/public_products.py). This is a server
 * component: no product data is fetched from the browser at all.
 *
 * Never cached: the response depends on who is asking. A cached staff render served
 * to a customer would be exactly the leak this page exists to prevent.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Topaz Furniture",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ code: string }>;
  /** `as=customer`: staff preview exactly what a customer sees (it can only show LESS). */
  searchParams: Promise<{ as?: string }>;
};

export default async function ProductTagPage({ params, searchParams }: Props) {
  const [{ code: raw }, { as }] = await Promise.all([params, searchParams]);
  const code = normalizeProductCode(safeDecode(raw));

  const sp = as === "customer" ? null : await getCurrentSalesperson();
  if (sp) {
    const supabase = await createServerSupabaseClient();
    const product = code ? await getStaffProduct(supabase, sp.role, { code }) : null;
    return <StaffShell>{product ? <StaffView product={product} /> : <Missing code={code ?? raw} staff />}</StaffShell>;
  }

  if (!code) return <PublicShell><Missing code={raw} /></PublicShell>;
  const result = await loadPublicProduct(code);
  return (
    <PublicShell>
      {result.status === "ok" ? (
        <PublicView product={result.product} />
      ) : result.status === "not_found" ? (
        <Missing code={code} />
      ) : (
        <Unavailable />
      )}
    </PublicShell>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <header className="text-center">
          <p className="text-section font-semibold tracking-wide text-t1">TOPAZ FURNITURE</p>
          <p className="text-meta text-t3">Fine furniture &amp; interiors</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function PublicView({ product }: { product: PublicProduct }) {
  const photos = product.photos.map((p) => ({ url: p.url, thumbUrl: p.thumb_url ?? null }));
  return (
    <>
      <ProductPhotos photos={photos} alt={product.name} />
      <div className="rounded-card border border-ln bg-sf p-4 shadow-sh space-y-3">
        <h1 className="text-title text-t1">{product.name}</h1>
        <ProductSpecs product={product} />
      </div>
      <p className="pb-4 text-center text-caption text-t3">
        Ask any Topaz team member for pricing and availability.
      </p>
    </>
  );
}

function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ln bg-sf px-4 py-2.5">
        <Link href="/scan" className="flex items-center gap-1.5 text-ui font-semibold text-acc">
          <ScanLine className="h-4 w-4" strokeWidth={2} /> Scan next
        </Link>
        <span className="text-label-sm uppercase text-t3">Staff view</span>
      </div>
      <div className="mx-auto max-w-lg space-y-4 px-4 py-4">{children}</div>
    </div>
  );
}

function StaffView({ product }: { product: StaffProduct }) {
  return (
    <>
      <ProductPhotos photos={product.photos} alt={product.name} />
      <div className="space-y-1">
        <h1 className="text-title text-t1">{product.name}</h1>
        <Link
          href={`/dashboard/products/${product.id}`}
          className="inline-flex items-center gap-1 text-caption font-semibold text-acc"
        >
          Open in CRM <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <StaffProductPanel product={product} />
      <ProductSpecs product={product} />
    </>
  );
}

function Missing({ code, staff = false }: { code: string; staff?: boolean }) {
  return (
    <div className="rounded-card border border-ln bg-sf p-6 text-center shadow-sh">
      <p className="text-section text-t1">Product not found</p>
      <p className="mt-1 text-caption text-t3">
        {staff
          ? `No product has the code ${code}. It may have been deactivated, or the sticker is damaged — type the code on the scanner screen to retry.`
          : "This product is no longer listed. Please ask a Topaz team member for help."}
      </p>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="rounded-card border border-ln bg-sf p-6 text-center shadow-sh">
      <p className="text-section text-t1">Details are temporarily unavailable</p>
      <p className="mt-1 text-caption text-t3">Please scan again in a moment, or ask a Topaz team member.</p>
    </div>
  );
}
