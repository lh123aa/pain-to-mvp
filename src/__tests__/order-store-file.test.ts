import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ORDERS_FILE_NAME,
  FileOrderStoreError,
  createFileOrderStore,
} from "@/lib/order-store-file";
import {
  InMemoryOrderStore,
  getOrderStore,
  getOrderStoreKind,
  resetOrderStore,
  setOrderStore,
  type OrderRecord,
} from "@/lib/orders";

/**
 * FileOrderStore 单测（W3-3）
 *
 * 覆盖：
 * - 跨实例持久化（写 → 新实例读）、文件不存在=空库、clear 落盘
 * - upsert 幂等；refunded/deleted 终态跨实例不回退（含 deleted 后 webhook 重放不写回 PII）
 * - 并发 20 个 upsert 不丢数据（进程内串行队列 + 原子写）
 * - 损坏文件：备份 `.corrupt-<ts>` + 空库继续（不抛）；结构损坏同样
 * - 不可恢复 IO 错误：FileOrderStoreError（读路径不可用 / 写失败）
 * - orders.ts 存储选择：无 ORDERS_DATA_DIR → memory（CI 默认）；有 → file；setOrderStore → injected
 *
 * 全部用 os.tmpdir() 下的临时目录，afterEach 清理；不触碰仓库文件。
 */

const ORIGINAL_DATA_DIR = process.env.ORDERS_DATA_DIR;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "tell-orders-"));
  delete process.env.ORDERS_DATA_DIR;
  resetOrderStore();
});

