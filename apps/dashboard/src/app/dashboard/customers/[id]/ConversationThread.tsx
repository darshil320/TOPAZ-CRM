"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendReply } from "./actions";

type Message = {
  id: string;
  content: string;
  direction: "outbound" | "inbound";
  sender_type: string;
  draft_status: string | null;
  created_at: string;
};

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
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `customer_id=eq.${customerId}`,
        },
        (payload) => setMessages((prev) => [...prev, payload.new as Message]),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [customerId]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || isPending) return;
    if (!waId) {
      showToast("No WhatsApp number on file for this customer");
      return;
    }
    setReplyText("");
    startTransition(async () => {
      const { error } = await sendReply(customerId, waId, text);
      if (error) showToast(`Send failed: ${error}`);
    });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 relative">
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-3 py-1.5 rounded-full z-10 shadow-md whitespace-nowrap">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-10">No messages yet.</p>
        )}
        {messages.map((msg) => {
          const isOut = msg.direction === "outbound";
          return (
            <div key={msg.id} className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}>
              <div
                className={[
                  "max-w-[85%] px-4 py-2.5 text-sm",
                  isOut
                    ? "bg-blue-600 text-white rounded-2xl rounded-br-none"
                    : "bg-white text-gray-800 border border-gray-200 rounded-2xl rounded-bl-none shadow-sm",
                ].join(" ")}
              >
                {msg.content}
              </div>
              <div className="flex items-center gap-1.5 mt-1 px-1">
                <span className="text-[10px] text-gray-400">
                  {msg.sender_type} ·{" "}
                  {new Date(msg.created_at).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {msg.draft_status === "pending_approval" && (
                  <span className="bg-yellow-100 text-yellow-700 border border-yellow-200 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                    ⏳ Awaiting approval
                  </span>
                )}
                {msg.draft_status === "approved" && (
                  <span className="bg-green-100 text-green-700 border border-green-200 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                    ✓ Approved
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
        className="p-3 bg-white border-t border-gray-200 flex gap-2 shrink-0"
      >
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={!replyText.trim() || isPending}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 rounded-xl text-sm font-medium transition-colors shrink-0"
        >
          {isPending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
