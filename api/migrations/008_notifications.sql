-- In-app notifications from a shop to its connected Site Experts (push + inbox),
-- with per-notification insights: sent, delivered, opened, clicked (and bought, from bills).

CREATE TABLE device_tokens (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT   NOT NULL UNIQUE,
  platform     TEXT   NOT NULL CHECK (platform IN ('android','ios','web')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user ON device_tokens (user_id);

CREATE TABLE notifications (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id          BIGINT NOT NULL REFERENCES shops(id),
  created_by       BIGINT NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 60),
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 2 AND 240),
  image_url        TEXT,
  action_type      TEXT NOT NULL DEFAULT 'none' CHECK (action_type IN ('none','shop','offer','product','call')),
  action_ref       TEXT,                       -- product id for 'product'
  action_label     TEXT,                       -- button text, e.g. "View offer"
  filters          JSONB NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','cancelled')),
  scheduled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_shop_recent ON notifications (shop_id, created_at DESC);
CREATE INDEX notifications_due ON notifications (scheduled_at) WHERE status = 'scheduled';

-- One row per person it was sent to. title/body are stored filled in ({name}, {points}).
CREATE TABLE notification_recipients (
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  customer_id     BIGINT NOT NULL REFERENCES customers(user_id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  pushed_at       TIMESTAMPTZ,       -- accepted by the push service
  delivered_at    TIMESTAMPTZ,       -- reached the phone (app received it or loaded its inbox)
  opened_at       TIMESTAMPTZ,       -- opened it (tapped the push or the inbox card)
  clicked_at      TIMESTAMPTZ,       -- tapped the button
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, customer_id)
);
-- Inbox: newest first for one person.
CREATE INDEX notification_recipients_inbox ON notification_recipients (customer_id, created_at DESC);
