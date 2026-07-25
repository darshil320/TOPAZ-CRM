"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendReply, approveDraft, rejectDraft } from "./actions";

type Message = {
  id: string;
  content: string;
  direction: "outbound" | "inbound";
  sender_type: string;
  draft_status: string | null;
  created_at: string;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function ConversationThread({
  customerId,
  waId,
  initialMessages,
}: {
  customerId: string;
  waId: string | null;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabaseRef = useRef(createClient());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`messages-${customerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `customer_id=eq.${customerId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [customerId]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function handleApprove(messageId: string) {
    const snapshot = messages;
    setMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, draft_status: "approved" } : m),
    );
    startTransition(async () => {
      const { error } = await approveDraft(messageId, customerId);
      if (error) {
        showToast(`Approval failed: ${error}`);
        setMessages(snapshot);
      }
    });
  }

  function handleReject(messageId: string) {
    const snapshot = messages;
    setMessages((prev) =>
      prev.map((m) => m.id === messageId ? { ...m, draft_status: "rejected" } : m),
    );
    startTransition(async () => {
      const { error } = await rejectDraft(messageId, customerId);
      if (error) {
        showToast(`Rejection failed: ${error}`);
        setMessages(snapshot);
      }
    });
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || isPending) return;
    if (!waId) { showToast("No WhatsApp number on file for this customer"); return; }
    setReplyText("");
    startTransition(async () => {
      const { error } = await sendReply(customerId, waId, text);
      if (error) showToast(`Send failed: ${error}`);
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 relative bg-slate-50/50">
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-xl whitespace-nowrap animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3 text-slate-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-xs font-bold text-slate-700">No WhatsApp messages yet</p>
            <p className="text-[11px] text-slate-400 mt-1">Outbound &amp; inbound messages will appear here in real-time.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOut = msg.direction === "outbound";
            const isDraft = msg.draft_status === "pending_approval";
            const isRejected = msg.draft_status === "rejected";

            return (
              <div key={msg.id} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
                <div
                  className={[
                    "max-w-[85%] sm:max-w-[75%] px-4 py-3 text-xs leading-relaxed shadow-2xs transition-all",
                    isOut
                      ? isRejected
                        ? "bg-slate-100 text-slate-400 border border-slate-200 rounded-2xl rounded-tr-xs line-through"
                        : isDraft
                        ? "bg-amber-50/90 text-amber-950 border border-amber-300/80 rounded-2xl rounded-tr-xs shadow-sm"
                        : "bg-blue-600 text-white rounded-2xl rounded-tr-xs shadow-sm font-medium"
                      : "bg-white text-slate-800 border border-slate-200/90 rounded-2xl rounded-tl-xs shadow-2xs font-medium",
                  ].join(" ")}
                >
                  {msg.content}
                </div>

                {/* Footer status badges */}
                <div className={`flex items-center gap-2 mt-1.5 px-1 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
                  <span className="text-[10px] font-semibold text-slate-400">{formatTime(msg.created_at)}</span>

                  {isDraft && (
                    <div className="flex items-center gap-1.5 bg-amber-100/80 border border-amber-300 px-2 py-0.5 rounded-full shadow-2xs">
                      <span className="text-[10px] font-bold text-amber-800">
                        AI Draft Pending
                      </span>
                      <button
                        type="button"
                        onClick={() => handleApprove(msg.id)}
                        disabled={isPending}
                        className="px-2 py-0.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] font-extrabold transition-all active:scale-95 disabled:opacity-50"
                      >
                        Approve &amp; Send
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(msg.id)}
                        disabled={isPending}
                        className="px-2 py-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 text-[10px] font-extrabold transition-all active:scale-95 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {msg.draft_status === "approved" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      Sent ✓✓
                    </span>
                  )}

                  {isRejected && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                      Rejected
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSend}
        className="p-3.5 bg-white border-t border-slate-200 flex items-end gap-2.5 shrink-0"
      >
        <textarea
          ref={textareaRef}
          value={replyText}
          onChange={(e) => {
            setReplyText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
          placeholder={waId ? "Type a WhatsApp message..." : "No WhatsApp number on file"}
          disabled={!waId}
          rows={1}
          className="flex-1 text-xs font-medium border border-slate-200 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none transition-all bg-slate-50 placeholder:text-slate-400 disabled:opacity-50 min-h-[42px] max-h-[120px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={!replyText.trim() || isPending || !waId}
          className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-2xl flex items-center justify-center transition-all shrink-0 shadow-sm active:scale-95"
        >
          {isPending ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
