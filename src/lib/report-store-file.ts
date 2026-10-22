/**
 * FileReportStore —— 基于 JSON 文件的 ReportStore 实现（W3-2）
 * ===========================================================
 * 与 order-store-file.ts 同一套模式：
 * - 默认 `<dir>/reports.json`；构造时同步 load；文件不存在 = 空库；
 * - 原子写（`.tmp` → rename），失败时内存不脏；
 * - 所有操作进进程内 Promise 串行队列；
 * - 损坏 JSON / 结构非法 → 重命名备份 `<file>.corrupt-<ts>` + 空库继续（不抛）；
 * - 不可恢复 IO 错误 → `FileReportStoreError`；
 * - 过期（90 天）记录读取时惰性删除。
 *
 * ⚠️ 单实例 / staging 用；serverless 生产必须换 Postgres 的 ReportStore 实现。
 */

import { promises as fsp, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { ReportDataV2 } from "./report-contract";
import type { ReportStore, StoredReport } from "./report-store";
import {
  buildStoredReport,
  isStoredReportExpired,
  validateReportPayload,
} from "./report-store";

export const DEFAULT_REPORTS_FILE_NAME = "reports.json";
const FILE_VERSION = 1;

export type FileReportStoreOptions = {
  /** 文件名，默认 reports.json */
  fileName?: string;
  /** 时钟注入（测试过期用），默认 new Date() */
  now?: () => Date;
};

/** FileReportStore 不可恢复错误；可恢复的损坏文件不抛 */
export class FileReportStoreError extends Error {
  readonly code: string;

  constructor(
    message: string,
    options: { code?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FileReportStoreError";
    this.code = options.code ?? "FILE_REPORT_STORE_ERROR";
  }
}

class ReportsFileCorruptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ReportsFileCorruptError";
  }
}

export class FileReportStore implements ReportStore {
  readonly dir: string;
  readonly filePath: string;

  private readonly tmpFilePath: string;
  private readonly clock: () => Date;
  private reports = new Map<string, StoredReport>();
  private queue: Promise<void> = Promise.resolve();

  constructor(dir: string, options: FileReportStoreOptions = {}) {
    const normalizedDir = dir.trim();
    if (!normalizedDir) {
      throw new FileReportStoreError("FileReportStore 需要非空目录");
    }
    this.dir = path.resolve(normalizedDir);
    // 同 order-store-file：文件存储只用于本地/单实例 staging，显式跳过打包追踪。
    this.filePath = path.join(
      /*turbopackIgnore: true*/ this.dir,
      options.fileName ?? DEFAULT_REPORTS_FILE_NAME
    );
    this.tmpFilePath = `${this.filePath}.tmp`;
    this.clock = options.now ?? (() => new Date());
    this.loadSync();
  }

  async get(orderId: string): Promise<StoredReport | null> {
    return this.enqueue(async () => {
      const stored = this.reports.get(orderId);
      if (!stored) return null;
      if (!isStoredReportExpired(stored, this.clock())) return stored;

      const next = new Map(this.reports);
      next.delete(orderId);
      await this.commit(next);
      return null;
    });
  }

  async save(
    orderId: string,
    report: ReportDataV2,
    options: { now?: Date | number } = {}
  ): Promise<StoredReport> {
    return this.enqueue(async () => {
      const now =
        options.now instanceof Date
          ? options.now
          : typeof options.now === "number"
            ? new Date(options.now)
            : this.clock();
      const existing = this.reports.get(orderId) ?? null;
      const stored = buildStoredReport(orderId, report, now, existing);
      const next = new Map(this.reports);
      next.set(orderId, stored);
      await this.commit(next);
      return stored;
    });
  }

