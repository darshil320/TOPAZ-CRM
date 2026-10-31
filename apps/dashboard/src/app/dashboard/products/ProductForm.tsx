"use client";

/**
 * Create / edit a product from a phone: photos, details, sizes, price + GST, stock at
 * every location, status. One Save writes the product and all its stock in one API
 * transaction; the QR code is assigned by the database and never changes.
 *
 * Create mode collects photos BEFORE the product exists and uploads them right after
 * Save returns its id — the admin photographs the piece while filling the form, as the
 * client asked, instead of saving first and coming back for photos.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { saveProduct, setProductCover } from "@/lib/products/actions";
import { uploadImage } from "@/lib/media/uploadImage";
import {
  STOCK_STATUSES,
  STOCK_STATUS_LABEL,
  type ProductInput,
  type StockLocation,
  type StockStatus,
} from "@/lib/products/types";
import PendingPhotos, { toPending, type PendingPhoto } from "./PendingPhotos";
import StockInputs from "./StockInputs";

const GST_SUGGESTIONS = ["0", "5", "12", "18", "28", "40"];
const INPUT =
  "w-full rounded-md border border-ln bg-sf2 px-3 py-2 text-ui text-t1 placeholder-t3 focus:border-acc focus:bg-sf focus:outline-none";

function suggestedStatus(stock: Record<string, string>, current: StockStatus): StockStatus {
  if (current === "made_to_order") return current;
  const total = Object.values(stock).reduce((sum, v) => sum + (Number.parseInt(v || "0", 10) || 0), 0);
  return total > 0 ? "in_stock" : "out_of_stock";
}

export default function ProductForm({
  productId,
  initial,
  locations,
  categories,
}: {
  /** Null ⇒ create. */
  productId: string | null;
  initial: ProductInput;
  locations: StockLocation[];
  categories: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<ProductInput>(initial);
  const [statusTouched, setStatusTouched] = useState(productId !== null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "uploading">("idle");
  const [, startTransition] = useTransition();
  const busy = phase !== "idle";

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setQty = (locationId: string, value: string) =>
    setForm((prev) => {
      const stock = { ...prev.stock, [locationId]: value };
      return { ...prev, stock, stock_status: statusTouched ? prev.stock_status : suggestedStatus(stock, prev.stock_status) };
    });

  const patchPhoto = (key: string, patch: Partial<PendingPhoto>) =>
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function uploadPending(id: string): Promise<number> {
    let cover: string | null = null;
    let failed = 0;
    for (const photo of photos) {
      patchPhoto(photo.key, { state: "uploading", progress: 0 });
      const outcome = await uploadImage(photo.file, { entityType: "product", entityId: id, kind: "reference" }, (_s, pct) =>
        patchPhoto(photo.key, { progress: pct }),
      );
      if (outcome.error || !outcome.mediaId) {
        failed += 1;
        patchPhoto(photo.key, { state: "failed" });
        continue;
      }
      patchPhoto(photo.key, { state: "done", progress: 100 });
      cover = cover ?? outcome.mediaId;
    }
    if (cover) await setProductCover(id, cover);
    return failed;
  }

  const submit = () => {
    setError(null);
    setPhase("saving");
    startTransition(async () => {
      // Edit: send the stock this form opened with, so a concurrent change is refused
      // (409) rather than overwritten.
      const saved = await saveProduct(productId, form, productId ? initial.stock : undefined);
      if (saved.error || !saved.data) {
        setError(saved.error ?? "Could not save");
        setPhase("idle");
        return;
      }
      const id = saved.data.id;
      let failed = 0;
      if (!productId && photos.length > 0) {
        setPhase("uploading");
        failed = await uploadPending(id);
      }
      const query = productId ? "?saved=1" : failed > 0 ? `?created=1&photos_failed=${failed}` : "?created=1";
      router.replace(`/dashboard/products/${id}${query}`);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-5"
    >
      {!productId && (
        <Section>
          <PendingPhotos
            photos={photos}
            locked={busy}
            onAdd={(files) => setPhotos((prev) => [...prev, ...toPending(files, prev.length)])}
            onRemove={(key) => setPhotos((prev) => prev.filter((p) => p.key !== key))}
          />
        </Section>
      )}

      <Section title="Details">
        <Field label="Product name *">
          <input className={INPUT} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Royal 3-seater sofa" maxLength={200} required />
        </Field>
        <Field label="Category">
          <input className={INPUT} value={form.category} onChange={(e) => set("category", e.target.value)} list="product-categories" placeholder="Sofa, Bed, Dining…" maxLength={80} />
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Description">
          <textarea className={`${INPUT} min-h-[88px]`} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} placeholder="What a customer should know about this piece" />
        </Field>
      </Section>

      <Section title="Sizes & build">
        <Field label="Sizes">
          <input className={INPUT} value={form.sizes} onChange={(e) => set("sizes", e.target.value)} placeholder="e.g. King, Queen" maxLength={300} />
        </Field>
        <Field label="Dimensions">
          <input className={INPUT} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} placeholder='e.g. 84" W × 36" D × 32" H' maxLength={300} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Material">
            <input className={INPUT} value={form.material} onChange={(e) => set("material", e.target.value)} placeholder="Teak, MDF…" maxLength={200} />
          </Field>
          <Field label="Finish / colour">
            <input className={INPUT} value={form.finish} onChange={(e) => set("finish", e.target.value)} placeholder="Walnut matte" maxLength={200} />
          </Field>
        </div>
      </Section>

      <Section title="Price & GST" note="Staff only — never shown to customers">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹, excl. GST)">
            <input className={`${INPUT} font-mono tabular-nums`} value={form.base_price} onChange={(e) => set("base_price", e.target.value)} inputMode="decimal" placeholder="42000" />
          </Field>
          <Field label="GST %">
            <input className={`${INPUT} font-mono tabular-nums`} value={form.gst_rate} onChange={(e) => set("gst_rate", e.target.value)} inputMode="decimal" list="gst-rates" />
            <datalist id="gst-rates">
              {GST_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>
          <Field label="HSN">
            <input className={`${INPUT} font-mono tabular-nums`} value={form.hsn} onChange={(e) => set("hsn", e.target.value)} inputMode="numeric" maxLength={8} />
          </Field>
          <Field label="Unit">
            <input className={INPUT} value={form.unit} onChange={(e) => set("unit", e.target.value)} maxLength={20} />
          </Field>
        </div>
      </Section>

      <Section title="Stock" note="Staff only — locations are never shown to customers">
        <StockInputs locations={locations} values={form.stock} onChange={setQty} disabled={busy} />
        <Field label="Stock status">
          <select
            className={INPUT}
            value={form.stock_status}
            onChange={(e) => {
              setStatusTouched(true);
              set("stock_status", e.target.value as StockStatus);
            }}
          >
            {STOCK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STOCK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <div>
        {error && <p className="mb-2 text-caption font-semibold text-warn">{error}</p>}
        <Button type="submit" disabled={busy || !form.name.trim()} className="w-full justify-center md:w-auto">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {phase === "saving" ? "Saving…" : phase === "uploading" ? "Uploading photos…" : productId ? "Save changes" : "Save & create QR"}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-ln bg-sf p-4 shadow-sh">
      {title && (
        <div>
          <h2 className="text-section text-t1">{title}</h2>
          {note && <p className="text-meta text-t3">{note}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-caption font-semibold text-t2">{label}</span>
      {children}
    </label>
  );
}
