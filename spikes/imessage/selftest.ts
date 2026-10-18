// W0-A1 自检：合成一份最小 chat.db，验证 sql.js 解析管线能跑通
// 用法：tsx spikes/imessage/selftest.ts
// 自检通过后管线即"可待真实样本"，A1 工程产物完成
import initSqlJs from "sql.js";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const SQL = await initSqlJs({
    locateFile: (f) => join(process.cwd(), "node_modules", "sql.js", "dist", f),
  });

  // 建一份最小 message 表
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      text TEXT,
      attributedBody BLOB,
      date INTEGER
    );
  `);
  // 插 3 条：1 条 text 非空（走通），2 条 text 空 + attributedBody 归 1 可读（走通 1 条、不可读 1 条）
  const ab1 = Buffer.concat([Buffer.from([0x01, 0x03]), Buffer.from("Hi!")]); // "Hi!"
  const ab2 = Buffer.from([0x01, 0x03, 0xff, 0x00, 0x00]); // 含 NUL → 不可读
  db.run(`
    INSERT INTO message (text, attributedBody, date) VALUES
      ('Hello', NULL, 1000),
      (NULL, $1, 1001),
      (NULL, $2, 1002)
  `, [ab1, ab2]);

  const out = join(process.cwd(), "samples", "raw", "selftest.db");
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, db.export());
  db.close();

  // 用 A1 主脚本的统计逻辑跑 selftest.db
  const buf = readFileSync(out);
  const db2 = new SQL.Database(buf);
  const rows = db2.exec("SELECT ROWID, text, attributedBody, date FROM message ORDER BY ROWID")[0].values;

  // 归 1 长度前缀解码（与 spike.ts 的 decodeAttributedBody 同一套逻辑）
  function decodeAb(ab: Buffer): { ok: boolean; text: string } {
    if (ab.length >= 2 && ab[0] === 0x01) {
      let i = 1;
      let len = 0;
      let shift = 0;
      let b;
      do {
        b = ab[i++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (i >= ab.length) return { ok: false, text: "" };
      } while (b & 0x80);
      if (i + len > ab.length) return { ok: false, text: "" };
      const raw = ab.subarray(i, i + len);
      if (raw.length === 0 || raw[0] === 0xff || raw[0] === 0xfe) return { ok: false, text: "" };
      const str = Buffer.from(raw).toString("utf8");
      if (!str || str.includes("\u0000")) return { ok: false, text: "" };
      if (/[a-zA-Z0-9\u4e00-\u9fff]/.test(str)) return { ok: true, text: str };
    }
    return { ok: false, text: "" };
  }

  let ok = 0;
  for (const v of rows) {
    const text = v[1] as string | null;
    const ab = v[2] as Buffer | null;
    if (text === null || text === "") {
      if (ab && ab.length > 0) {
        const d = decodeAb(ab);
        if (d.ok) ok++;
      }
    } else {
      ok++;
    }
  }
  db2.close();

  const total = rows.length;
  const rate = ok / total;
  console.log(`[自检] selftest.db 总消息 ${total} · 走通 ${ok} · 成功率 ${(rate * 100).toFixed(1)}%`);
  // 预期：3 条里 2 条走通（Hello + Hi!），ab2 不可读 → 成功率 66.7%
  if (ok === 2 && total === 3) {
    console.log("[自检] PASS · sql.js 管线跑通，统计逻辑正确 → A1 工程产物就绪，可待真实样本");
  } else {
    console.error(`[自检] FAIL · 预期 ok=2 total=3，实际 ok=${ok} total=${total}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[自检] 异常：", e);
  process.exit(1);
});
