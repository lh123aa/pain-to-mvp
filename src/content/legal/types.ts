/**
 * The Tell · 合规/信任页文案模型
 *
 * 设计约束：
 * - 文案与渲染分离：本目录只放"可审计的纯文本"，页面只做 metadata + <LegalShell doc={...} />
 * - 文本内的行内语法只允许两种：`[label](href)` 链接、`**bold**` 强调，由 shell.tsx 解析
 * - 不引入新依赖；所有类型为纯 TS 类型（无运行时导出）
 */

/** 行内链接（用于 callout 底部资源入口） */
export type LegalLink = {
  label: string;
  /** 站内以 / 开头；外链以 http 开头；tel: / mailto: 原样 */
  href: string;
};

export type LegalBlock =
  /** 普通段落。支持 [label](href) 与 **bold** */
  | { kind: "p"; text: string }
  /** 无序列表。支持 [label](href) 与 **bold** */
  | { kind: "list"; items: string[] }
  /** 编号步骤：每条 = 标题 + 一句人话 */
  | { kind: "steps"; items: { title: string; text: string }[] }
  /** 沙色提示块（可带小标题） */
  | { kind: "note"; title?: string; text: string }
  /** 危机资源块（红色只留给危机资源，见 globals.css --error） */
  | {
      kind: "callout";
      tone: "crisis" | "info";
      title: string;
      text: string;
      links?: LegalLink[];
    }
  /** 大号立场声明（如 "This report is a mirror for you — not ammunition for a fight."） */
  | { kind: "pull"; text: string }
  /** 数据表（保留期 / 五维权重） */
  | { kind: "table"; caption?: string; head: string[]; rows: string[][] };

export type LegalSection = {
  /** 锚点 id，同时用于 aria-labelledby */
  id: string;
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDoc = {
  /** 站内路径，如 "/privacy"；同时作为 canonical 的路径部分 */
  slug: string;
  /** 同时也是 <title>（根 layout 会追加 " — The Tell"） */
  title: string;
  /** meta description，建议 120–160 字符 */
  description: string;
  /** 眉标（mono 小字） */
  eyebrow: string;
  /** 首屏导语 */
  intro: string;
  /** 版本号，如 "v1.0" */
  version: string;
  /** 最后更新日期（人读格式，如 "October 22, 2026"） */
  updated: string;
  sections: LegalSection[];
};
