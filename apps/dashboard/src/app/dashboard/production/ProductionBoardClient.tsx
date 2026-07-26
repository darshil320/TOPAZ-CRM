"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Camera, ShieldAlert, Clock, Share2, X, ChevronRight, CheckCircle2 } from "lucide-react";
import Pill from "@/components/ui/Pill";
import Link from "next/link";

export interface ProductionItem {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  current_stage: string | null;
  current_stage_at: string | null;
  blocked: boolean;
  blocked_at: string | null;
  order_id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string | null;
  workshop_name: string;
  workshop_type: string;
  photos: { id: string; url: string; stageCode: string; createdAt: string }[];
  events: { id: string; kind: string; stageCode: string; note: string | null; at: string }[];
}

export interface StageDef {
  code: string;
  sort: number;
  label_en: string;
  label_gu: string | null;
  photo_required: boolean;
}

export default function ProductionBoardClient({
  items,
  stages,
}: {
  items: ProductionItem[];
  stages: StageDef[];
}) {
  const [selectedItem, setSelectedItem] = useState<ProductionItem | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const stageMap = new Map(stages.map((s) => [s.code, s]));
  const firstStageCode = stages[0]?.code ?? "design_approved";

  // Group items by current stage
  const itemsByStage = new Map<string, ProductionItem[]>();
  for (const s of stages) {
    itemsByStage.set(s.code, []);
  }

  for (const item of items) {
    const code = item.current_stage || firstStageCode;
    const list = itemsByStage.get(code) || [];
    list.push(item);
    itemsByStage.set(code, list);
  }

  function buildWhatsAppUrl(item: ProductionItem, photoUrl?: string) {
    const rawPhone = (item.customer_phone || "").replace(/\D/g, "");
    const formattedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    const stageName = stageMap.get(item.current_stage || firstStageCode)?.label_en || "In Production";

    let message = `Hello ${item.customer_name}!\n\nHere is a live production progress update for your item *${item.description}* (Order: ${item.order_no}):\n\n📌 Current Stage: *${stageName}*`;
    if (photoUrl) {
      message += `\n\n📷 Production Photo: ${photoUrl}`;
    }
    message += `\n\nThank you for choosing Topaz!`;

    return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
  }

  return (
    <div className="space-y-6">
      {/* Board Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title text-t1 font-bold">Production Pipeline Kanban</h2>
          <p className="text-body text-t2 mt-0.5">
            {items.length} item{items.length === 1 ? "" : "s"} actively moving through workshop stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/production/allocate"
            className="text-caption font-semibold bg-acc hover:opacity-90 text-white px-3.5 py-2 rounded-card transition-colors shadow-sh"
          >
            + Allocate Unassigned Items
          </Link>
          <Link
            href="/workshop"
            className="text-caption font-semibold bg-sf2 hover:bg-sf3 text-t1 border border-ln px-3.5 py-2 rounded-card transition-colors"
          >
            Open Workshop PWA 📱
          </Link>
        </div>
      </div>

      {/* Horizontal Scroll Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-thin">
        {stages.map((stage) => {
          const stageItems = itemsByStage.get(stage.code) || [];

          return (
            <div
              key={stage.code}
              className="w-72 shrink-0 bg-sf2/70 border border-ln rounded-card p-3 flex flex-col min-h-[500px]"
            >
              {/* Stage Header */}
              <div className="pb-3 mb-3 border-b border-ln flex items-center justify-between">
                <div>
                  <h3 className="text-caption font-bold text-t1 flex items-center gap-1.5">
                    <span>{stage.label_en}</span>
                    {stage.photo_required && (
                      <span title="Photo required">
                        <Camera className="w-3.5 h-3.5 text-acc shrink-0" />
                      </span>
                    )}
                  </h3>
                  {stage.label_gu && (
                    <p className="text-[11px] text-t3 font-medium">{stage.label_gu}</p>
                  )}
                </div>
                <span className="text-caption font-bold font-mono bg-sf3 text-t1 px-2 py-0.5 rounded-kbd border border-ln2">
                  {stageItems.length}
                </span>
              </div>

              {/* Cards list */}
              <div className="space-y-3 flex-1 overflow-y-auto">
                {stageItems.length === 0 ? (
                  <div className="h-24 border border-dashed border-ln rounded-card flex items-center justify-center text-caption text-t3">
                    No items at stage
                  </div>
                ) : (
                  stageItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={`p-3.5 rounded-card border cursor-pointer transition-all space-y-2.5 shadow-sh hover:shadow-md ${
                        item.blocked
                          ? "bg-warnS/30 border-warn/50"
                          : "bg-sf border-ln hover:border-acc"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono font-bold text-acc bg-acc/10 px-2 py-0.5 rounded-kbd border border-acc/20">
                          {item.order_no}
                        </span>
                        <span className="text-[10px] font-mono text-t3 truncate">
                          {item.workshop_name}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-caption font-bold text-t1 line-clamp-2">{item.description}</h4>
                        <p className="text-[11px] text-t2 font-medium mt-0.5">{item.customer_name}</p>
                      </div>

                      {/* Photo indicators & actions */}
                      <div className="flex items-center justify-between pt-1 border-t border-ln2 text-[11px]">
                        {item.photos.length > 0 ? (
                          <span className="text-pos font-semibold flex items-center gap-1">
                            <Camera className="w-3 h-3" /> {item.photos.length} photo{item.photos.length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-t3">No photos yet</span>
                        )}

                        <span className="text-acc font-semibold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          Timeline →
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Item History & Photo Drawer (Portalled to document.body) */}
      {mounted &&
        selectedItem &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex justify-end">
          <div className="w-full max-w-lg bg-sf border-l border-ln h-full overflow-y-auto p-6 space-y-6 shadow-2xl flex flex-col">
            {/* Drawer Header */}
            <div className="flex items-start justify-between gap-3 border-b border-ln pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-caption font-mono font-bold text-acc bg-acc/10 px-2 py-0.5 rounded-kbd border border-acc/20">
                    {selectedItem.order_no}
                  </span>
                  <span className="text-caption text-t2 font-medium">{selectedItem.customer_name}</span>
                </div>
                <h3 className="text-title font-bold text-t1 mt-1">{selectedItem.description}</h3>
                <p className="text-caption text-t3 font-mono mt-0.5">
                  Workshop: {selectedItem.workshop_name} ({selectedItem.workshop_type === "own" ? "Own floor" : "Vendor"})
                </p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="text-t3 hover:text-t1 p-1 rounded-card hover:bg-sf2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* WhatsApp Progress Sharing Action */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-card space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-caption font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <Share2 className="w-4 h-4" />
                  <span>WhatsApp Progress Update</span>
                </span>
              </div>
              <p className="text-caption text-t2">
                Send a live stage update to <span className="font-semibold text-t1">{selectedItem.customer_name}</span> ({selectedItem.customer_phone || "No phone"})
              </p>
              <a
                href={buildWhatsAppUrl(selectedItem, selectedItem.photos[0]?.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 text-caption font-bold bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 px-4 rounded-card transition-all shadow-md shadow-emerald-600/20"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Update on WhatsApp →</span>
              </a>
            </div>

            {/* Production Photos Section */}
            <div className="space-y-3">
              <h4 className="text-label-sm uppercase font-semibold text-t2 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-acc" />
                <span>Stage Evidence Photos ({selectedItem.photos.length})</span>
              </h4>

              {selectedItem.photos.length === 0 ? (
                <div className="p-4 border border-ln rounded-card bg-sf2 text-center text-caption text-t3">
                  No photos uploaded for this item yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {selectedItem.photos.map((p) => (
                    <div key={p.id} className="rounded-card border border-ln overflow-hidden bg-sf2 space-y-1.5 p-2">
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        <img src={p.url} alt="Stage photo" className="w-full h-32 object-cover rounded-card hover:opacity-90 transition-opacity" />
                      </a>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-pos">{stageMap.get(p.stageCode)?.label_en || p.stageCode}</span>
                        <a
                          href={buildWhatsAppUrl(selectedItem, p.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-600 font-bold hover:underline flex items-center gap-0.5"
                        >
                          Share →
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Complete Stage History Timeline */}
            <div className="space-y-3 flex-1">
              <h4 className="text-label-sm uppercase font-semibold text-t2 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-acc" />
                <span>Production Stage History</span>
              </h4>

              <div className="space-y-3 border-l-2 border-ln pl-4 ml-1">
                {stages.map((stg) => {
                  const currentCode = selectedItem.current_stage || firstStageCode;
                  const curIndex = stages.findIndex((s) => s.code === currentCode);
                  const isPast = stg.sort <= (stageMap.get(currentCode)?.sort ?? 10);
                  const isCurrent = stg.code === currentCode;

                  return (
                    <div key={stg.code} className="relative text-caption space-y-0.5">
                      <div
                        className={`absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2 ${
                          isCurrent
                            ? "bg-acc border-sf ring-2 ring-acc/30"
                            : isPast
                            ? "bg-pos border-sf"
                            : "bg-sf3 border-ln"
                        }`}
                      />
                      <div className="flex items-center justify-between">
                        <span className={`font-bold ${isCurrent ? "text-acc" : isPast ? "text-t1" : "text-t3"}`}>
                          {stg.label_en}
                          {stg.label_gu && <span className="ml-1 font-normal text-t3">({stg.label_gu})</span>}
                        </span>
                        {isCurrent && <Pill tone="pos" dot={false}>ACTIVE STAGE</Pill>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
