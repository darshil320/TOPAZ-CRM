"use client";

/**
 * The driver's queue. One card per RUN, one block per DROP inside it (0040).
 *
 * A run can visit two customers, so a card that showed one name and one phone number would
 * be wrong about half the lorry. Each drop gets its own Call button, its own address and its
 * own tick list — and the ticks are now PERSISTED (`delivery_items.received`) instead of
 * being collected and thrown away, which is what makes "the customer got 2 of 3 pieces" a
 * fact the office can see.
 */

import { useMemo, useState, useTransition, useRef } from "react";
import { CheckCircle2, Camera, Phone, ImagePlus, Loader2, Check, SearchX, MapPin } from "lucide-react";
import { completeDeliveryAction } from "./actions";
import { signUpload, completeUpload, type MediaMime } from "@/lib/media/actions";
import PwaFilterBar, { type FilterChip } from "@/components/pwa/PwaFilterBar";
import { haystack, matchesQuery } from "@/lib/textFilter";
import { todayISO } from "@/lib/format";
import type { DeliveryQueueItem } from "./page";

const PASSTHROUGH_MIME: Record<string, MediaMime> = {
  "image/png": "image/png",
  "image/webp": "image/webp",
};

interface PhotoState {
  mediaId: string | null;
  previewUrl: string | null;
  uploading: boolean;
  error: string | null;
}

