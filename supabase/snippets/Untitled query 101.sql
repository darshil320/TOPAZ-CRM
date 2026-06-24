INSERT INTO face_embeddings (customer_id, embedding, quality_score, consent_id)
SELECT
  '91423d9d-e629-4f6e-984e-0862b3ec520e',
  array_fill(0.1, ARRAY[512])::vector,
  0.95,
  '945d91ed-265e-4760-a349-c6589a4d7436';