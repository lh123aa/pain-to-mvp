import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PgOrderStore,
  closeSharedPgPool,
  getSharedPgPool,
  type PgQueryResult,
} from "@/lib/order-store-pg";
import {
  getOrderStore,
  getOrderStoreKind,
  resetOrderStore,
  type OrderRecord,
} from "@/lib/orders";

/**
 * PgOrderStore 单测（W5-2）
 *
 * 不连真库：所有 SQL 都打到注入的 fake query 上。
 * 覆盖：
 * - row ↔ OrderRecord 映射（snake_case / Date timestamptz / jsonb / clientRef / 时间）
 * - upsert：INSERT ... ON CONFLICT 新建、条件 UPDATE 合并、幂等无写入、deleted 只读
 * - 状态机：refund 只在 completed 上生效（条件 UPDATE），refunded 幂等 / deleted 拒绝；
 *   delete 脱敏 + 幂等；SQL 参数与守卫逐条断言
 * - findByClientRef / list / clear
 * - 存储选择：DATABASE_URL → "postgres"（懒代理，不触发连接）；优先于 ORDERS_DATA_DIR
 * - 共享连接池单例
 */

const ORIGINAL_ENV: Record<string, string | undefined> = {
  DATABASE_URL: process.env.DATABASE_URL,
  ORDERS_DATA_DIR: process.env.ORDERS_DATA_DIR,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function emptyResult(): PgQueryResult {
  return { rows: [], rowCount: 0 };
}

function createQuery(queue: PgQueryResult[] = []) {
  return vi.fn(async (text: string, values?: unknown[]) => {
    void text;
    void values;
    if (queue.length > 0) return queue.shift() as PgQueryResult;
    return emptyResult();
  });
}

/** 取第 N 次查询的 SQL 与参数（断言 SQL 形状 / 绑定值） */
function callAt(
  query: ReturnType<typeof createQuery>,
  index: number
): { text: string; values: unknown[] } {
  const call = query.mock.calls[index];
  return {
    text: String(call?.[0] ?? ""),
    values: (call?.[1] as unknown[] | undefined) ?? [],
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "ord_1001",
    variant_id: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", speakerA: "Alex" },
    client_ref: "tell_ref1",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:05.000Z"),
    completed_at: new Date("2026-01-01T00:00:05.000Z"),
    last_event_name: "order_created",
    test_mode: false,
    refunded_at: null,
    deleted_at: null,
    ...overrides,
  };
}

function orderRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", speakerA: "Alex" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:05.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    lastEventName: "order_created",
    testMode: false,
    clientRef: "tell_ref1",
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ORDERS_DATA_DIR;
  resetOrderStore();
});

afterEach(async () => {
  resetOrderStore();
  restoreEnv();
  await closeSharedPgPool();
});

