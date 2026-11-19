-- Self-service account deletion (DPDP Act / Play Store). Rows stay for shop accounting; personal details are removed.
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
