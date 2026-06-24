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
    <div className="flex flex-col flex-1 min-h-0 relative">
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-slate-900 text-white text-xs px-4 py-2 rounded-full shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/50">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
            </div>
            <p className="text-sm text-slate-400">No messages yet</p>
          </div>
        )}
        {messages.map((msg) => {
          const isOut = msg.direction === "outbound";
          const isDraft = msg.draft_status === "pending_approval";
          const isRejected = msg.draft_status === "rejected";
          return (
            <div key={msg.id} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
              <div
                className={[
                  "max-w-[78%] px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                  isOut
                    ? isRejected
                      ? "bg-slate-100 text-slate-400 border border-slate-200 rounded-2xl rounded-br-md line-through"
                      : "bg-blue-600 text-white rounded-2xl rounded-br-md"
                    : "bg-white text-slate-800 border border-slate-200 rounded-2xl rounded-bl-md",
                  isDraft ? "opacity-70 border-dashed" : "",
                  isRejected ? "opacity-50" : "",
                ].join(" ")}
              >
                {msg.content}
              </div>
              <div className={`flex items-center gap-1.5 mt-1 px-1 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
                <span className="text-[10px] text-slate-400">{formatTime(msg.created_at)}</span>
                {isDraft && (
                  <div className="flex items-center gap-1">
                    <span className="bg-amber-50 text-amber-600 border border-amber-200 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      Draft
                    </span>
                    <button
                      onClick={() => handleApprove(msg.id)}
                      disabled={isPending}
                      className="w-6 h-6 rounded-full bg-green-50 text-green-600 hover:bg-green-100 flex items-center justify-center border border-green-200 transition-colors disabled:opacity-50"
                      title="Approve & send"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleReject(msg.id)}
                      disabled={isPending}
                      className="w-6 h-6 rounded-full bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center border border-red-200 transition-colors disabled:opacity-50"
                      title="Reject draft"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
                {msg.draft_status === "approved" && (
                  <span className="bg-green-50 text-green-700 border border-green-200 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                    Sent ✓✓
                  </span>
                )}
                {isRejected && (
                  <span className="bg-red-50 text-red-400 border border-red-200 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                    Rejected
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSend}
        className="p-3 bg-white border-t border-slate-200 flex items-end gap-2 shrink-0"
      >
        <textarea
          ref={textareaRef}
          value={replyText}
          onChange={(e) => {
            setReplyText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
          }}
          placeholder={waId ? "Type a message…" : "No WhatsApp number on file"}
          disabled={!waId}
          rows={1}
          className="flex-1 text-sm border border-slate-200 rounded-2xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-all bg-slate-50 placeholder:text-slate-400 disabled:opacity-50 min-h-[42px] max-h-[120px]"
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
          className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full flex items-center justify-center transition-all shrink-0 shadow-sm active:scale-95"
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
