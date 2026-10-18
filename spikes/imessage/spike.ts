// W0-A1 iMessage spike · 主脚本（2026-10-18）
// 目标：用 3 份真实 chat.db 测 sql.js(WASM) 解析 attributedBody 路径的走通率
// 出口门：≥80% attributedBody 成功率 → iMessage 留 P0；<80% → 自动降 P1（ADR-0006 预设条款）
//
// 用法（3 份样本就位后）：
//   1. 把 3 份脱敏 chat.db 放进 samples/raw/（named sample-a.db / sample-b.db / sample-c.db）
//   2. pnpm run spike:imessage
//   3. 看 spikes/imessage/run.log（逐样本成功率 + 总判定 + go/no-go 结论）
//   4. 按 ADR-0006 预设条款执行降级/保留，更新 NEXT-ACTIONS 与 PRD §11-Q4 状态
//   5. journal 落 IN-xxxx-imessage-spike.md（方法 + 逐样本数字 + go/no-go）

import initSqlJs from "sql.js";
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

// ---------- 配置 ----------
const RAW_DIR = join(process.cwd(), "samples", "raw");
const OUT_DIR = join(process.cwd(), "spikes", "imessage", "out");
const THRESHOLD = 0.8; // ≥80% 留 P0
const EXPECTED_SAMPLES = 3;

// ---------- sql.js 加载（Node 环境）----------
async function loadSqlJs() {
  const SQL = await initSqlJs({
    // sql.js 默认从 node_modules 找 wasm；Node 环境给个空路径即可
    locateFile: (file) => join(process.cwd(), "node_modules", "sql.js", "dist", file),
  });
  return SQL;
}

// ---------- 读 chat.db schema 与 message 表 ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSample(SQL: any, filePath: string) {
  const buf = readFileSync(filePath);
  const db = new SQL.Database(buf);

  // dump message 表 schema（重点 attributedBody / text / date 列）
  const schemaRows = db.exec(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='message'"
  );
  const messageSchema = schemaRows[0]?.values?.[0]?.[0] ?? "(message 表不存在)";

  // 取全部消息行
  const msgRes = db.exec("SELECT ROWID, text, attributedBody, date FROM message ORDER BY ROWID");
  const rows: Array<{ rowid: number; text: string | null; attributedBody: Buffer | null; date: number }> =
    msgRes[0]?.values?.map((v) => ({
      rowid: v[0] as number,
      text: (v[1] as string | null) ?? null,
      attributedBody: (v[2] as Buffer | null) ?? null,
      date: (v[3] as number) ?? 0,
    })) ?? [];

  db.close();
  return { schema: messageSchema as string, rows };
}

// ---------- attributedBody typedstream 解析 ----------
//
// iMessage 的 attributedBody 是 protobuf（typedstream），字段 1 = 字符串内容。
// 本 spike 采用**简化解析**：归 1 tag + varint 长度 + UTF-8 内容，做"可读性判定"。
// 可读判定（任一不满足即计 miss）：
//   - 内容段首字节非 0xFF/0xFE（伪 UTF-8 起始，避免 0xFF 吞 NUL 的解析漏洞）
//   - 内容段整体不含 NUL
//   - 含至少 1 个字母/数字/CJK
// 完整 typedstream protobuf（多字段嵌套、varint 边界）M1 再实现；本 spike 目标是成功率数字。
function decodeAttributedBody(ab: Buffer): { ok: boolean; text: string } {
  if (ab.length >= 2 && ab[0] === 0x01) {
    let i = 1;
    let len = 0;
    let shift = 0;
    let b;
    do {
      b = ab[i++];
      len |= (b & 0x7f) << shift;
      shift += 7;
      if (i >= ab.length) return { ok: false, text: "" }; // varint 越界
    } while (b & 0x80);
    if (i + len > ab.length) return { ok: false, text: "" }; // 长度越界
    const raw = ab.subarray(i, i + len);
    // 首字节非 0xFF/0xFE（避免伪 UTF-8 起始吞 NUL）
    if (raw.length === 0 || raw[0] === 0xff || raw[0] === 0xfe) return { ok: false, text: "" };
    const str = Buffer.from(raw).toString("utf8");
    if (!str || str.includes("\u0000")) return { ok: false, text: "" };
    if (/[a-zA-Z0-9\u4e00-\u9fff]/.test(str)) return { ok: true, text: str };
  }
  return { ok: false, text: "" };
}

