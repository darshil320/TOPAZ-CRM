"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Sparkles, ArrowRight, ShieldCheck, Phone, CheckSquare, Square } from "lucide-react";

type Step = "phone" | "otp";

const SAVED_PHONE_KEY = "topaz_remembered_phone";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  if (raw.startsWith("+")) {
    return `+${digits}`;
  }
  return digits ? `+${digits}` : "";
}

export default function LoginPage() {
  const supabase = createClient();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(SAVED_PHONE_KEY);
    if (saved) {
      setPhone(saved);
      setRememberMe(true);
    }
  }, []);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formattedPhone = normalizePhone(phone);
    if (!formattedPhone || formattedPhone.length < 12) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }

    setLoading(true);

    if (rememberMe) {
      localStorage.setItem(SAVED_PHONE_KEY, phone.trim());
    } else {
      localStorage.removeItem(SAVED_PHONE_KEY);
    }

    const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("otp");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formattedPhone = normalizePhone(phone);
    const { error } = await supabase.auth.verifyOtp({ phone: formattedPhone, token: otp, type: "sms" });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/";
  }

  const formattedPreview = phone.trim() ? normalizePhone(phone) : "";

  return (
    <div className="min-h-screen bg-sf flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Dynamic Ambient Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-acc/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-72 h-72 bg-accL/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-acc text-white flex items-center justify-center shadow-xl shadow-acc/20 border border-white/20">
            <Sparkles className="w-7 h-7" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-t1 tracking-tight">Topaz CRM</h1>
            <p className="text-caption font-medium text-t3 mt-1 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-pos" /> Showroom Intelligence Engine
            </p>
          </div>
        </div>

        {/* Auth Card */}
        <div className="bg-sf2/80 backdrop-blur-xl rounded-card border border-ln p-6 sm:p-8 shadow-xl space-y-6">
          {step === "phone" ? (
            <form onSubmit={sendOtp} className="space-y-5">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-section font-bold text-t1">Staff Sign In</h2>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-kbd bg-sf3 border border-ln text-t2 font-medium">
                    OTP Auth
                  </span>
                </div>
                <p className="text-caption text-t3 mt-1">
                  Enter your registered mobile number. A 6-digit code will be sent to your WhatsApp.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-caption font-semibold text-t2">
                  WhatsApp Number
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3.5 flex items-center gap-1.5 text-t3 font-mono text-ui font-semibold select-none border-r border-ln pr-2.5">
                    <Phone className="w-4 h-4 text-t3" />
                    <span>+91</span>
                  </div>
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="9XXXXXXXXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoFocus
                    className="w-full pl-24 pr-4 py-3 bg-sf border border-ln rounded-md text-body font-mono text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:ring-1 focus:ring-acc/30 transition-all shadow-sh"
                  />
                </div>

                {formattedPreview && (
                  <p className="text-[11.5px] font-mono text-t3 flex items-center gap-1">
                    Will send to: <span className="font-semibold text-acc font-mono">{formattedPreview}</span>
                  </p>
                )}
              </div>

              {/* Remember Me Option */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setRememberMe(!rememberMe)}
                  className="flex items-center gap-2 text-caption font-medium text-t2 hover:text-t1 transition-colors select-none"
                >
                  {rememberMe ? (
                    <CheckSquare className="w-4 h-4 text-acc shrink-0" strokeWidth={2} />
                  ) : (
                    <Square className="w-4 h-4 text-t3 shrink-0" strokeWidth={2} />
                  )}
                  <span>Remember my number on this device</span>
                </button>
              </div>

              {error && (
                <div className="rounded-md border border-warn/30 bg-warnS px-3.5 py-2.5 text-caption font-semibold text-warn">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !phone.trim()}
                className="w-full bg-acc hover:bg-accL active:scale-[0.99] text-white rounded-md py-3 text-ui font-semibold transition-all shadow-sh flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending OTP…
                  </span>
                ) : (
                  <>
                    <span>Send OTP via WhatsApp</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-5">
              <div>
                <h2 className="text-section font-bold text-t1">Verify Verification Code</h2>
                <p className="text-caption text-t3 mt-1">
                  6-digit code dispatched to <span className="font-semibold font-mono text-t1">{formattedPreview}</span>
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-caption font-semibold text-t2">
                  Enter 6-Digit OTP
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="• • • • • •"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                  autoFocus
                  className="w-full bg-sf border border-ln rounded-md px-4 py-3 text-body font-bold font-mono tracking-[0.5em] text-center text-t1 placeholder-t3 focus:outline-none focus:border-acc focus:ring-1 focus:ring-acc/30 transition-all shadow-sh"
                />
              </div>

              {error && (
                <div className="rounded-md border border-warn/30 bg-warnS px-3.5 py-2.5 text-caption font-semibold text-warn">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-acc hover:bg-accL active:scale-[0.99] text-white rounded-md py-3 text-ui font-semibold transition-all shadow-sh flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying Credentials…
                  </span>
                ) : (
                  <>
                    <span>Complete Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError(null);
                }}
                className="w-full text-caption font-medium text-t3 hover:text-t1 transition-colors py-1 text-center block"
              >
                ← Edit phone number
              </button>
            </form>
          )}
        </div>

        {/* Footer info */}
        <p className="text-center text-[11.5px] text-t3">
          Topaz Intelligence CRM · Secured for authorized showroom staff
        </p>
      </div>
    </div>
  );
}
