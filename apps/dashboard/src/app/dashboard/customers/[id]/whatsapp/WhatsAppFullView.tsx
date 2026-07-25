"use client";

import { useEffect, useRef, useState, useTransition, useMemo, useDeferredValue } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { sendReply, approveDraft, rejectDraft } from "../actions";

type Message = {
  id: string;
  content: string;
  direction: "outbound" | "inbound";
  sender_type: string;
  draft_status: string | null;
  created_at: string;
};

type CustomerInfo = {
  id: string;
  name: string | null;
  phone: string | null;
  wa_id: string | null;
  handler_mode: string | null;
  primary_interest?: string | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateHeader(iso: string) {
  const msgDate = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (msgDate.toDateString() === today.toDateString()) {
    return "TODAY";
  }
  if (msgDate.toDateString() === yesterday.toDateString()) {
    return "YESTERDAY";
  }
  return msgDate.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).toUpperCase();
}

// Group messages by date
function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; items: Message[] }[] = [];
  messages.forEach((msg) => {
    const dateStr = formatDateHeader(msg.created_at);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.date === dateStr) {
      lastGroup.items.push(msg);
    } else {
      groups.push({ date: dateStr, items: [msg] });
    }
  });
  return groups;
}

const QUICK_TEMPLATES = [
  { label: "📋 Follow-up", text: "Hi! Following up on your recent visit to our showroom. Did you get a chance to review the options?" },
  { label: "🛋️ Visit Invitation", text: "We have new living room & sofa collections arriving this week! Would you like to schedule a visit?" },
  { label: "💰 Offer Update", text: "Great news! We have an exclusive pricing update available for your preferred items." },
  { label: "📍 Location & Timing", text: "Our showroom is open today from 10 AM to 8 PM. Looking forward to welcoming you!" },
];

const EMOJIS = ["😊", "👍", "🙏", "🛋️", "✨", "❤️", "📍", "💰", "📞", "✅", "🎉", "🔥"];

