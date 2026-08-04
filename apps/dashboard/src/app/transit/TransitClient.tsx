"use client";

/**
 * A driver's run card: what to move, from where, to where, by when — one tap per state.
 *
 * Design constraints inherited from module 10 (the workshop PWA's thesis), because the
 * reader is the same kind of person on the same kind of phone:
 *   · Gujarati first, English second.
 *   · One primary button per card, sized for a thumb, and never more than three taps
 *     from "I have the goods" to done.
 *   · Addresses and phone numbers are `tel:`/maps links, not text to copy out.
 *
 * The card shows every item's photo, description, size and material — and NO price.
 * That is not a style choice: a `delivery` user has no `order_items` SELECT policy, so
 * the API projection behind this screen omits money entirely.
 *
 * The run LEAVES this list at `delivered`. The destination lead still has to receive it
 * in the workshop app — one person confirming both ends is exactly the ambiguity the
 * two-party handover exists to prevent.
 */

import { useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  Clock,
  MapPin,
  Package,
  Phone,
  SearchX,
  Send,
  Truck,
} from "lucide-react";
import CameraField from "@/components/production/CameraField";
import { usePhotoCapture } from "@/components/production/usePhotoCapture";
import PwaFilterBar, { type FilterChip } from "@/components/pwa/PwaFilterBar";
import { haystack, matchesQuery } from "@/lib/textFilter";
import { TRANSFER_STATUS_LABEL, describeDue } from "@/lib/production/format";
import type { TransferSummary } from "@/lib/production/types";
import { deliverAction, inTransitAction, pickupAction } from "./actions";

type Step = "pickup" | "deliver" | null;

