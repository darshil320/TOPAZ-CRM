import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentSalesperson } from "@/lib/auth";
import { canManageProducts } from "@/lib/roles";
import { listCategories, listLocations } from "@/lib/products/reads";
import { blankProductInput } from "@/lib/products/formInput";
import PageHeader from "@/components/ui/PageHeader";
import ProductForm from "../ProductForm";

export default async function NewProductPage() {
  const sp = await getCurrentSalesperson();
  if (!sp) redirect("/login");
  if (!canManageProducts(sp.role)) redirect("/dashboard/products");

  const supabase = await createServerSupabaseClient();
  const [locations, categories] = await Promise.all([listLocations(supabase), listCategories(supabase)]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <Link href="/dashboard/products" className="inline-flex items-center gap-1 text-caption text-t2 hover:text-t1">
        <ChevronLeft className="h-3.5 w-3.5" /> Products
      </Link>
      <PageHeader title="New product" subtitle="A QR code is generated the moment you save." />
      <ProductForm productId={null} initial={blankProductInput(locations)} locations={locations} categories={categories} />
    </div>
  );
}
