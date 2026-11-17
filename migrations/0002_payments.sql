-- Payments: remember which Stripe events were already handled, so a repeated event never adds songs twice.
CREATE TABLE IF NOT EXISTS stripe_events (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