  async deleteReport(orderId: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.reports.has(orderId)) return false;
      const next = new Map(this.reports);
      next.delete(orderId);
      await this.commit(next);
      return true;
    });
  }

  async list(): Promise<StoredReport[]> {
    return this.enqueue(async () => {
      const now = this.clock();
      return [...this.reports.values()].filter(
        (stored) => !isStoredReportExpired(stored, now)
      );
    });
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.commit(new Map());
    });
  }

  /* ===== 内部：队列 / 加载 / 原子写 ===== */

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private loadSync(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      if (isErrnoCode(err, "ENOENT")) {
        this.reports = new Map();
        return;
      }
      throw new FileReportStoreError(`无法读取报告文件：${this.filePath}`, {
        code: "READ_FAILED",
        cause: err,
      });
    }

    try {
      this.reports = parseReportsFile(raw);
    } catch (err) {
      const backupPath = this.backupCorruptFile();
      console.warn(
        `[report-store-file] 报告文件损坏，已备份为 ${
          backupPath ?? "(备份失败)"
        }，以空库继续：${this.filePath}`,
        err instanceof Error ? err.message : err
      );
      this.reports = new Map();
    }
  }

  private backupCorruptFile(): string | null {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.filePath}.corrupt-${stamp}`;
    try {
      renameSync(this.filePath, backupPath);
      return backupPath;
    } catch (err) {
      console.warn(
        `[report-store-file] 备份损坏文件失败：${this.filePath}`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  private async commit(next: Map<string, StoredReport>): Promise<void> {
    await this.persist(next);
    this.reports = next;
  }

  private async persist(next: Map<string, StoredReport>): Promise<void> {
    const payload = serializeReports(next);
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await fsp.writeFile(this.tmpFilePath, payload, "utf8");
      await fsp.rename(this.tmpFilePath, this.filePath);
    } catch (err) {
      throw new FileReportStoreError(`无法写入报告文件：${this.filePath}`, {
        code: "WRITE_FAILED",
        cause: err,
      });
    }
  }
}

/** 工厂：`createFileReportStore(process.env.REPORT_DATA_DIR)` */
export function createFileReportStore(
  dir: string,
  options: FileReportStoreOptions = {}
): FileReportStore {
  return new FileReportStore(dir, options);
}

/* ===== 序列化 / 反序列化 ===== */

type ReportsFilePayload = {
  version: number;
  updatedAt: string;
  reports: Record<string, StoredReport>;
};

function serializeReports(reports: Map<string, StoredReport>): string {
  const sorted: Record<string, StoredReport> = {};
  for (const orderId of [...reports.keys()].sort()) {
    const record = reports.get(orderId);
    if (record) sorted[orderId] = record;
  }
  const payload: ReportsFilePayload = {
    version: FILE_VERSION,
    updatedAt: new Date().toISOString(),
    reports: sorted,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function parseReportsFile(raw: string): Map<string, StoredReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ReportsFileCorruptError("JSON 解析失败", { cause: err });
  }

  const entries: unknown[] = [];
  if (Array.isArray(parsed)) {
    entries.push(...parsed);
  } else if (isRecord(parsed) && Array.isArray(parsed.reports)) {
    entries.push(...parsed.reports);
  } else if (isRecord(parsed) && isRecord(parsed.reports)) {
    for (const [orderId, record] of Object.entries(parsed.reports)) {
      entries.push(isRecord(record) ? { ...record, orderId } : record);
    }
  } else {
    throw new ReportsFileCorruptError("文件结构不是报告对象/数组");
  }

  const reports = new Map<string, StoredReport>();
  for (const entry of entries) {
    const record = normalizeStoredReport(entry);
    if (!record) {
      throw new ReportsFileCorruptError("报告记录结构非法");
    }
    reports.set(record.orderId, record);
  }
  return reports;
}

function normalizeStoredReport(raw: unknown): StoredReport | null {
  if (!isRecord(raw)) return null;

  const orderId = readString(raw.orderId);
  if (!orderId) return null;

  const validation = validateReportPayload(raw.report);
  if (!validation.ok) return null;

  const createdAt = readString(raw.createdAt);
  const savedAt = readString(raw.savedAt);
  const expiresAt = readString(raw.expiresAt);
  if (!createdAt || !savedAt || !expiresAt) return null;

  return {
    orderId,
    report: validation.report,
    createdAt,
    savedAt,
    expiresAt,
  };
}

/* ===== 小工具 ===== */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === code
  );
}