export default function DeliveryQueueClient({
  initialDeliveries,
}: {
  initialDeliveries: DeliveryQueueItem[];
}) {
  const [deliveries, setDeliveries] = useState<DeliveryQueueItem[]>(initialDeliveries);
  const [isPending, startTransition] = useTransition();
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  /**
   * Per delivery, which LINES the driver has ticked off as handed over. Keyed by
   * `delivery_items.id` because that is the row the tick is written to.
   *
   * Starts EMPTY rather than all-ticked: a pre-checked list is a list nobody reads, and
   * the point of the checklist is that the driver looks at the goods.
   */
  const [tickedMap, setTickedMap] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // A driver's day is "what is late, what is today, what is on the lorry" —
  // the chips are those three questions, not a mirror of the status column.
  const today = todayISO();

  const linesOf = (delivery: DeliveryQueueItem) =>
    delivery.stops.flatMap((stop) => stop.lines);

  const searchable = useMemo(
    () =>
      deliveries.map((delivery) => ({
        delivery,
        text: haystack(
          ...delivery.stops.flatMap((stop) => [
            stop.customerName,
            stop.customerPhone,
            stop.address,
            ...stop.orderNos,
          ]),
          delivery.items_summary,
          delivery.vehicle_no,
          delivery.eway_bill_no,
          delivery.notes,
          delivery.scheduled_date,
        ),
        overdue: delivery.scheduled_date < today,
        isToday: delivery.scheduled_date === today,
      })),
    [deliveries, today],
  );

  const matching = useMemo(
    () => searchable.filter((s) => matchesQuery(s.text, query)),
    [searchable, query],
  );

  const chips: FilterChip[] = useMemo(
    () => [
      { id: "all", label: "सब / All", count: matching.length },
      { id: "today", label: "आज / Today", count: matching.filter((s) => s.isToday).length },
      { id: "overdue", label: "देर / Late", count: matching.filter((s) => s.overdue).length },
      {
        id: "in_transit",
        label: "रास्ते में / On road",
        count: matching.filter((s) => s.delivery.status === "in_transit").length,
      },
    ],
    [matching],
  );

  const visible = useMemo(
    () =>
      matching
        .filter((s) => {
          if (chip === "today") return s.isToday;
          if (chip === "overdue") return s.overdue;
          if (chip === "in_transit") return s.delivery.status === "in_transit";
          return true;
        })
        .map((s) => s.delivery),
    [matching, chip],
  );

  async function handleFileSelected(deliveryId: string, file: File) {
    setError(null);
    setPhotos((prev) => ({
      ...prev,
      [deliveryId]: { mediaId: null, previewUrl: URL.createObjectURL(file), uploading: true, error: null },
    }));

    try {
      const mime = (PASSTHROUGH_MIME[file.type] || "image/jpeg") as MediaMime;
      const signRes = await signUpload({
        entityType: "delivery",
        entityId: deliveryId,
        kind: "delivery",
        mime,
      });

      if (signRes.error || !signRes.data?.upload_url || !signRes.data?.media_id) {
        throw new Error(signRes.error || "Failed to initiate upload");
      }

      const mediaId = signRes.data.media_id;
      const uploadUrl = signRes.data.upload_url;

      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });

      if (!uploadResp.ok) {
        throw new Error(`Upload failed (${uploadResp.status})`);
      }

      const compRes = await completeUpload(mediaId, file.size);
      if (compRes.error) {
        throw new Error(compRes.error);
      }

      setPhotos((prev) => ({
        ...prev,
        [deliveryId]: { mediaId, previewUrl: prev[deliveryId]?.previewUrl || null, uploading: false, error: null },
      }));
    } catch (err) {
      setPhotos((prev) => ({
        ...prev,
        [deliveryId]: { mediaId: null, previewUrl: null, uploading: false, error: err instanceof Error ? err.message : "Upload failed" },
      }));
    }
  }

  function toggleLine(deliveryId: string, lineId: string) {
    setTickedMap((prev) => {
      const current = prev[deliveryId] ?? [];
      return {
        ...prev,
        [deliveryId]: current.includes(lineId)
          ? current.filter((id) => id !== lineId)
          : [...current, lineId],
      };
    });
  }

  function toggleAll(delivery: DeliveryQueueItem) {
    const all = linesOf(delivery).map((line) => line.id);
    setTickedMap((prev) => ({
      ...prev,
      [delivery.id]: (prev[delivery.id] ?? []).length === all.length ? [] : all,
    }));
  }

  function handleComplete(delivery: DeliveryQueueItem) {
    setError(null);
    const photo = photos[delivery.id];
    const notes = notesMap[delivery.id];
    const ticked = tickedMap[delivery.id] ?? [];
    const allLines = linesOf(delivery);

    if (!photo?.mediaId) {
      setError("📷 इंस्टॉलेशन प्रूफ फोटो जरूरी है / Proof of installation photo required");
      return;
    }
    // EVERY line ticked, or an explicit note saying what happened. A short delivery with
    // no explanation is the case that turns into an argument a week later, and the driver
    // is the only person who can still see the lorry.
    if (allLines.length > 0 && ticked.length < allLines.length) {
      if (ticked.length === 0) {
        setError("सामान टिक करें / Tick the items you handed over.");
        return;
      }
      if (!notes?.trim()) {
        setError(
          `${ticked.length}/${allLines.length} सामान — कारण लिखें / ` +
            `Only ${ticked.length} of ${allLines.length} items ticked. Write a note saying what happened to the rest.`,
        );
        return;
      }
    }

    startTransition(async () => {
      // The un-ticked lines are what gets recorded as NOT received (0040). Everything else
      // stays received, which is also the column's default — so a fully-ticked run writes
      // nothing surprising.
      const notReceived = allLines
        .map((line) => line.id)
        .filter((lineId) => !ticked.includes(lineId));

      const res = await completeDeliveryAction(delivery.id, notes, notReceived);
      if (res.error) {
        setError(res.error);
        return;
      }

      setDeliveries((prev) => prev.filter((d) => d.id !== delivery.id));
    });
  }

  if (deliveries.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
        <h3 className="text-base font-bold text-white">कोई डिलीवरी बाकी नहीं / No Pending Deliveries!</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto">
          All scheduled deliveries have been completed with installation proof.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PwaFilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="ऑर्डर, ग्राहक, मोबाइल, गाड़ी / Order, customer, mobile, vehicle…"
        chips={chips}
        activeChip={chip}
        onChipChange={setChip}
        accent="emerald"
        resultLabel={`${visible.length} / ${deliveries.length}`}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {visible.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <SearchX className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">कुछ नहीं मिला / Nothing matches</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            इस खोज या फ़िल्टर में कोई डिलीवरी नहीं है। / No delivery matches this search or filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setChip("all");
            }}
            className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-lg"
          >
            साफ़ करें / Clear filters
          </button>
        </div>
      )}

      {visible.map((delivery) => {
        const photo = photos[delivery.id];
        const ticked = tickedMap[delivery.id] ?? [];
        const allLines = linesOf(delivery);
        const multiStop = delivery.stops.length > 1;

        return (
          <div
            key={delivery.id}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5 space-y-4 shadow-xl"
          >
            {/* Run header — the lorry, not a customer. */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-300">
                    Scheduled: {delivery.scheduled_date}
                  </span>
                  {multiStop && (
                    <span className="text-[11px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 px-2 py-0.5 rounded">
                      {delivery.stops.length} जगह / {delivery.stops.length} drops
                    </span>
                  )}
                </div>
                {delivery.stops.length === 0 && (
                  // Pre-0039 delivery with no item rows: the summary line is all there is.
                  <p className="text-xs text-slate-400 font-mono">{delivery.items_summary}</p>
                )}
              </div>

              <div className="text-right font-mono text-[11px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-2 py-1 rounded-md shrink-0">
                {ticked.length}/{allLines.length}
              </div>
            </div>

            {/* Vehicle & E-Way Bill info if present */}
            {(delivery.vehicle_no || delivery.eway_bill_no) && (
              <div className="flex flex-wrap gap-3 text-xs font-mono bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-slate-400">
                {delivery.vehicle_no && (
                  <span>Vehicle: <strong className="text-slate-200">{delivery.vehicle_no}</strong></span>
                )}
                {delivery.eway_bill_no && (
                  <span>E-Way Bill: <strong className="text-slate-200">{delivery.eway_bill_no}</strong></span>
                )}
              </div>
            )}

            {/* ONE BLOCK PER DROP (0040). Each customer's own name, phone, address and
                goods — a single header would attribute half the lorry to the wrong person. */}
            {delivery.stops.map((stop, index) => {
              const phone = (stop.customerPhone || "").replace(/\D/g, "");
              return (
                <div
                  key={stop.consignmentId ?? `${delivery.id}-stop-${index}`}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {multiStop && (
                          <span className="text-[11px] font-mono font-bold text-slate-400">
                            #{index + 1}
                          </span>
                        )}
                        {stop.orderNos.map((orderNo) => (
                          <span
                            key={orderNo}
                            className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-1.5 py-0.5 rounded"
                          >
                            {orderNo}
                          </span>
                        ))}
                      </div>
                      <h3 className="text-sm font-extrabold text-white">{stop.customerName}</h3>
                      {stop.address && (
                        <p className="flex items-start gap-1 text-[11px] text-slate-400">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{stop.address}</span>
                        </p>
                      )}
                    </div>

                    {phone && (
                      <a
                        href={`tel:+${phone}`}
                        className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center gap-1.5 text-xs font-bold shrink-0"
                      >
                        <Phone className="w-4 h-4" /> Call
                      </a>
                    )}
                  </div>

                  {/* PER-ITEM TICK-OFF. The driver's job is a set of pieces, and after
                      part-delivery the run genuinely carries fewer items than the order
                      has. Ticks are written to delivery_items.received on submit. */}
                  <div className="divide-y divide-slate-800">
                    {stop.lines.map((line) => (
                      <label key={line.id} className="flex items-start gap-2.5 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                          checked={ticked.includes(line.id)}
                          onChange={() => toggleLine(delivery.id, line.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-slate-200">
                            {line.description}
                          </span>
                          <span className="block text-[11px] font-mono text-slate-500">
                            {line.qty} {line.unit || "nos"}
                            {stop.orderNos.length > 1 ? ` · ${line.orderNo}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            {allLines.length > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">
                  सामान / Items on this run
                  <span className="ml-1.5 font-mono text-slate-500">
                    {ticked.length}/{allLines.length}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleAll(delivery)}
                  className="text-xs font-bold text-emerald-400"
                >
                  {ticked.length === allLines.length ? "साफ़ / Clear" : "सब / All"}
                </button>
              </div>
            )}

            {ticked.length > 0 && ticked.length < allLines.length && (
              <p className="text-[11px] font-semibold text-amber-300">
                कुछ सामान बाकी — नीचे कारण लिखें / Some items not handed over. Write the
                reason in the note below before marking this delivered — the office will see
                exactly which pieces are still outstanding.
              </p>
            )}

            {/* Installation Proof Photo Field */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-emerald-400" />
                  <span>इंस्टॉलेशन प्रूफ फोटो / Installation Proof Photo</span>
                  <span className="text-red-400 font-bold">*</span>
                </span>

                <button
                  type="button"
                  onClick={() => fileInputRefs.current[delivery.id]?.click()}
                  disabled={photo?.uploading}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{photo?.previewUrl ? "Change Photo" : "Take / Pick Photo"}</span>
                </button>
                <input
                  ref={(el) => { fileInputRefs.current[delivery.id] = el; }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(delivery.id, f);
                  }}
                />
              </div>

              {photo?.uploading && (
                <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Compressing &amp; uploading proof photo...</span>
                </div>
              )}

              {photo?.error && (
                <p className="text-xs font-semibold text-red-400">{photo.error}</p>
              )}

              {photo?.previewUrl && !photo.uploading && (
                <div className="flex items-center gap-3 pt-1">
                  <img
                    src={photo.previewUrl}
                    alt="Installation proof preview"
                    className="w-16 h-16 object-cover rounded-lg border border-slate-700 shadow-md"
                  />
                  <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    <span>Proof photo uploaded</span>
                  </div>
                </div>
              )}
            </div>

            {/* Delivery Notes */}
            <input
              type="text"
              placeholder="Delivery notes (e.g. Received by Mr. Sanjay at site...)"
              value={notesMap[delivery.id] || ""}
              onChange={(e) => setNotesMap({ ...notesMap, [delivery.id]: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />

            {/* Action Button */}
            <button
              type="button"
              onClick={() => handleComplete(delivery)}
              disabled={isPending || photo?.uploading || !photo?.mediaId}
              className="w-full bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <span>डिलीवरी पूरी हो रही है… / Processing…</span>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>✓ डिलीवरी और इंस्टॉलेशन पूर्ण / Mark Delivered &amp; Installed</span>
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
