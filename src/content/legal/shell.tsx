/**
 * The Tell · 合规页壳层（6 个信任页唯一渲染器）
 *
 * 为什么放在 content/legal：本组页面共享同一版式，但不得修改共享文件
 * （layout.tsx / components.tsx / components.css / globals.css），
 * 因此把"壳层 + 行内语法解析"收在本目录，页面文件只剩 metadata + 一行 <LegalShell />。
 *
 * 行内语法（只两种，故意做小）：
 *   [label](href)  → / 开头走 next/link；http(s) 走新标签；tel:/mailto: 原样
 *   **text**       → <strong>
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Footer, TopBar } from "@/app/components";
import {
  CONTACT_EMAIL,
  CRISIS,
  LEGAL_NAV,
  SITE_HOST,
} from "./shared";
import type { LegalBlock, LegalDoc, LegalLink } from "./types";

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

function linkElement(href: string, label: string, key: string): ReactNode {
  if (href.startsWith("/")) {
    return (
      <Link key={key} href={href}>
        {label}
      </Link>
    );
  }
  if (href.startsWith("http")) {
    return (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }
  return (
    <a key={key} href={href}>
      {label}
    </a>
  );
}

/** 把文案字符串渲染成 ReactNode（链接 + 粗体） */
function inline(text: string, keyBase: string): ReactNode[] {
  INLINE.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let match = INLINE.exec(text);
  while (match !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined && match[2] !== undefined) {
      out.push(linkElement(match[2], match[1], `${keyBase}-l${n}`));
    } else if (match[3] !== undefined) {
      out.push(<strong key={`${keyBase}-b${n}`}>{match[3]}</strong>);
    }
    last = INLINE.lastIndex;
    n += 1;
    match = INLINE.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function LinkRow({ links }: { links: readonly LegalLink[] }) {
  return (
    <p className="legal-callout-links">
      {links.map((l) => linkElement(l.href, l.label, `callout-${l.href}`))}
    </p>
  );
}

function Block({ block, index }: { block: LegalBlock; index: number }) {
  switch (block.kind) {
    case "p":
      return <p>{inline(block.text, `p${index}`)}</p>;
    case "list":
      return (
        <ul className="legal-list">
          {block.items.map((item, i) => (
            <li key={`li${i}`}>{inline(item, `li${index}-${i}`)}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="legal-steps">
          {block.items.map((item, i) => (
            <li className="legal-step" key={`st${i}`}>
              <span className="legal-step-n tnum" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="legal-step-t">{inline(item.title, `stt${index}-${i}`)}</p>
                <p className="legal-step-d">{inline(item.text, `std${index}-${i}`)}</p>
              </div>
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <div className="legal-note">
          {block.title !== undefined && <p className="legal-note-h">{block.title}</p>}
          <p>{inline(block.text, `nt${index}`)}</p>
        </div>
      );
    case "callout":
      return (
        <div className={`legal-callout legal-${block.tone}`}>
          <p className="legal-callout-h">
            <span aria-hidden="true">● </span>
            {block.title}
          </p>
          <p>{inline(block.text, `co${index}`)}</p>
          {block.links !== undefined && <LinkRow links={block.links} />}
        </div>
      );
    case "pull":
      return <p className="legal-pull">{inline(block.text, `pl${index}`)}</p>;
    case "table":
      return (
        <div className="legal-table-wrap">
          <table className="legal-table">
            {block.caption !== undefined && (
              <caption className="legal-table-cap">{block.caption}</caption>
            )}
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th key={`th${i}`} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={`tr${ri}`}>
                  {row.map((cell, ci) => (
                    <td key={`td${ci}`} data-label={block.head[ci] ?? ""}>
                      {inline(cell, `td${index}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export function LegalShell({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <TopBar />
      <main className="inner legal">
        <div className="wrap legal-wrap">
          <header className="legal-head">
            <p className="sec-label">{doc.eyebrow}</p>
            <h1>{doc.title}</h1>
            <p className="legal-lede">{doc.intro}</p>
            <p className="legal-meta">
              <span className="tnum">{doc.version}</span>
              <span aria-hidden="true">·</span>
              <span>Last updated {doc.updated}</span>
              <span aria-hidden="true">·</span>
              <span>Applies to {SITE_HOST}</span>
            </p>
          </header>

          <nav className="legal-toc" aria-label="On this page">
            <p className="legal-toc-h">On this page</p>
            <ol>
              {doc.sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span className="legal-toc-n tnum" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{s.heading}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal-body">
            {doc.sections.map((s) => (
              <section
                className="legal-sec"
                id={s.id}
                key={s.id}
                aria-labelledby={`${s.id}-h`}
              >
                <h2 id={`${s.id}-h`}>{s.heading}</h2>
                {s.blocks.map((b, i) => (
                  <Block key={`${s.id}-${i}`} block={b} index={i} />
                ))}
              </section>
            ))}
          </div>

          <div className="legal-crisis-mini">
            <p className="legal-crisis-mini-h">{CRISIS.headline}</p>
            <p>
              <a href={CRISIS.us.href}>{CRISIS.us.label}</a>
              <span aria-hidden="true"> · </span>
              <a href={CRISIS.intl.href} target="_blank" rel="noopener noreferrer">
                {CRISIS.intl.label}
              </a>
            </p>
          </div>

          <nav className="legal-links" aria-label="Other policies">
            {LEGAL_NAV.filter((n) => n.slug !== doc.slug).map((n) => (
              <Link key={n.slug} href={n.slug}>
                {n.label}
              </Link>
            ))}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </nav>
        </div>
      </main>
      <Footer />
    </>
  );
}
