"use client";

import { useState } from "react";
import { Camera, Share2, ExternalLink, Sparkles, X, Check } from "lucide-react";
import Pill from "@/components/ui/Pill";

export interface ProductionPhoto {
  id: string;
  orderItemId: string;
  itemDescription: string;
  stageCode: string | null;
  stageLabel: string | null;
  imageUrl: string;
  createdAt: string;
}

export default function OrderProductionPhotos({
  customerName,
  customerPhone,
  orderNo,
  photos,
}: {
  customerName: string;
  customerPhone: string | null;
  orderNo: string;
  photos: ProductionPhoto[];
}) {
  const [selectedPhoto, setSelectedPhoto] = useState<ProductionPhoto | null>(null);

  if (photos.length === 0) return null;

  function buildWhatsAppUrl(photo: ProductionPhoto) {
    const rawPhone = (customerPhone || "").replace(/\D/g, "");
    const formattedPhone = rawPhone.length === 10 ? `91${rawPhone}` : rawPhone;
    
    const message = encodeURIComponent(
      `Hello ${customerName}!\n\nHere is a live production progress photo for your item *${photo.itemDescription}* (Order: ${orderNo}):\n\n📌 Stage: *${photo.stageLabel || photo.stageCode || "In Production"}*\n\nView photo: ${photo.imageUrl}\n\nThank you for choosing Topaz!`
    );

    return `https://wa.me/${formattedPhone}?text=${message}`;
  }

  return (
    <div className="mt-4 pt-3 border-t border-ln space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-label-sm uppercase font-semibold text-t2 flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5 text-acc" />
          <span>Production Photo Gallery ({photos.length})</span>
        </span>
      </div>

      {/* Thumbnails grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {photos.map((p) => (
          <div
            key={p.id}
            className="group relative rounded-card overflow-hidden border border-ln bg-sf2 hover:border-acc transition-all shadow-sh"
          >
            <img
              src={p.imageUrl}
              alt={p.itemDescription}
              className="w-full h-24 object-cover cursor-pointer group-hover:scale-105 transition-transform"
              onClick={() => setSelectedPhoto(p)}
            />
            <div className="p-2 space-y-1 bg-sf font-sans">
              <p className="text-[11px] font-bold text-t1 truncate">{p.itemDescription}</p>
              {p.stageLabel && (
                <p className="text-[10px] text-pos font-semibold truncate">
                  {p.stageLabel}
                </p>
              )}
              <a
                href={buildWhatsAppUrl(p)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 w-full inline-flex items-center justify-center gap-1 text-[10.5px] font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 py-1 px-2 rounded-kbd transition-colors"
              >
                <Share2 className="w-3 h-3" />
                <span>Share on WhatsApp</span>
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Photo Lightbox Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-sf border border-ln rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-3 right-3 text-t3 hover:text-t1 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-body font-bold text-t1">{selectedPhoto.itemDescription}</h3>
              <p className="text-caption text-t3 font-mono">
                Order {orderNo} · Stage: {selectedPhoto.stageLabel || selectedPhoto.stageCode}
              </p>
            </div>

            <div className="rounded-xl overflow-hidden bg-black max-h-[60vh] flex items-center justify-center">
              <img
                src={selectedPhoto.imageUrl}
                alt="Full size production photo"
                className="max-h-[60vh] w-auto object-contain"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedPhoto(null)}
                className="text-caption font-semibold text-t2 hover:text-t1 px-4 py-2"
              >
                Close
              </button>
              <a
                href={buildWhatsAppUrl(selectedPhoto)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-caption font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-card shadow-lg shadow-emerald-600/20 transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>Share on WhatsApp →</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
