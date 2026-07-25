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
    <div className="flex flex-col flex-1 min-h-0 relative bg-sf">
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-y-1/2 z-20 bg-sf3 text-t1 border border-ln text-caption font-semibold px-4 py-2 rounded-full shadow-sh whitespace-nowrap animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center">
            <p className="text-body font-semibold text-t1">No WhatsApp messages yet</p>
            <p className="text-caption text-t3 mt-1">Outbound &amp; inbound messages will appear here in real-time.</p>
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
                    "relative max-w-[90%] sm:max-w-[78%] px-3.5 py-2.5 text-ui leading-snug rounded-card transition-all",
                    isOut
                      ? isRejected
                        ? "bg-sf2 text-t3 border border-ln line-through"
                        : isDraft
                        ? "bg-sf2 text-t1 border border-warn/50 shadow-sh"
                        : "bg-acc/10 text-t1 border border-acc/20 font-normal"
                      : "bg-sf2 text-t1 border border-ln font-normal",
                  ].join(" ")}
                >
                  <div className="relative break-words whitespace-pre-wrap text-ui text-t1 leading-normal">
                    <span>{msg.content}</span>
                    <span className="inline-flex items-center gap-1 float-right ml-3.5 mt-1 -mb-0.5 text-[10px] font-mono text-t3 select-none">
                      <span>{formatTime(msg.created_at)}</span>
                    </span>
                  </div>
                </div>

                {/* AI Draft Actions & Badges */}
                <div className={`flex flex-wrap items-center gap-1.5 mt-1.5 px-1 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
                  {isDraft && (
                    <div className="flex flex-wrap items-center gap-1.5 bg-sf2 border border-ln px-2 py-1 rounded-card shadow-sh">
                      <span className="text-caption font-semibold text-t1 whitespace-nowrap">
                        AI Draft Pending
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleApprove(msg.id)}
                          disabled={isPending}
                          className="px-2.5 py-0.5 rounded-full bg-pos text-white text-[10px] font-semibold transition-all active:scale-95 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(msg.id)}
                          disabled={isPending}
                          className="px-2.5 py-0.5 rounded-full bg-warn text-white text-[10px] font-semibold transition-all active:scale-95 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {msg.draft_status === "approved" && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-pos bg-sf2 border border-ln px-2 py-0.5 rounded-full shrink-0">
                      AI Approved &amp; Sent
                    </span>
                  )}

                  {isRejected && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-warn bg-sf2 border border-ln px-2 py-0.5 rounded-full shrink-0">
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
        className="p-3 bg-sf border-t border-ln flex items-end gap-2 shrink-0"
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
          className="flex-1 text-ui font-medium border border-ln rounded-card px-3.5 py-2.5 focus:outline-none focus:border-acc resize-none transition-all bg-sf2 text-t1 placeholder-t3 disabled:opacity-50 min-h-[40px] max-h-[120px]"
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
          className="w-9 h-9 bg-acc hover:opacity-90 disabled:opacity-40 text-white rounded-card flex items-center justify-center transition-all shrink-0 active:scale-95"
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
