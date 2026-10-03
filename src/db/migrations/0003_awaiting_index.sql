DROP INDEX IF EXISTS sales_awaiting_idx;
CREATE INDEX sales_awaiting_idx ON sales (created_at) WHERE status = 'awaiting_payment';
