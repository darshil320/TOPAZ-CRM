INSERT INTO face_embeddings (customer_id, embedding, model_version, quality_score)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  array_fill(0.1, ARRAY[512])::vector,
  'buffalo_l',
  0.92
);

-- optional: add a seed message so the conversation thread isn't empty
INSERT INTO messages (customer_id, direction, content, sender_type, status)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'inbound',
  'Hi, I visited your showroom last week. Interested in the kitchen layout we discussed.',
  'customer',
  'delivered'
);