/**
 * Why a queue action is unavailable — pure, so the PWA never renders a dead button.
 *
 * The shop floor version of this bug was expensive: a sub-manager tapped a greyed-out
 * "Stage done" all day with no explanation, and the actual cause (her `workshop_staff`
 * row was being ignored by the API's capability gate) was invisible from the screen.
 * Every disabled state here therefore carries a sentence, and the capability comes from
 * the API's own `capabilities` array rather than a guess at the role — same rule the
 * write route gates on (apps/api/src/services/stage_flow.capabilities_for).
 *
 * Bilingual by convention in this app: the workshop reads Hindi/Gujarati first.
 */

import type { Capability, StaffRole } from "./types";

export interface ActionGuard {
  allowed: boolean;
  /** Null when allowed. Otherwise the sentence to render under the button. */
  reason: string | null;
}

const ALLOWED: ActionGuard = { allowed: true, reason: null };

const refuse = (reason: string): ActionGuard => ({ allowed: false, reason });

/**
 * Capabilities at one workshop, falling back to the roster role when an older cached
 * `my-queue` payload predates the `capabilities` field. The fallback is deliberately
 * the NARROW reading (roster role only) — a stale payload must not invent permissions.
 */
export function capabilitiesAt(
  workshop: { staff_role: StaffRole; capabilities?: Capability[] } | undefined,
): Set<Capability> {
  if (!workshop) return new Set();
  if (workshop.capabilities) return new Set(workshop.capabilities);
  return workshop.staff_role === "lead"
    ? new Set<Capability>(["status", "custody"])
    : new Set<Capability>(["status"]);
}

export function advanceGuard({
  caps,
  blocked,
  photoRequired,
  hasPhoto,
  photoUploading,
}: {
  caps: Set<Capability>;
  blocked: boolean;
  photoRequired: boolean;
  hasPhoto: boolean;
  photoUploading: boolean;
}): ActionGuard {
  // Capability first: it is the only reason that will not clear by itself, so telling
  // someone to attach a photo they are not allowed to use would waste their time.
  if (!caps.has("status")) {
    return refuse(
      "आपके पास इस साइट पर स्टेज अपडेट का अधिकार नहीं है — मालिक से स्टाफ लिस्ट में जोड़ने को कहें। / " +
        "You are not on this workshop's staff list with status rights — ask the owner to add you.",
    );
  }
  if (blocked) {
    return refuse(
      "पहले अवरोध हटाएँ / Clear the blocker first — a blocked item cannot move forward.",
    );
  }
  if (photoUploading) {
    return refuse("फ़ोटो अपलोड हो रही है… / Photo is still uploading…");
  }
  if (photoRequired && !hasPhoto) {
    return refuse("इस स्टेज के लिए फ़ोटो जरूरी है / This stage needs a photo before it can be completed.");
  }
  return ALLOWED;
}

export function handoverGuard({
  caps,
  inTransit,
  legFinished,
  hasNextWorkshop,
}: {
  caps: Set<Capability>;
  inTransit: boolean;
  legFinished: boolean;
  hasNextWorkshop: boolean;
}): ActionGuard {
  if (!hasNextWorkshop) {
    return refuse("इस रूट में आगे कोई वर्कशॉप नहीं है / No further workshop on this item's route.");
  }
  if (inTransit) {
    return refuse("सामान रास्ते में है / These goods are already on their way.");
  }
  if (!legFinished) {
    return refuse(
      "इस वर्कशॉप के सभी स्टेज पहले पूरे करें / Finish this workshop's stages before handing over.",
    );
  }
  if (!caps.has("custody")) {
    return refuse(
      "सामान भेजना मुख्य मैनेजर का काम है / Only a workshop lead may hand goods over.",
    );
  }
  return ALLOWED;
}