afterEach(async () => {
  resetOrderStore();
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.ORDERS_DATA_DIR;
  else process.env.ORDERS_DATA_DIR = ORIGINAL_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

function baseRecord(overrides: Partial<OrderRecord> = {}): OrderRecord {
  // 固定时间戳：便于测试「重复 upsert 幂等」（真实 webhook 的 updatedAt 会变化）
  return {
    orderId: "ord_1001",
    variantId: "456",
    email: "buyer@example.com",
    status: "completed",
    custom: { fileName: "chat.txt", speakerA: "Alex", speakerB: "Sam" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    lastEventName: "order_created",
    testMode: false,
    ...overrides,
  };
}

function ordersFilePath(): string {
  return path.join(dir, DEFAULT_ORDERS_FILE_NAME);
}

describe("FileOrderStore — 基础持久化", () => {
  it("目录/文件不存在 = 空库；首次 upsert 自动建目录并落盘", async () => {
    const nestedDir = path.join(dir, "nested", "data");
    const store = createFileOrderStore(nestedDir);
    expect(await store.list()).toEqual([]);

    const result = await store.upsert(baseRecord());
    expect(result.created).toBe(true);

    const raw = await readFile(
      path.join(nestedDir, DEFAULT_ORDERS_FILE_NAME),
      "utf8"
    );
    const parsed = JSON.parse(raw) as {
      version: number;
      orders: Record<string, OrderRecord>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.orders.ord_1001?.email).toBe("buyer@example.com");
  });

  it("跨实例持久化：写 → 新实例读（模拟进程重启）", async () => {
    const writer = createFileOrderStore(dir);
    await writer.upsert(baseRecord());

    const reader = createFileOrderStore(dir);
    const loaded = await reader.get("ord_1001");
    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe("completed");
    expect(loaded?.custom).toEqual({
      fileName: "chat.txt",
      speakerA: "Alex",
      speakerB: "Sam",
    });
    expect(await reader.list()).toHaveLength(1);
  });

  it("upsert 幂等：重复写同一订单不产生重复记录 / changed=false", async () => {
    const store = createFileOrderStore(dir);
    const first = await store.upsert(baseRecord());
    const second = await store.upsert(baseRecord());

    expect(first).toMatchObject({ created: true, changed: true });
    expect(second).toMatchObject({ created: false, changed: false });
    expect(await store.list()).toHaveLength(1);

    const parsed = JSON.parse(
      await readFile(ordersFilePath(), "utf8")
    ) as { orders: Record<string, OrderRecord> };
    expect(Object.keys(parsed.orders)).toHaveLength(1);
  });

  it("clear 落盘为空库（新实例同样为空）", async () => {
    const store = createFileOrderStore(dir);
    await store.upsert(baseRecord());
    await store.clear();

    expect(await store.list()).toEqual([]);
    expect(await createFileOrderStore(dir).list()).toEqual([]);
  });
});

describe("FileOrderStore — 状态机持久化（终态不回退）", () => {
  it("completed → refunded → deleted 跨实例保持；重复调用幂等", async () => {
    const store = createFileOrderStore(dir);
    await store.upsert(baseRecord());

    const refunded = await store.refundOrder(
      "ord_1001",
      "2026-02-01T00:00:00.000Z"
    );
    expect(refunded.ok).toBe(true);
    if (refunded.ok) {
      expect(refunded.order.status).toBe("refunded");
      expect(refunded.order.refundedAt).toBe("2026-02-01T00:00:00.000Z");
    }

    const reloadedAfterRefund = createFileOrderStore(dir);
    const refundedRecord = await reloadedAfterRefund.get("ord_1001");
    expect(refundedRecord?.status).toBe("refunded");
    expect(refundedRecord?.refundedAt).toBe("2026-02-01T00:00:00.000Z");

    const duplicateRefund = await reloadedAfterRefund.refundOrder("ord_1001");
    expect(duplicateRefund).toMatchObject({ ok: true, changed: false });

    const deleted = await reloadedAfterRefund.deleteOrderAnalysis(
      "ord_1001",
      "2026-03-01T00:00:00.000Z"
    );
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.order.status).toBe("deleted");
      expect(deleted.order.email).toBe("");
      expect(deleted.order.variantId).toBe("");
      expect(deleted.order.custom).toEqual({});
      expect(deleted.order.deletedAt).toBe("2026-03-01T00:00:00.000Z");
    }

    const reloadedAfterDelete = createFileOrderStore(dir);
    const deletedRecord = await reloadedAfterDelete.get("ord_1001");
    expect(deletedRecord?.status).toBe("deleted");
    expect(deletedRecord?.email).toBe("");
    expect(deletedRecord?.custom).toEqual({});
    expect(await reloadedAfterDelete.refundOrder("ord_1001")).toEqual({
      ok: false,
      reason: "invalid-transition",
    });
  });

  it("deleted 后 webhook 重放（upsert completed）写不回 PII / 状态", async () => {
    const store = createFileOrderStore(dir);
    const original = baseRecord();
    await store.upsert(original);
    await store.deleteOrderAnalysis("ord_1001");

    const replayed = await store.upsert(original);
    expect(replayed).toMatchObject({ created: false, changed: false });
    expect(replayed.order.status).toBe("deleted");
    expect(replayed.order.email).toBe("");
    expect(replayed.order.custom).toEqual({});

    // 落盘文件也必须是删除后的状态
    const reloaded = await createFileOrderStore(dir).get("ord_1001");
    expect(reloaded?.status).toBe("deleted");
    expect(reloaded?.email).toBe("");
  });

  it("refunded 终态不被迟到的 completed 事件回退", async () => {
    const store = createFileOrderStore(dir);
    await store.upsert(baseRecord());
    await store.refundOrder("ord_1001");

    const replay = await store.upsert(baseRecord());
    expect(replay.order.status).toBe("refunded");
    expect((await createFileOrderStore(dir).get("ord_1001"))?.status).toBe(
      "refunded"
    );
  });

  it("未知订单：refundOrder / deleteOrderAnalysis → not-found，不写文件", async () => {
    const store = createFileOrderStore(dir);
    expect(await store.refundOrder("ord_missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await store.deleteOrderAnalysis("ord_missing")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("FileOrderStore — 并发", () => {
  it("Promise.all 20 个不同订单 upsert：无丢失、新实例可读全量", async () => {
    const store = createFileOrderStore(dir);
    const ids = Array.from({ length: 20 }, (_, index) => `ord_${index}`);

    const results = await Promise.all(
      ids.map((orderId) => store.upsert(baseRecord({ orderId })))
    );

    expect(results.every((result) => result.created)).toBe(true);
    expect(await store.list()).toHaveLength(20);

    const parsed = JSON.parse(
      await readFile(ordersFilePath(), "utf8")
    ) as { orders: Record<string, OrderRecord> };
    expect(Object.keys(parsed.orders)).toHaveLength(20);

    const fresh = createFileOrderStore(dir);
    const loaded = await fresh.list();
    expect(loaded).toHaveLength(20);
    expect(new Set(loaded.map((order) => order.orderId)).size).toBe(20);
  });
});

describe("FileOrderStore — 损坏恢复", () => {
  it("非法 JSON：备份为 .corrupt-<ts>，空库继续且之后可正常写入", async () => {
    await writeFile(ordersFilePath(), "{ this is not json", "utf8");

    // 构造不抛错
    const store = createFileOrderStore(dir);
    expect(await store.list()).toEqual([]);

    const files = await readdir(dir);
    const backup = files.find((name) =>
      name.startsWith(`${DEFAULT_ORDERS_FILE_NAME}.corrupt-`)
    );
    expect(backup).toBeTruthy();

    await store.upsert(baseRecord({ orderId: "ord_after_recovery" }));
    expect(await createFileOrderStore(dir).list()).toHaveLength(1);
  });

  it("JSON 合法但结构不对（orders 不是对象/数组）：同样备份 + 空库", async () => {
    await writeFile(
      ordersFilePath(),
      JSON.stringify({ version: 1, orders: "nope" }),
      "utf8"
    );

    const store = createFileOrderStore(dir);
    expect(await store.list()).toEqual([]);
    const files = await readdir(dir);
    expect(
      files.some((name) =>
        name.startsWith(`${DEFAULT_ORDERS_FILE_NAME}.corrupt-`)
      )
    ).toBe(true);
  });
});

describe("FileOrderStore — 不可恢复错误", () => {
  it("订单文件路径是目录之类不可读情况 → 构造时抛 FileOrderStoreError（READ_FAILED）", async () => {
    // 把 orders.json 建成目录：readFileSync 抛 EISDIR/EPERM（非 ENOENT）→ 视为不可恢复
    await mkdir(ordersFilePath());

    let caught: unknown;
    try {
      createFileOrderStore(dir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FileOrderStoreError);
    expect((caught as FileOrderStoreError).name).toBe("FileOrderStoreError");
    expect((caught as FileOrderStoreError).code).toBe("READ_FAILED");
  });

  it("写失败（tmp 路径被目录占用）→ upsert 抛 FileOrderStoreError（WRITE_FAILED），内存不脏", async () => {
    const store = createFileOrderStore(dir);
    // 占住临时文件路径，让 writeFile 失败
    await mkdir(`${ordersFilePath()}.tmp`);

    await expect(store.upsert(baseRecord())).rejects.toBeInstanceOf(
      FileOrderStoreError
    );
    // 写失败不污染内存状态
    expect(await store.get("ord_1001")).toBeNull();
    expect(await store.list()).toEqual([]);
  });
});

describe("orders.ts — 存储选择", () => {
  it("无 ORDERS_DATA_DIR → memory（CI/现有测试默认行为不变）", () => {
    delete process.env.ORDERS_DATA_DIR;
    resetOrderStore();
    expect(getOrderStoreKind()).toBe("memory");
    expect(getOrderStore()).toBeInstanceOf(InMemoryOrderStore);
  });

  it("ORDERS_DATA_DIR 有值 → file，并跨 reset 持久化", async () => {
    process.env.ORDERS_DATA_DIR = dir;
    resetOrderStore();
    expect(getOrderStoreKind()).toBe("file");

    await getOrderStore().upsert(baseRecord({ orderId: "ord_file" }));

    // 模拟重启：清空单例后按 env 重新创建，仍能读到文件数据
    resetOrderStore();
    expect(getOrderStoreKind()).toBe("file");
    expect((await getOrderStore().get("ord_file"))?.email).toBe(
      "buyer@example.com"
    );
  });

  it("setOrderStore → injected；getOrderStore 返回注入实例", () => {
    const injected = new InMemoryOrderStore();
    process.env.ORDERS_DATA_DIR = dir;
    setOrderStore(injected);
    expect(getOrderStoreKind()).toBe("injected");
    expect(getOrderStore()).toBe(injected);
  });
});
