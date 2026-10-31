import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Eye, Pencil } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { canManageProducts, canRemove } from "@/lib/roles";
import { isUuid } from "@/lib/search";
import { getStaffProduct } from "@/lib/products/reads";
import { getProductQr } from "@/lib/products/actions";
import { buttonVariants } from "@/components/ui/Button";
import ProductPhotos from "@/components/products/ProductPhotos";
import ProductSpecs from "@/components/products/ProductSpecs";
import StaffProductPanel from "@/components/products/StaffProductPanel";
import StickerPrintForm from "@/components/products/StickerPrintForm";
import { ActiveToggle, PhotoManager } from "./ProductAdminTools";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; photos_failed?: string }>;
};

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ id }, flags] = await Promise.all([params, searchParams]);
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!isUuid(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const [product, qr] = await Promise.all([getStaffProduct(supabase, sp.role, { id }), getProductQr(id)]);
  if (!product) notFound();

  const manage = canManageProducts(sp.role);
  const failedPhotos = Number(flags.photos_failed) || 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-8">
      <Link href="/dashboard/products" className="inline-flex items-center gap-1 text-caption text-t2 hover:text-t1">
        <ChevronLeft className="h-3.5 w-3.5" /> Products
      </Link>

      {(flags.created || flags.saved) && (
        <div className="rounded-md border border-ln bg-posS px-4 py-2.5 text-caption font-semibold text-pos">
          {flags.created ? `Product created — QR code ${product.code} is ready to print.` : "Changes saved."}
          {failedPhotos > 0 && (
            <span className="ml-1 text-warn">
              {failedPhotos} photo{failedPhotos === 1 ? "" : "s"} did not upload — add {failedPhotos === 1 ? "it" : "them"} again below.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-title text-t1">{product.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/p/${product.code}?as=customer`} className={buttonVariants({ variant: "secondary" })} target="_blank">
            <Eye className="h-3.5 w-3.5" strokeWidth={2} /> Customer view
          </Link>
          {manage && (
            <Link href={`/dashboard/products/${product.id}/edit`} className={buttonVariants({ variant: "primary" })}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <ProductPhotos photos={product.photos} alt={product.name} />
          {manage && <PhotoManager productId={product.id} photos={product.photos} coverId={product.primary_media_id} />}
        </div>

        <div className="space-y-4">
          <StaffProductPanel product={product} />
          <ProductSpecs product={product} />

          <section className="space-y-3 rounded-card border border-ln bg-sf p-4 shadow-sh">
            <div className="flex items-start gap-4">
              {qr.data ? (
                // eslint-disable-next-line @next/next/no-img-element -- SVG data URI from our API
                <img src={qr.data.image} alt={`QR code ${product.code}`} className="h-28 w-28 shrink-0 rounded-md border border-ln" />
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-md border border-ln bg-sf2 text-center text-meta text-t3">
                  QR unavailable
                </div>
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-label uppercase text-t3">QR sticker</p>
                <p className="font-mono text-section tabular-nums text-t1">{product.code}</p>
                {qr.data && <p className="break-all font-mono text-meta text-t3">{qr.data.url}</p>}
                <p className="text-meta text-t3">This code never changes — edits show up on the next scan.</p>
              </div>
            </div>
            {manage && <StickerPrintForm productIds={[product.id]} label="Print sticker" />}
          </section>

          {manage && (
            <ActiveToggle productId={product.id} active={product.active} mayDeactivate={canRemove(sp.role)} />
          )}
        </div>
      </div>
    </div>
  );
}
