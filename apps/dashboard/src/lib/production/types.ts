/**
 * Shapes returned by the production/routing/transfer API (module 09/14).
 *
 * These mirror the money-blind projections in
 * apps/api/src/repositories/production_repo.py and transfer_repo.py. THERE IS NO PRICE
 * FIELD HERE AND THERE MUST NEVER BE ONE: a workshop or delivery user has no
 * order_items SELECT policy, so the API projection is the boundary, and a price added
 * to this interface would be a price rendered on a shop floor.
 */

export type StaffRole = "lead" | "sub";

export interface StageDef {
  code: string;
  sort: number;
  label_en: string;
  label_gu: string | null;
  photo_required: boolean;
  active?: boolean;
}

export interface WorkshopMembership {
  id: string;
  name: string;
  type: string;
  address: string | null;
  staff_role: StaffRole;
}

export interface QueueItem {
  id: string;
  description: string;
  qty: number;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  spec_notes: string | null;
  current_stage: string | null;
  current_stage_at: string | null;
  blocked: boolean;
  blocked_at: string | null;
  production_done_at: string | null;
  workshop_id: string;
  transit_transfer_id: string | null;
  order_id: string;
  order_no: string;
  customer_name: string;
  workshop_name: string;
  expected_delivery_date: string | null;
  /** The workshop's own deadline for this item, with a TIME (module 14). */
  due_at: string | null;
  due_date: string | null;
  /** Active route leg. Null for a legacy single-workshop allocation. */
  leg_id: string | null;
  leg_seq: number | null;
  leg_stage_from: string | null;
  leg_stage_to: string | null;
  leg_due_at: string | null;
  leg_total: number;
  /** Where the goods go after this leg — rendered as "→ Sharma Furniture". */
  next_workshop_name: string | null;
}

export interface TransferSummary {
  id: string;
  transfer_no: string;
  from_workshop_id: string;
  to_workshop_id: string;
  from_workshop_name: string;
  to_workshop_name: string;
  from_workshop_address: string | null;
  from_workshop_phone: string | null;
  to_workshop_address: string | null;
  to_workshop_phone: string | null;
  reason: string;
  status: "ready" | "picked_up" | "in_transit" | "delivered" | "received" | "cancelled";
  courier_salesperson_id: string | null;
  courier_name: string | null;
  vehicle_no: string | null;
  expected_pickup_at: string | null;
  due_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  notes: string | null;
  item_count?: number;
  items?: TransferLine[];
}

export interface TransferLine {
  id: string;
  order_item_id: string;
  route_leg_id: string | null;
  qty: number | null;
  open: boolean;
  description: string;
  unit: string | null;
  dimensions: string | null;
  material: string | null;
  spec_notes: string | null;
  current_stage: string | null;
  order_no: string;
  customer_name: string;
  thumb_key: string | null;
}

export interface RouteLeg {
  id: string;
  order_item_id: string;
  seq: number;
  workshop_id: string;
  workshop_name: string;
  workshop_type: string;
  workshop_address: string | null;
  stage_from: string;
  stage_to: string;
  planned_days: number | null;
  due_at: string | null;
  status: "pending" | "in_transit" | "active" | "completed" | "cancelled";
  activated_at: string | null;
  completed_at: string | null;
}

export interface RouteTemplateLeg {
  id: string;
  seq: number;
  workshop_id: string;
  workshop_name: string;
  stage_from: string;
  stage_to: string;
  planned_days: number;
}

export interface RouteTemplate {
  id: string;
  name: string;
  notes: string | null;
  active: boolean;
  legs: RouteTemplateLeg[];
}

export interface MyQueueResponse {
  workshops: WorkshopMembership[];
  items: QueueItem[];
  stages: StageDef[];
  incoming_transfers: TransferSummary[];
}