describe("PgOrderStore — 构造与基础读取", () => {
  it("没有 connectionString / query / pool 时抛错", () => {
    expect(() => new PgOrderStore({})).toThrow(/connectionString/);
  });

  it("get：snake_case row → OrderRecord（Date→ISO、jsonb、clientRef）", async () => {
    const query = createQuery([{ rows: [row()], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const order = await store.get("ord_1001");

    expect(order).toEqual(orderRecord());
    const { text, values } = callAt(query, 0);
    expect(text).toContain("FROM orders WHERE order_id = $1");
    expect(values).toEqual(["ord_1001"]);
  });

  it("get 未命中 → null", async () => {
    const store = new PgOrderStore({ query: createQuery() });
    expect(await store.get("ord_missing")).toBeNull();
  });

  it("refunded_at / deleted_at / client_ref 可选字段正确", async () => {
    const store = new PgOrderStore({
      query: createQuery([
        {
          rows: [
            row({
              status: "refunded",
              client_ref: null,
              refunded_at: new Date("2026-02-01T00:00:00.000Z"),
              deleted_at: new Date("2026-03-01T00:00:00.000Z"),
            }),
          ],
          rowCount: 1,
        },
      ]),
    });

    const order = await store.get("ord_1001");
    expect(order?.status).toBe("refunded");
    expect(order?.refundedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(order?.deletedAt).toBe("2026-03-01T00:00:00.000Z");
    expect("clientRef" in (order as object)).toBe(false);
  });

  it("findByClientRef：走 client_ref 索引；空 ref 不发查询", async () => {
    const query = createQuery([{ rows: [row()], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    expect((await store.findByClientRef("tell_ref1"))?.orderId).toBe("ord_1001");
    const { text, values } = callAt(query, 0);
    expect(text).toContain("WHERE client_ref = $1");
    expect(values).toEqual(["tell_ref1"]);

    expect(await store.findByClientRef("  ")).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("list / clear", async () => {
    const query = createQuery([
      { rows: [row(), row({ order_id: "ord_2" })], rowCount: 2 },
      { rows: [], rowCount: 2 },
    ]);
    const store = new PgOrderStore({ query });

    const orders = await store.list();
    expect(orders.map((order) => order.orderId)).toEqual(["ord_1001", "ord_2"]);
    expect(callAt(query, 0).text).toContain("ORDER BY created_at ASC");

    await store.clear();
    expect(callAt(query, 1).text).toContain("DELETE FROM orders");
  });

  it("注入 pool 对象也可用", async () => {
    const query = createQuery([{ rows: [row()], rowCount: 1 }]);
    const store = new PgOrderStore({ pool: { query } });
    expect(await store.get("ord_1001")).not.toBeNull();
  });
});

describe("PgOrderStore — upsert 语义", () => {
  it("新建：SELECT 空 → INSERT ON CONFLICT DO NOTHING，created/changed=true", async () => {
    const query = createQuery([emptyResult(), { rows: [row()], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const result = await store.upsert(orderRecord());

    expect(result).toMatchObject({ created: true, changed: true });
    expect(result.order.orderId).toBe("ord_1001");
    expect(query.mock.calls).toHaveLength(2);

    const insertText = callAt(query, 1).text;
    const insertValues = callAt(query, 1).values;
    expect(insertText).toContain("INSERT INTO orders");
    expect(insertText).toContain("ON CONFLICT (order_id) DO NOTHING");
    expect(insertValues[0]).toBe("ord_1001");
    expect(insertValues[1]).toBe("456");
    expect(insertValues[2]).toBe("buyer@example.com");
    expect(insertValues[3]).toBe("completed");
    expect(insertValues[4]).toBe(
      JSON.stringify({ fileName: "chat.txt", speakerA: "Alex" })
    );
    expect(insertValues[5]).toBe("tell_ref1");
    expect(insertValues[6]).toBe("2026-01-01T00:00:00.000Z");
    expect(insertValues[8]).toBe("2026-01-01T00:00:05.000Z");
    expect(insertValues[10]).toBe(false);
  });

  it("更新：SELECT 现有 → UPDATE（带 status <> 'deleted' 守卫）", async () => {
    const updatedRow = row({
      email: "new@example.com",
      custom: { fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" },
      updated_at: new Date("2026-01-02T00:00:00.000Z"),
    });
    const query = createQuery([
      { rows: [row()], rowCount: 1 },
      { rows: [updatedRow], rowCount: 1 },
    ]);
    const store = new PgOrderStore({ query });

    const result = await store.upsert(
      orderRecord({
        email: "new@example.com",
        custom: { fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" },
        updatedAt: "2026-01-02T00:00:00.000Z",
      })
    );

    expect(result).toMatchObject({ created: false, changed: true });
    const updateText = callAt(query, 1).text;
    const updateValues = callAt(query, 1).values;
    expect(updateText).toContain("UPDATE orders SET");
    expect(updateText).toContain("WHERE order_id = $1 AND status <> 'deleted'");
    expect(updateValues[0]).toBe("ord_1001");
    expect(updateValues[2]).toBe("new@example.com");
    expect(updateValues[3]).toBe("completed");
    expect(updateValues[6]).toBe("2026-01-02T00:00:00.000Z");
  });

  it("幂等：内容未变化时只读一次，不写库（LS webhook 重试）", async () => {
    const query = createQuery([{ rows: [row()], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const result = await store.upsert(orderRecord());

    expect(result).toMatchObject({ created: false, changed: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("deleted 绝对终态：webhook 重放不能写回状态/PII", async () => {
    const deletedRow = row({
      status: "deleted",
      email: "",
      variant_id: "",
      custom: {},
      deleted_at: new Date("2026-03-01T00:00:00.000Z"),
    });
    const query = createQuery([{ rows: [deletedRow], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const result = await store.upsert(orderRecord());

    expect(result.changed).toBe(false);
    expect(result.order.status).toBe("deleted");
    expect(result.order.email).toBe("");
    expect(query).toHaveBeenCalledTimes(1); // 只 SELECT，未发起 UPDATE
  });

  it("INSERT 并发冲突（DO NOTHING 返回 0 行）→ 重读后走 UPDATE 路径", async () => {
    const query = createQuery([
      emptyResult(), // 第一次 SELECT：不存在
      emptyResult(), // INSERT ... DO NOTHING：被并发抢占
      { rows: [row({ email: "racer@example.com" })], rowCount: 1 }, // 重读
      { rows: [row({ email: "buyer@example.com" })], rowCount: 1 }, // UPDATE
    ]);
    const store = new PgOrderStore({ query });

    const result = await store.upsert(orderRecord());

    expect(result.created).toBe(false);
    expect(result.changed).toBe(true);
    expect(query.mock.calls).toHaveLength(4);
    expect(callAt(query, 3).text).toContain("UPDATE orders SET");
  });
});

describe("PgOrderStore — 状态机（条件更新）", () => {
  it("refund：UPDATE ... WHERE status='completed' 才生效", async () => {
    const refundedRow = row({
      status: "refunded",
      refunded_at: new Date("2026-02-01T00:00:00.000Z"),
      updated_at: new Date("2026-02-01T00:00:00.000Z"),
    });
    const query = createQuery([{ rows: [refundedRow], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const result = await store.refundOrder("ord_1001", "2026-02-01T00:00:00.000Z");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.order.status).toBe("refunded");
    expect(result.order.refundedAt).toBe("2026-02-01T00:00:00.000Z");

    const { text, values } = callAt(query, 0);
    expect(text).toContain("status = 'refunded'");
    expect(text).toContain("WHERE order_id = $1 AND status = 'completed'");
    expect(values).toEqual(["ord_1001", "2026-02-01T00:00:00.000Z"]);
  });

  it("refund：未找到 → not-found；已退款 → 幂等 ok；已删除 → invalid-transition", async () => {
    const notFound = createQuery([emptyResult(), emptyResult()]);
    expect(
      await new PgOrderStore({ query: notFound }).refundOrder("ord_missing")
    ).toEqual({ ok: false, reason: "not-found" });

    const already = createQuery([
      emptyResult(),
      {
        rows: [row({ status: "refunded", refunded_at: new Date("2026-02-01T00:00:00.000Z") })],
        rowCount: 1,
      },
    ]);
    expect(
      await new PgOrderStore({ query: already }).refundOrder("ord_1001")
    ).toMatchObject({ ok: true, changed: false });

    const deleted = createQuery([
      emptyResult(),
      { rows: [row({ status: "deleted" })], rowCount: 1 },
    ]);
    expect(
      await new PgOrderStore({ query: deleted }).refundOrder("ord_1001")
    ).toEqual({ ok: false, reason: "invalid-transition" });
  });

  it("deleteOrderAnalysis：条件更新 + 脱敏（email/variant/custom 清空）", async () => {
    const deletedRow = row({
      status: "deleted",
      email: "",
      variant_id: "",
      custom: {},
      deleted_at: new Date("2026-03-01T00:00:00.000Z"),
      updated_at: new Date("2026-03-01T00:00:00.000Z"),
    });
    const query = createQuery([{ rows: [deletedRow], rowCount: 1 }]);
    const store = new PgOrderStore({ query });

    const result = await store.deleteOrderAnalysis(
      "ord_1001",
      "2026-03-01T00:00:00.000Z"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.order.status).toBe("deleted");
    expect(result.order.email).toBe("");
    expect(result.order.custom).toEqual({});

    const { text, values } = callAt(query, 0);
    expect(text).toContain("status = 'deleted'");
    expect(text).toContain("custom = '{}'::jsonb");
    expect(text).toContain("WHERE order_id = $1 AND status <> 'deleted'");
    expect(values).toEqual(["ord_1001", "2026-03-01T00:00:00.000Z"]);
  });

  it("deleteOrderAnalysis：未找到 / 已删除幂等", async () => {
    const notFound = createQuery([emptyResult(), emptyResult()]);
    expect(
      await new PgOrderStore({ query: notFound }).deleteOrderAnalysis("ord_missing")
    ).toEqual({ ok: false, reason: "not-found" });

    const already = createQuery([
      emptyResult(),
      { rows: [row({ status: "deleted" })], rowCount: 1 },
    ]);
    expect(
      await new PgOrderStore({ query: already }).deleteOrderAnalysis("ord_1001")
    ).toMatchObject({ ok: true, changed: false });
  });
});

describe("PgOrderStore — 存储选择与连接池", () => {
  it("DATABASE_URL → getOrderStoreKind()==='postgres'，且优先于 ORDERS_DATA_DIR", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/tell";
    process.env.ORDERS_DATA_DIR = "C:/tmp/should-not-be-used";
    resetOrderStore();

    expect(getOrderStoreKind()).toBe("postgres");
    // 懒代理：构造不加载 pg、不建连接；只断言类型
    expect(getOrderStore()).toBeTruthy();
  });

  it("无 DATABASE_URL 时行为不变（memory）", () => {
    delete process.env.DATABASE_URL;
    resetOrderStore();
    expect(getOrderStoreKind()).toBe("memory");
  });

  it("共享连接池按 connectionString 单例复用", async () => {
    const first = getSharedPgPool("postgres://user:pass@localhost:5432/tell");
    const second = getSharedPgPool("postgres://user:pass@localhost:5432/tell");
    expect(second).toBe(first);
    await expect(closeSharedPgPool()).resolves.toBeUndefined();
  });
});