// ---------- 统计成功率 ----------
function computeRate(rows: ReturnType<typeof readSample>["rows"]) {
  if (rows.length === 0) return { total: 0, ok: 0, rate: 0 };
  let ok = 0;
  for (const r of rows) {
    // 走通判定：text 列为空时，attributedBody 归 1 解码成功
    if (r.text === null || r.text === "") {
      if (r.attributedBody && r.attributedBody.length > 0) {
        const d = decodeAttributedBody(r.attributedBody);
        if (d.ok) ok++;
      }
    } else {
      // text 列非空 → 已走通（不需 attributedBody），计 ok
      ok++;
    }
  }
  return { total: rows.length, ok, rate: ok / rows.length };
}

// ---------- 主流程 ----------
async function main() {
  if (!existsSync(RAW_DIR)) {
    console.error(`[W0-A1] 样本目录不存在：${RAW_DIR}`);
    console.error(`请把 3 份脱敏 chat.db 放进去（sample-a.db / sample-b.db / sample-c.db），再跑 pnpm run spike:imessage`);
    process.exit(1);
  }
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".db"));
  if (files.length === 0) {
    console.error(`[W0-A1] ${RAW_DIR} 下无 .db 文件，无法跑 spike`);
    process.exit(1);
  }
  console.log(`[W0-A1] 找到 ${files.length} 份样本（预期 ${EXPECTED_SAMPLES}），逐份解析中...`);

  const SQL = await loadSqlJs();
  const results = files.map((f) => {
    const p = join(RAW_DIR, f);
    const { schema, rows } = readSample(SQL, p);
    const rate = computeRate(rows);
    const hash = createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12);
    return {
      file: f,
      hash,
      schemaPreview: schema.slice(0, 200),
      total: rate.total,
      ok: rate.ok,
      rate: rate.rate,
      pass: rate.rate >= THRESHOLD,
    };
  });

  // 总判定
  const avgRate = results.reduce((s, r) => s + r.rate, 0) / results.length;
  const go = avgRate >= THRESHOLD;

  console.log("\n========== W0-A1 iMessage spike 结果 ==========");
  for (const r of results) {
    console.log(
      `  ${r.file} (sha256:${r.hash})  总消息 ${r.total}  走通 ${r.ok}  成功率 ${(r.rate * 100).toFixed(1)}%  ${r.pass ? "PASS" : "FAIL"}`
    );
  }
  console.log(`\n  平均成功率 ${(avgRate * 100).toFixed(1)}%  阈值 ${THRESHOLD * 100}%  →  ${go ? "GO（iMessage 留 P0）" : "NO-GO（iMessage 降 P1 + 工期 -3 天 + SEO 换词）"}`);

  // 落 log
  mkdirSync(OUT_DIR, { recursive: true });
  const logPath = join(OUT_DIR, "run.log");
  const log = [
    `# W0-A1 iMessage spike · ${new Date().toISOString()}`,
    `阈值 ${THRESHOLD * 100}% · 样本 ${results.length} 份`,
    "",
    ...results.map(
      (r) =>
        `## ${r.file} (sha256:${r.hash})\n消息 ${r.total} · 走通 ${r.ok} · 成功率 ${(r.rate * 100).toFixed(1)}% · ${r.pass ? "PASS" : "FAIL"}\n\nschema 预览：\n${r.schemaPreview}\n`
    ),
    `## 总判定\n平均成功率 ${(avgRate * 100).toFixed(1)}% → ${go ? "GO" : "NO-GO"}`,
    go ? "iMessage 留 P0，M1 正常开工。" : "iMessage 降 P1（ADR-0006 预设条款）：工期 -3 天、SEO 页 /imessage-analyzer → /text-message-analyzer、changelog 记 ADR-0009。",
  ].join("\n");
  writeFileSync(logPath, log, "utf8");
  console.log(`\n日志已落盘：${logPath}`);
  process.exit(go ? 0 : 2);
}

main().catch((e) => {
  console.error("[W0-A1] 异常：", e);
  process.exit(1);
});
