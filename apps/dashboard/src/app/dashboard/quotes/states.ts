/** Indian state/UT codes for the "place of supply" picker. The code drives the
 * GST split: matching the showroom's home state (GJ) → CGST+SGST, otherwise
 * IGST. The exact split is (re)computed server-side; this list is just input. */

export interface StateOption {
  code: string;
  name: string;
}

export const STATE_OPTIONS: StateOption[] = [
  { code: "GJ", name: "Gujarat" },
  { code: "MH", name: "Maharashtra" },
  { code: "RJ", name: "Rajasthan" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "DL", name: "Delhi" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "KA", name: "Karnataka" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TG", name: "Telangana" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "WB", name: "West Bengal" },
  { code: "KL", name: "Kerala" },
  { code: "PB", name: "Punjab" },
  { code: "HR", name: "Haryana" },
  { code: "BR", name: "Bihar" },
  { code: "OR", name: "Odisha" },
  { code: "GA", name: "Goa" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "JH", name: "Jharkhand" },
  { code: "UK", name: "Uttarakhand" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "JK", name: "Jammu & Kashmir" },
  { code: "CH", name: "Chandigarh" },
  { code: "DN", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "PY", name: "Puducherry" },
];

export function stateName(code: string): string {
  return STATE_OPTIONS.find((s) => s.code === code)?.name ?? code;
}
