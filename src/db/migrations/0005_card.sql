-- Phase 4: card payments. A payment is Pix or card; only Pix has a QR code.
ALTER TABLE payments DROP CONSTRAINT payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('pix', 'card'));
ALTER TABLE payments ALTER COLUMN qr_payload DROP NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_pix_qr_check CHECK (method <> 'pix' OR qr_payload IS NOT NULL);
ALTER TABLE payments ADD COLUMN failure_reason text
  CHECK (failure_reason IN ('declined', 'cancelled', 'expired'));
