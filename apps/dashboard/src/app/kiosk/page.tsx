"use client";

import { useState, useTransition, useEffect } from "react";
import { enrollCustomer } from "./actions";

type FormData = {
  name: string;
  phone: string;
  primary_interest: string;
};

type ConsentData = {
  face_tracking: boolean;
  personal_data: boolean;
  whatsapp_marketing: boolean;
};

export default function KioskPage() {
  const [step, setStep] = useState(1);
  const [animClass, setAnimClass] = useState("opacity-100 translate-y-0 scale-100");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>({
    name: "",
    phone: "",
    primary_interest: "Modular Kitchen",
  });

  const [consent, setConsent] = useState<ConsentData>({
    face_tracking: false,
    personal_data: false,
    whatsapp_marketing: false,
  });

  useEffect(() => {
    if (step === 3) {
      const timer = setTimeout(handleReset, 8000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleReset = () => {
    goToStep(1);
    setFormData({ name: "", phone: "", primary_interest: "Modular Kitchen" });
    setConsent({ face_tracking: false, personal_data: false, whatsapp_marketing: false });
    setError(null);
  };

  const goToStep = (nextStep: number) => {
    setAnimClass("opacity-0 translate-y-4 scale-95");
    setTimeout(() => {
      setStep(nextStep);
      setAnimClass("opacity-100 translate-y-0 scale-100");
    }, 200);
  };

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    goToStep(2);
  };

  const handleCheckboxChange = (key: keyof ConsentData) => {
    setConsent((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isConsentValid = consent.face_tracking && consent.personal_data && consent.whatsapp_marketing;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConsentValid) {
      setError("Please accept all terms and consents individually to proceed.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const wa_id = formData.phone ? formData.phone.trim().replace(/^\+/, "") : "";
      const res = await enrollCustomer({
        name: formData.name,
        phone: formData.phone,
        wa_id,
        primary_interest: formData.primary_interest,
        face_tracking: consent.face_tracking,
        personal_data: consent.personal_data,
        whatsapp_marketing: consent.whatsapp_marketing,
      });
      if (res.success) {
        goToStep(3);
      } else {
        setError(res.error || "Enrollment failed. Please try again.");
      }
    });
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between items-center bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100/20 p-6 md:p-12 selection:bg-amber-200 selection:text-amber-900">
      <div className="w-full max-w-xl flex flex-col items-center gap-6 mt-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-600 flex items-center justify-center shadow-lg shadow-amber-600/30">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </div>
          <span className="font-black text-2xl text-amber-700 tracking-tight">Topaz</span>
        </div>

        <div className="flex items-center gap-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                step === n
                  ? "bg-amber-600 scale-125 ring-4 ring-amber-100"
                  : n < step
                  ? "bg-amber-700/50"
                  : "bg-amber-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-xl flex-1 flex items-center justify-center my-8">
        <div
          className={`w-full bg-white/80 backdrop-blur-md border border-amber-100/50 rounded-3xl shadow-xl shadow-amber-950/5 p-6 md:p-10 transition-all duration-300 transform ${animClass}`}
        >
          {step === 1 && (
            <form onSubmit={handleNextStep1} className="flex flex-col gap-6">
              <div className="space-y-1.5">
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight">
                  Welcome to Topaz
                </h1>
                <p className="text-slate-500 text-sm md:text-base">
                  Enter your details to personalize your showroom experience.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-semibold text-slate-700 block">
                    Full Name <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter your name"
                    className="w-full px-4 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500 focus:outline-none text-lg min-h-[56px] transition-all bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="phone" className="text-sm font-semibold text-slate-700 block">
                    Phone Number <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+91 XXXXX XXXXX"
                    className="w-full px-4 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500 focus:outline-none text-lg min-h-[56px] transition-all bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="interest" className="text-sm font-semibold text-slate-700 block">
                    Primary Interest
                  </label>
                  <select
                    id="interest"
                    value={formData.primary_interest}
                    onChange={(e) => setFormData({ ...formData, primary_interest: e.target.value })}
                    className="w-full px-4 rounded-xl border border-slate-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-500 focus:outline-none text-lg min-h-[56px] transition-all bg-white cursor-pointer"
                  >
                    <option value="Modular Kitchen">Modular Kitchen</option>
                    <option value="Living Room">Living Room</option>
                    <option value="Bedroom">Bedroom</option>
                    <option value="Office Furniture">Office Furniture</option>
                    <option value="Full Interior">Full Interior</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-lg min-h-[56px] shadow-lg shadow-amber-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2"
              >
                <span>Continue</span>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="space-y-1.5">
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-800 tracking-tight">
                  Consent & Preferences
                </h1>
                <p className="text-slate-500 text-sm md:text-base">
                  Confirm your options below to finalize your showroom registration.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  {
                    key: "face_tracking" as const,
                    title: "Face Recognition Tracking",
                    desc: "Identifies repeat visits to configure automated salesperson assignments.",
                  },
                  {
                    key: "personal_data" as const,
                    title: "Personal Data Processing",
                    desc: "Allows Topaz to store your details securely in our internal system.",
                  },
                  {
                    key: "whatsapp_marketing" as const,
                    title: "WhatsApp Follow-up Messages",
                    desc: "Consent to receive catalogs, follow-ups, and notifications on WhatsApp.",
                  },
                ].map(({ key, title, desc }) => (
                  <label
                    key={key}
                    className="flex items-start gap-4 p-4 border border-slate-200 rounded-xl cursor-pointer hover:bg-amber-50/30 transition-all select-none min-h-[56px]"
                  >
                    <input
                      type="checkbox"
                      checked={consent[key]}
                      onChange={() => handleCheckboxChange(key)}
                      className="w-6 h-6 rounded border-slate-300 text-amber-600 focus:ring-amber-500 mt-1 shrink-0 cursor-pointer"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-base font-semibold text-slate-800">{title}</span>
                      <span className="text-sm text-slate-500 leading-normal">{desc}</span>
                    </div>
                  </label>
                ))}
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 text-sm font-medium">
                  {error}
                </div>
              )}

              <div className="flex gap-4 mt-2">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  disabled={isPending}
                  className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-lg min-h-[56px] transition-all flex items-center justify-center gap-2 border border-slate-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  <span>Back</span>
                </button>
                <button
                  type="submit"
                  disabled={!isConsentValid || isPending}
                  className="flex-[2] bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold rounded-xl text-lg min-h-[56px] shadow-lg shadow-amber-600/20 disabled:shadow-none active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Register</span>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center text-center gap-6 py-6">
              <div className="w-20 h-20 bg-green-50 border border-green-200 rounded-full flex items-center justify-center text-green-500 shadow-md">
                <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-2.5">
                <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Welcome to Topaz!</h1>
                <p className="text-slate-600 text-lg font-medium">Your profile has been created.</p>
                <p className="text-slate-400 text-sm">Our team will be in touch shortly.</p>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="mt-4 px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl text-base transition-all shadow-md shadow-amber-600/10"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-xs text-amber-900/35 tracking-wider uppercase font-semibold">
        Topaz Showroom Kiosk Experience • Privacy Shield Active
      </div>
    </div>
  );
}