export default function WhatsAppFullView({
  customerId,
  customer,
  initialMessages,
}: {
  customerId: string;
  customer: CustomerInfo;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [replyText, setReplyText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const supabaseRef = useRef(createClient());
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Deferred search query for 60fps typing responsiveness
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Auto-scroll to bottom whenever messages change or initial load
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Real-time Supabase Subscription with instant deduplication
  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`whatsapp-full-${customerId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `customer_id=eq.${customerId}`,
        },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            // Replace any optimistic message matching the content or id
            const exists = prev.some((m) => m.id === newMsg.id);
            if (exists) return prev;
            // Filter out optimistic temporary messages with same content
            const filtered = prev.filter(
              (m) => !(m.id.startsWith("temp-") && m.content === newMsg.content)
            );
            return [...filtered, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `customer_id=eq.${customerId}`,
        },
        (payload) => {
          const updatedMsg = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m))
          );
        }
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

  function handleApprove(messageId: string) {
    const snapshot = messages;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, draft_status: "approved" } : m))
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
      prev.map((m) => (m.id === messageId ? { ...m, draft_status: "rejected" } : m))
    );
    startTransition(async () => {
      const { error } = await rejectDraft(messageId, customerId);
      if (error) {
        showToast(`Rejection failed: ${error}`);
        setMessages(snapshot);
      }
    });
  }

  function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const text = replyText.trim();
    if (!text) return;
    if (!customer.wa_id) {
      showToast("No WhatsApp number registered for this customer");
      return;
    }

    // ⚡ INSTANT OPTIMISTIC MESSAGE INSERTION (0ms latency perception)
    const tempId = `temp-${Date.now()}`;
    const tempMsg: Message = {
      id: tempId,
      content: text,
      direction: "outbound",
      sender_type: "salesperson",
      draft_status: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempMsg]);
    setReplyText("");
    setShowEmojiPicker(false);
    setShowAttachMenu(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    startTransition(async () => {
      const { error } = await sendReply(customerId, customer.wa_id!, text);
      if (error) {
        showToast(`Send failed: ${error}`);
        // Revert optimistic message if send failed
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
      }
    });
  }

  function startVoiceRecording() {
    setIsRecording(true);
    setRecordingTime(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }

  function stopVoiceRecording(send: boolean) {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    if (send && recordingTime > 0) {
      const text = `🎤 Audio Note (${recordingTime}s)`;
      
      // ⚡ INSTANT OPTIMISTIC AUDIO NOTE
      const tempId = `temp-${Date.now()}`;
      const tempMsg: Message = {
        id: tempId,
        content: text,
        direction: "outbound",
        sender_type: "salesperson",
        draft_status: null,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, tempMsg]);
      setReplyText("");

      startTransition(async () => {
        if (customer.wa_id) {
          const { error } = await sendReply(customerId, customer.wa_id, text);
          if (error) {
            showToast(`Audio send failed: ${error}`);
            setMessages((prev) => prev.filter((m) => m.id !== tempId));
          }
        }
      });
    }
    setRecordingTime(0);
  }

  const initials = customer.name
    ? customer.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  // Optimized filtered messages using deferred search query
  const filteredMessages = useMemo(() => {
    if (!deferredSearchQuery.trim()) return messages;
    return messages.filter((m) =>
      m.content.toLowerCase().includes(deferredSearchQuery.toLowerCase())
    );
  }, [messages, deferredSearchQuery]);

  // Memoized date grouping to prevent recalculating on every re-render
  const groupedMessages = useMemo(() => {
    return groupMessagesByDate(filteredMessages);
  }, [filteredMessages]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col h-[100dvh] w-screen bg-[#efeae2] font-sans text-slate-900 overflow-hidden">
      {/* Toast Alert */}
      {toast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[110] bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-full shadow-2xl animate-in fade-in slide-in-from-top-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          {toast}
        </div>
      )}

      {/* TOP WHATSAPP HEADER BAR */}
      <header className="bg-[#008069] text-white px-3 sm:px-5 py-3 flex items-center justify-between shrink-0 shadow-md z-10">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {/* Back to Customer Detail */}
          <Link
            href={`/dashboard/customers/${customerId}`}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors shrink-0 text-white/90 hover:text-white"
            title="Back to Customer Profile"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>

          {/* Customer Avatar & Status */}
          <div className="relative shrink-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-gradient-to-tr from-emerald-700 via-teal-600 to-green-500 text-white flex items-center justify-center font-extrabold text-sm sm:text-base border-2 border-white/20 shadow-inner">
              {initials}
            </div>
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#008069]" title="Online" />
          </div>

          <div className="min-w-0 flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm sm:text-base text-white truncate leading-tight">
                {customer.name ?? "Customer"}
              </h2>
              {customer.handler_mode === "ai" && (
                <span className="bg-emerald-800/80 text-emerald-100 text-[10px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-400/30 uppercase tracking-wider hidden sm:inline-block">
                  AI Active
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-emerald-100/90 truncate flex items-center gap-1 font-medium">
              <span>{customer.wa_id ? `+${customer.wa_id}` : customer.phone ?? "No number"}</span>
              <span className="inline-block w-1 h-1 rounded-full bg-emerald-300 mx-0.5" />
              <span className="text-emerald-200">online</span>
            </p>
          </div>
        </div>

        {/* Action Header Icons */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Quick Call Button */}
          {customer.phone && (
            <a
              href={`tel:${customer.phone}`}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/90 hover:text-white"
              title="Voice Call"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-2.824-1.47-5.116-3.762-6.586-6.586l1.293-.97c.362-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </a>
          )}

          {/* Toggle Search */}
          <button
            type="button"
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded-full transition-colors ${
              showSearch ? "bg-white/20 text-white" : "hover:bg-white/10 text-white/90 hover:text-white"
            }`}
            title="Search Messages"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>

          {/* Go to Customer Profile Link */}
          <Link
            href={`/dashboard/customers/${customerId}`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-all border border-white/20 shadow-2xs"
          >
            Customer Profile
          </Link>
        </div>
      </header>

      {/* SEARCH BAR (EXPANDABLE) */}
      {showSearch && (
        <div className="bg-[#00705c] px-4 py-2 flex items-center gap-2 text-white border-t border-emerald-600 animate-in slide-in-from-top-2">
          <svg className="w-4 h-4 text-emerald-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in conversation..."
            className="flex-1 bg-transparent text-xs font-medium placeholder:text-emerald-200/70 text-white focus:outline-none"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs text-emerald-200 hover:text-white font-bold"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* QUICK TEMPLATE SHORTCUT BAR */}
      <div className="bg-emerald-50/90 backdrop-blur-sm border-b border-emerald-200/60 px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none">
        <span className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-wider shrink-0 px-1">
          Quick Replies:
        </span>
        {QUICK_TEMPLATES.map((tmpl, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setReplyText(tmpl.text)}
            className="px-2.5 py-1 rounded-full bg-white hover:bg-emerald-100/80 border border-emerald-300/70 text-emerald-900 text-xs font-semibold whitespace-nowrap shadow-2xs transition-all active:scale-95 shrink-0"
          >
            {tmpl.label}
          </button>
        ))}
      </div>

      {/* CHAT MESSAGES BODY WITH WHATSAPP WALLPAPER PATTERN */}
      <div
        className="flex-1 overflow-y-auto px-3 sm:px-8 py-6 space-y-4 relative"
        style={{
          backgroundImage: `radial-gradient(#cbd5e1 0.75px, transparent 0.75px)`,
          backgroundSize: "16px 16px",
          backgroundColor: "#efeae2",
        }}
      >
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3 shadow-md">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z" />
              </svg>
            </div>
            <h3 className="text-sm font-bold text-slate-800">WhatsApp Live Chat Ready</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs">
              {searchQuery ? "No messages found matching search." : "Send outbound messages or receive customer replies in real-time."}
            </p>
          </div>
        ) : (
          groupedMessages.map((group, gIdx) => (
            <div key={gIdx} className="space-y-4">
              {/* STICKY DATE SEPARATOR */}
              <div className="flex justify-center my-3">
                <span className="bg-white/90 text-slate-600 border border-slate-200/80 shadow-2xs font-extrabold text-[10px] tracking-wider px-3 py-1 rounded-md uppercase">
                  {group.date}
                </span>
              </div>

              {/* MESSAGES IN GROUP */}
              {group.items.map((msg) => {
                const isOut = msg.direction === "outbound";
                const isDraft = msg.draft_status === "pending_approval";
                const isRejected = msg.draft_status === "rejected";

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isOut ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={[
                        "relative max-w-[88%] sm:max-w-[70%] px-3.5 py-2.5 text-xs leading-relaxed shadow-sm transition-all",
                        isOut
                          ? isRejected
                            ? "bg-slate-200 text-slate-500 border border-slate-300 rounded-2xl rounded-tr-none line-through"
                            : isDraft
                            ? "bg-amber-100 text-amber-950 border border-amber-300 rounded-2xl rounded-tr-none shadow-md"
                            : "bg-[#d9fdd3] text-[#111b21] rounded-2xl rounded-tr-none shadow-2xs font-normal"
                          : "bg-white text-[#111b21] border border-slate-200 rounded-2xl rounded-tl-none shadow-2xs font-normal",
                      ].join(" ")}
                    >
                      {/* Message Text */}
                      <div className="whitespace-pre-wrap break-words pr-12 text-sm sm:text-xs font-sans">
                        {msg.content}
                      </div>

                      {/* Time and Status Ticks embedded bottom right */}
                      <div className="absolute bottom-1 right-2.5 flex items-center gap-1 text-[10px] font-semibold text-slate-500 select-none">
                        <span>{formatTime(msg.created_at)}</span>
                        {isOut && !isDraft && !isRejected && (
                          <span className="text-sky-600 font-extrabold" title="Delivered">
                            ✓✓
                          </span>
                        )}
                      </div>
                    </div>

                    {/* AI DRAFT ACTIONS & BADGES */}
                    <div
                      className={`flex items-center gap-2 mt-1.5 px-1 ${
                        isOut ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {isDraft && (
                        <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 px-3 py-1.5 rounded-xl shadow-md animate-pulse">
                          <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                            ✨ AI Draft Pending Approval
                          </span>
                          <button
                            type="button"
                            onClick={() => handleApprove(msg.id)}
                            disabled={isPending}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-extrabold transition-all shadow-xs active:scale-95 disabled:opacity-50"
                          >
                            Approve &amp; Send
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(msg.id)}
                            disabled={isPending}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-extrabold transition-all shadow-xs active:scale-95 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      )}

                      {msg.draft_status === "approved" && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                          AI Approved &amp; Sent
                        </span>
                      )}

                      {isRejected && (
                        <span className="text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded-full">
                          Draft Rejected
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* POPUP EMOJI PICKER GRID */}
      {showEmojiPicker && (
        <div className="bg-white border-t border-slate-200 p-3 flex flex-wrap gap-2 z-20 shadow-lg animate-in slide-in-from-bottom-2">
          {EMOJIS.map((emoji, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setReplyText((prev) => prev + emoji);
                setShowEmojiPicker(false);
              }}
              className="w-9 h-9 rounded-xl hover:bg-slate-100 text-xl flex items-center justify-center transition-all active:scale-90"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* POPUP ATTACHMENT MENU */}
      {showAttachMenu && (
        <div className="bg-white border-t border-slate-200 p-3 flex items-center justify-around z-20 shadow-lg animate-in slide-in-from-bottom-2">
          <button
            type="button"
            onClick={() => {
              setReplyText((prev) => prev + " 📷 [Photo Attachment]");
              setShowAttachMenu(false);
            }}
            className="flex flex-col items-center gap-1 p-2 hover:bg-slate-50 rounded-xl transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold">
              📷
            </div>
            <span className="text-[11px] font-bold text-slate-600">Photo</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReplyText((prev) => prev + " 📄 [Quotation PDF]");
              setShowAttachMenu(false);
            }}
            className="flex flex-col items-center gap-1 p-2 hover:bg-slate-50 rounded-xl transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
              📄
            </div>
            <span className="text-[11px] font-bold text-slate-600">Document</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setReplyText((prev) => prev + " 📍 [Showroom Location]");
              setShowAttachMenu(false);
            }}
            className="flex flex-col items-center gap-1 p-2 hover:bg-slate-50 rounded-xl transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
              📍
            </div>
            <span className="text-[11px] font-bold text-slate-600">Location</span>
          </button>
        </div>
      )}

      {/* WHATSAPP INPUT FOOTER BAR */}
      <footer className="bg-[#f0f2f5] p-3 sm:px-4 flex items-end gap-2 shrink-0 border-t border-slate-200/80 z-20">
        {/* Emoji Button */}
        <button
          type="button"
          onClick={() => {
            setShowEmojiPicker(!showEmojiPicker);
            setShowAttachMenu(false);
          }}
          className={`p-2.5 rounded-full transition-colors shrink-0 ${
            showEmojiPicker ? "text-emerald-700 bg-emerald-100" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/70"
          }`}
          title="Emojis"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10.5h.008v.008H9V10.5zm6 0h.008v.008H15V10.5z" />
          </svg>
        </button>

        {/* Attachment Clip Button */}
        <button
          type="button"
          onClick={() => {
            setShowAttachMenu(!showAttachMenu);
            setShowEmojiPicker(false);
          }}
          className={`p-2.5 rounded-full transition-colors shrink-0 ${
            showAttachMenu ? "text-emerald-700 bg-emerald-100" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/70"
          }`}
          title="Attach File"
        >
          <svg className="w-6 h-6 rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.55 18.32a1.5 1.5 0 01-2.121-2.121l9.652-9.652" />
          </svg>
        </button>

        {/* Recording Active Bar or Input Textarea */}
        {isRecording ? (
          <div className="flex-1 bg-red-50 border border-red-200 rounded-2xl px-4 py-2.5 flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-2 text-red-600 font-bold text-xs">
              <span className="w-3 h-3 rounded-full bg-red-600 animate-ping" />
              Recording Audio Note... ({recordingTime}s)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stopVoiceRecording(false)}
                className="px-2.5 py-1 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => stopVoiceRecording(true)}
                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow-xs"
              >
                Send Audio
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSend}
            className="flex-1 flex items-end gap-2"
          >
            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => {
                setReplyText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              placeholder={
                customer.wa_id
                  ? "Type a WhatsApp message..."
                  : "No WhatsApp number registered"
              }
              disabled={!customer.wa_id}
              rows={1}
              className="flex-1 text-sm font-medium leading-normal border border-slate-200 rounded-2xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-none transition-all bg-white placeholder:text-slate-400 disabled:opacity-50 min-h-[42px] max-h-[120px] shadow-2xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
            />

            {/* Mic button when empty / Green Send button when text typed */}
            {replyText.trim() ? (
              <button
                type="submit"
                disabled={isPending || !customer.wa_id}
                className="w-11 h-11 bg-[#008069] hover:bg-[#006e5a] disabled:opacity-40 text-white rounded-full flex items-center justify-center transition-all shrink-0 shadow-md active:scale-95"
                title="Send Message"
              >
                {isPending ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceRecording}
                disabled={!customer.wa_id}
                className="w-11 h-11 bg-[#008069] hover:bg-[#006e5a] disabled:opacity-40 text-white rounded-full flex items-center justify-center transition-all shrink-0 shadow-md active:scale-95"
                title="Hold to record audio note"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 003-3V4.5a3 3 0 00-6 0v8.25a3 3 0 003 3z" />
                </svg>
              </button>
            )}
          </form>
        )}
      </footer>
    </div>
  );
}
