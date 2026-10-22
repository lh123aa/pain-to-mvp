#!/usr/bin/env node
/**
 * 数据库迁移脚本（W5-2）
 * ======================
 * 读取 src/lib/sql/schema.sql 并在 DATABASE_URL 指向的 Postgres 上执行。
 * schema 全部 IF NOT EXISTS，可重复执行。
 *
 * 用法：
 *   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate.mjs
 *
 * 也可以用 package.json 里的快捷命令：
 *   DATABASE_URL=... pnpm db:migrate
 *
 * 没有 DATABASE_URL 时只打印用法并以 0 退出（CI / 本地无 DB 不会失败）。
 */

import console from "node:console";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  console.log("DATABASE_URL 未设置，跳过迁移。");
  console.log(
    "用法：DATABASE_URL=postgres://user:pass@host:5432/db node scripts/migrate.mjs"
  );
  process.exit(0);
}

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "sql",
  "schema.sql"
);

const { Pool } = await import("pg");
const sql = await readFile(schemaPath, "utf8");
const pool = new Pool({ connectionString, max: 1 });

try {
  await pool.query(sql);
  console.log(`✓ migration ok: ${schemaPath}`);
} catch (error) {
  console.error(
    "✗ migration failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
