-- get your salesperson id
SELECT id FROM salespersons WHERE name = 'Darshil';

-- replace YOUR-SP-ID below
INSERT INTO customer_assignments (customer_id, salesperson_id, role, active)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  '44746d85-473d-4d35-aceb-8b224d1ede6a',
  'primary',
  true
);

INSERT INTO pipeline_stages (customer_id, stage)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'talking'
);