export default function TransitClient({ initialRuns }: { initialRuns: TransferSummary[] }) {
  const [runs, setRuns] = useState<TransferSummary[]>(initialRuns);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<Record<string, Step>>({});
  const [vehicle, setVehicle] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");

  /* A driver searches by the thing written on the paperwork or shouted down the
   * phone: the consignment number, a workshop name, or the order the goods
   * belong to. All three are in the haystack, along with every item line. */
  const searchable = useMemo(
    () =>
      runs.map((run) => ({
        run,
        text: haystack(
          run.transfer_no,
          run.from_workshop_name,
          run.to_workshop_name,
          run.vehicle_no,
          run.reason,
          run.notes,
          ...(run.items ?? []).map((line) =>
            haystack(line.description, line.order_no, line.customer_name, line.material),
          ),
        ),
      })),
    [runs],
  );

  const matching = useMemo(
    () => searchable.filter((s) => matchesQuery(s.text, query)),
    [searchable, query],
  );

  const chips: FilterChip[] = useMemo(
    () => [
      { id: "all", label: "सब / All", count: matching.length },
      {
        id: "ready",
        label: "कलेक्ट / To collect",
        count: matching.filter((s) => s.run.status === "ready").length,
      },
      {
        id: "on_road",
        label: "रास्ते में / On road",
        count: matching.filter((s) => s.run.status === "picked_up" || s.run.status === "in_transit")
          .length,
      },
      {
        id: "late",
        label: "देर / Late",
        count: matching.filter((s) => describeDue(s.run.due_at).overdue).length,
      },
    ],
    [matching],
  );

  const visible = useMemo(
    () =>
      matching
        .filter((s) => {
          if (chip === "ready") return s.run.status === "ready";
          if (chip === "on_road")
            return s.run.status === "picked_up" || s.run.status === "in_transit";
          if (chip === "late") return describeDue(s.run.due_at).overdue;
          return true;
        })
        .map((s) => s.run),
    [matching, chip],
  );

  // Two frames per consignment (collected / delivered), so the slot key carries the
  // step as well as the id — the same consignment holds both at once.
  const photos = usePhotoCapture({ entityType: "workshop_transfer", kind: "transit" });

  function setStep(id: string, step: Step) {
    setOpenStep((prev) => ({ ...prev, [id]: step }));
  }

  function handlePickup(run: TransferSummary) {
    setError(null);
    const slotId = `${run.id}:pickup`;
    const photo = photos.slot(slotId);
    if (!photo.mediaId) {
      setError("📷 सामान का फ़ोटो लें / Photograph the goods before collecting");
      return;
    }
    startTransition(async () => {
      const res = await pickupAction(run.id, photo.mediaId!, vehicle[run.id]);
      if (res.error) {
        setError(res.error);
        return;
      }
      photos.clear(slotId);
      setStep(run.id, null);
      setRuns((prev) =>
        prev.map((r) =>
          r.id === run.id
            ? { ...r, status: "picked_up", vehicle_no: vehicle[run.id] || r.vehicle_no }
            : r,
        ),
      );
    });
  }

  function handleOnRoad(run: TransferSummary) {
    setError(null);
    startTransition(async () => {
      const res = await inTransitAction(run.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, status: "in_transit" } : r)));
    });
  }

  function handleDeliver(run: TransferSummary) {
    setError(null);
    const slotId = `${run.id}:deliver`;
    const photo = photos.slot(slotId);
    if (!photo.mediaId) {
      setError("📷 डिलीवरी का फ़ोटो लें / Photograph the delivered goods");
      return;
    }
    startTransition(async () => {
      const res = await deliverAction(run.id, photo.mediaId!);
      if (res.error) {
        setError(res.error);
        return;
      }
      photos.clear(slotId);
      setStep(run.id, null);
      // Off the driver's list: the destination lead owns it from here.
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    });
  }

  return (
    <div className="space-y-4">
      <PwaFilterBar
        query={query}
        onQueryChange={setQuery}
        placeholder="कंसाइनमेंट, वर्कशॉप, ऑर्डर / Consignment, workshop, order…"
        chips={chips}
        activeChip={chip}
        onChipChange={setChip}
        accent="sky"
        resultLabel={`${visible.length} / ${runs.length}`}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs font-semibold text-red-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {visible.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <SearchX className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">कुछ नहीं मिला / Nothing matches</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            इस खोज या फ़िल्टर में कोई ट्रिप नहीं है। / No run matches this search or filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setChip("all");
            }}
            className="text-xs font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 px-3 py-2 rounded-lg"
          >
            साफ़ करें / Clear filters
          </button>
        </div>
      )}

      {visible.map((run) => {
        const due = describeDue(run.due_at);
        const pickupDue = describeDue(run.expected_pickup_at);
        const step = openStep[run.id] ?? null;
        const items = run.items ?? [];

        return (
          <div
            key={run.id}
            className={`rounded-2xl border p-4 sm:p-5 space-y-4 ${
              due.overdue
                ? "bg-red-950/15 border-red-500/40"
                : "bg-slate-900 border-slate-800 shadow-xl"
            }`}
          >
            {/* Consignment header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded">
                    {run.transfer_no}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300">
                    {TRANSFER_STATUS_LABEL[run.status] ?? run.status}
                  </span>
                  {run.reason !== "next_stage" && (
                    <span className="text-[10px] font-bold uppercase text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">
                      {run.reason}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  {items.length || run.item_count || 0} आइटम / item(s)
                  {run.vehicle_no && ` · ${run.vehicle_no}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-[11px] font-mono font-semibold block ${
                    due.overdue ? "text-red-300" : "text-slate-400"
                  }`}
                >
                  <Clock className="w-3 h-3 inline mr-1" />
                  {due.label}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">{due.relative}</span>
              </div>
            </div>

            {/* From → To, with the two things a driver actually needs: address + phone */}
            <div className="grid gap-2 sm:grid-cols-2">
              <SiteCard
                heading="कहाँ से / Collect from"
                name={run.from_workshop_name}
                address={run.from_workshop_address}
                phone={run.from_workshop_phone}
                accent="amber"
              />
              <SiteCard
                heading="कहाँ / Deliver to"
                name={run.to_workshop_name}
                address={run.to_workshop_address}
                phone={run.to_workshop_phone}
                accent="sky"
              />
            </div>

            {run.status === "ready" && run.expected_pickup_at && (
              <p className="text-[11px] font-mono text-slate-400">
                पिकअप समय / Pickup by {pickupDue.label}
                {pickupDue.overdue && (
                  <span className="text-red-300 font-bold"> · {pickupDue.relative}</span>
                )}
              </p>
            )}

            {/* The goods themselves */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> सामान / Goods
              </p>
              <ul className="space-y-2">
                {items.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-start gap-3 bg-slate-950 border border-slate-800 rounded-xl p-2.5"
                  >
                    <div className="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-500">
                      <Package className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-bold text-white truncate">{line.description}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {line.qty ?? 1} {line.unit || "nos"}
                        {line.dimensions && ` · ${line.dimensions}`}
                        {line.material && ` · ${line.material}`}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono">
                        {line.order_no} · {line.customer_name}
                      </p>
                    </div>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="text-xs text-slate-500">
                    Item details did not load — call the collecting workshop before moving
                    anything.
                  </li>
                )}
              </ul>
            </div>

            {/* One tap per state */}
            {run.status === "ready" && (
              step === "pickup" ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="गाड़ी नंबर / Vehicle no. (optional)"
                    value={vehicle[run.id] ?? run.vehicle_no ?? ""}
                    onChange={(e) => setVehicle((p) => ({ ...p, [run.id]: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <CameraField
                    slotId={`${run.id}:pickup`}
                    entityId={run.id}
                    label="कलेक्शन का फ़ोटो / Photo at collection"
                    required
                    photo={photos.slot(`${run.id}:pickup`)}
                    onFile={photos.upload}
                    openCamera={photos.openCamera}
                    setInputRef={photos.setInputRef}
                  />
                  <div className="flex items-center gap-2">
                    <PrimaryButton
                      onClick={() => handlePickup(run)}
                      disabled={isPending || !photos.slot(`${run.id}:pickup`).mediaId}
                      icon={<Truck className="w-4 h-4" />}
                      label="✓ सामान उठाया / Collected"
                    />
                    <CancelButton onClick={() => setStep(run.id, null)} />
                  </div>
                </div>
              ) : (
                <PrimaryButton
                  onClick={() => setStep(run.id, "pickup")}
                  disabled={isPending}
                  icon={<Truck className="w-4 h-4" />}
                  label="सामान उठाएं / Collect goods"
                />
              )
            )}

            {run.status === "picked_up" && (
              <div className="flex items-center gap-2">
                <PrimaryButton
                  onClick={() => handleOnRoad(run)}
                  disabled={isPending}
                  icon={<ArrowRight className="w-4 h-4" />}
                  label="रास्ते में / On the road"
                />
                <button
                  type="button"
                  onClick={() => setStep(run.id, "deliver")}
                  className="py-3 px-3.5 rounded-xl text-xs font-bold text-emerald-300 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 shrink-0"
                >
                  पहुँच गया / Delivered
                </button>
              </div>
            )}

            {(run.status === "in_transit" || step === "deliver") && (
              step === "deliver" ? (
                <div className="space-y-3">
                  <CameraField
                    slotId={`${run.id}:deliver`}
                    entityId={run.id}
                    label="डिलीवरी का फ़ोटो / Photo at delivery"
                    required
                    photo={photos.slot(`${run.id}:deliver`)}
                    onFile={photos.upload}
                    openCamera={photos.openCamera}
                    setInputRef={photos.setInputRef}
                  />
                  <div className="flex items-center gap-2">
                    <PrimaryButton
                      onClick={() => handleDeliver(run)}
                      disabled={isPending || !photos.slot(`${run.id}:deliver`).mediaId}
                      icon={<Send className="w-4 h-4" />}
                      label="✓ पहुँच गया / Delivered"
                      tone="emerald"
                    />
                    <CancelButton onClick={() => setStep(run.id, null)} />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    पहुँचाने के बाद वहाँ के मुख्य मैनेजर स्वीकार करेंगे।{" "}
                    <span className="text-slate-500">
                      The destination lead confirms receipt on their own phone — that is what
                      closes the handover.
                    </span>
                  </p>
                </div>
              ) : (
                <PrimaryButton
                  onClick={() => setStep(run.id, "deliver")}
                  disabled={isPending}
                  icon={<Send className="w-4 h-4" />}
                  label="पहुँच गया दर्ज करें / Mark delivered"
                  tone="emerald"
                />
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function SiteCard({
  heading,
  name,
  address,
  phone,
  accent,
}: {
  heading: string;
  name: string;
  address: string | null;
  phone: string | null;
  accent: "amber" | "sky";
}) {
  const ring = accent === "amber" ? "border-amber-500/30" : "border-sky-500/30";
  const text = accent === "amber" ? "text-amber-300" : "text-sky-300";
  return (
    <div className={`bg-slate-950 border ${ring} rounded-xl p-3 space-y-1.5`}>
      <p className={`text-[10px] font-bold uppercase tracking-wide ${text}`}>{heading}</p>
      <p className="text-sm font-bold text-white leading-tight">{name}</p>
      {address && (
        <a
          href={`https://maps.google.com/?q=${encodeURIComponent(`${name} ${address}`)}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-slate-400 hover:text-slate-200 flex items-start gap-1.5 leading-snug"
        >
          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{address}</span>
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-200 bg-slate-800/70 border border-slate-700 px-2 py-1 rounded-lg font-mono"
        >
          <Phone className="w-3.5 h-3.5" />
          {phone}
        </a>
      )}
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  icon,
  label,
  tone = "sky",
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  tone?: "sky" | "emerald";
}) {
  const colour =
    tone === "emerald"
      ? "bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20"
      : "bg-sky-500 hover:bg-sky-400 shadow-sky-500/20";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 ${colour} active:scale-[0.99] text-slate-950 py-3 px-4 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="py-3 px-3.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white border border-slate-700 shrink-0"
    >
      रद्द / Cancel
    </button>
  );
}
