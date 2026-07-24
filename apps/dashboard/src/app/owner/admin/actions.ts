"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export interface ProductInput {
  name: string;
  category?: string;
  hsn: string;
  gst_rate: string;
  base_price?: string;
  unit?: string;
}

export async function addProduct(input: ProductInput): Promise<{ error: string | null }> {
  if (!input.name.trim()) return { error: "Name is required" };
  const rate = Number(input.gst_rate);
  if (!(rate >= 0 && rate <= 100)) return { error: "GST rate must be 0–100" };
  try {
    const supabase = await createServerSupabaseClient();
    // RLS products_insert is owner/admin only — a non-admin fails here too.
    const { error } = await supabase.from("products").insert({
      name: input.name.trim(),
      category: input.category?.trim() || null,
      hsn: input.hsn.trim() || "9403",
      gst_rate: rate,
      base_price: input.base_price ? Number(input.base_price) : null,
      unit: input.unit?.trim() || "nos",
    });
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function setProductActive(id: string, active: boolean): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.from("products").update({ active }).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}

export async function saveSetting(key: string, value: unknown): Promise<{ error: string | null }> {
  try {
    const supabase = await createServerSupabaseClient();
    // value is stored as jsonb; supabase-js serialises the JS value.
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value: value as never }, { onConflict: "key" });
    if (error) return { error: error.message };
    revalidatePath("/owner/admin");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Server error" };
  }
}
