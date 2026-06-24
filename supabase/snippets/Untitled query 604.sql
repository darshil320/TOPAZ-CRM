-- consent (all three boxes ticked, kiosk method)
INSERT INTO consents (id, face_tracking, personal_data, whatsapp_marketing, method)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  true, true, true,
  'kiosk'
);

-- customer (wa_id = phone without the +)
INSERT INTO customers (
  id, consent_id, name, phone, wa_id,
  primary_interest, ai_followup_enabled, ai_autosend, handler_mode
)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Priya Mehta',
  '+919876543210',
  '919876543210',
  'Modular kitchen',
  true, false, 'ai'
);