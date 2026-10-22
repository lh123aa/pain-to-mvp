-- =============================================================================
-- The Tell — Postgres schema（W5-2）
-- =============================================================================
-- 用法：
--   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate.mjs
-- 幂等：全部 IF NOT EXISTS，可重复执行。
-- =============================================================================

-- 订单（与 src/lib/orders.ts#OrderRecord 一一对应）
CREATE TABLE IF NOT EXISTS orders (
  order_id        text PRIMARY KEY,
  variant_id      text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('completed', 'refunded', 'canceled', 'pending', 'deleted')),
  custom          jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ref      text,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  completed_at    timestamptz,
  last_event_name text NOT NULL DEFAULT '',
  test_mode       boolean NOT NULL DEFAULT false,
  refunded_at     timestamptz,
  deleted_at      timestamptz
);

-- /api/order-status?ref= 与 findOrderByClientRef 用
CREATE INDEX IF NOT EXISTS orders_client_ref_idx ON orders (client_ref);
-- 运维 / 状态筛选（pending 未支付、refunded、deleted 等）
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

-- 跨设备报告（与 src/lib/report-store.ts#StoredReport 对应；FK 删除订单时级联删报告）
CREATE TABLE IF NOT EXISTS reports (
  order_id   text PRIMARY KEY REFERENCES orders (order_id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  saved_at   timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

-- 90 天 TTL 查询 / 过期清理 job 用
CREATE INDEX IF NOT EXISTS reports_expires_idx ON reports (expires_at);
