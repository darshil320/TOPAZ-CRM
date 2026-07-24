/** Kanban stage vocabulary (the 9-stage 2A set; legacy enum values excluded).
 * Shared by the board page and the move action. */

export const BOARD_STAGES = [
  "inquiry",
  "contacted",
  "visit_scheduled",
  "walk_in",
  "design_discussion",
  "quotation_sent",
  "negotiation",
  "order_confirmed",
  "lost",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  inquiry: "Inquiry",
  contacted: "Contacted",
  visit_scheduled: "Visit Scheduled",
  walk_in: "Walk-in",
  design_discussion: "Design Discussion",
  quotation_sent: "Quotation Sent",
  negotiation: "Negotiation",
  order_confirmed: "Order Confirmed",
  lost: "Lost",
};
