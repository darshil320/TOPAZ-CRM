import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { canManageProducts } from "@/lib/roles";
import { isUuid } from "@/lib/search";
import { getStaffProduct, listCategories, listLocations } from "@/lib/products/reads";
import { productInputFrom } from "@/lib/products/formInput";
import PageHeader from "@/components/ui/PageHeader";
import ProductForm from "../../ProductForm";

type Props = { params: Promise<{ id: string }> };

export default async function EditProductPage({ params }: Props) {
  const { id } = await params;
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!canManageProducts(sp.role)) redirect(`/dashboard/products/${id}`);
  if (!isUuid(id)) notFound();

  const supabase = await createServerSupabaseClient();
  const [product, locations, categories] = await Promise.all([
    getStaffProduct(supabase, sp.role, { id }),
    listLocations(supabase),
    listCategories(supabase),
  ]);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <Link href={`/dashboard/products/${id}`} className="inline-flex items-center gap-1 text-caption text-t2 hover:text-t1">
        <ChevronLeft className="h-3.5 w-3.5" /> {product.name}
      </Link>
      <PageHeader title="Edit product" subtitle={`Sticker code ${product.code} stays the same — printed QR stickers keep working.`} />
      <ProductForm
        productId={product.id}
        initial={productInputFrom(product, locations)}
        locations={locations}
        categories={categories}
      />
    </div>
  );
}
