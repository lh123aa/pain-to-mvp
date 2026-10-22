"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Footer, TopBar } from "../components";
import { track } from "../hooks";
import { conversationFromChat, createSpeakerMap } from "@/parser";
import type {
  Conversation,
  DateOrder,
  ParsedChat,
  ParseIssue,
  SpeakerMapResult,
} from "@/parser";
import { createParseWorker } from "@/parser/worker-client";
import type { ParseWorker } from "@/parser/worker-client";
import { buildReportFeatures, formatDateRange } from "@/rules";
import type { ReportFeatures } from "@/rules";
import {
  MAX_SESSION_BYTES,
  estimateSessionBytes,
  saveCheckoutInput,
  saveLastInput,
  saveSession,
  speakersFromConversation,
} from "@/lib/client-session";

/**
 * /analyze — 真实上传链路（W2-1b）
 *
 * 浏览器内完成 读取 → 检测格式 → 解析 → 日期顺序确认 → 说话人锁定 →
 * buildReportFeatures → 本地保存 → /report/preview。原文不出浏览器。
 *
 * 解析在 Web Worker 里执行（大文件不阻塞主线程）；Worker 不可用/超时/报错时
 * worker-client 自动回退到同一份纯函数在主线程同步解析（功能不丢、错误态不变）。
 *
 * 纪律：
 * - 说话人只认用户输入/点选的昵称，绝不按性别、左右、语气猜（PRD FR-2）；
 * - 日期歧义必须让用户选一次 DMY/MDY，再带 dateOrder 重解析（PRD FR-1）；
 * - 群聊（>2 个名字且用户未显式归并）明确拒绝并给返回路径；
 * - 所有错误态 = 标题 + 人话解释 + 一个可执行动作。
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const EXPORT_HINT =
  "In WhatsApp: open the chat → menu → More → Export chat → Without media. Then choose the .txt file it saves.";

type InputSource = "file" | "paste";
type NeedsConfirmation = Extract<SpeakerMapResult, { status: "needsConfirmation" }>;

interface RetryCommit {
  features: ReportFeatures;
  conversation: Conversation;
  fileLabel: string;
}

interface UiError {
  title: string;
  body: string;
  hint?: string;
  showExportHelp?: boolean;
  retryCommit?: RetryCommit;
}

type FlowState =
  | { kind: "form" }
  | { kind: "date"; text: string; source: InputSource; fileLabel: string }
  | { kind: "speakers"; chat: ParsedChat; fileLabel: string; result: NeedsConfirmation }
  | { kind: "one-sided"; features: ReportFeatures; conversation: Conversation; fileLabel: string }
  | {
      kind: "oversize";
      features: ReportFeatures;
      conversation: Conversation;
      fileLabel: string;
      bytes: number;
    }
  | { kind: "error"; error: UiError };

/* ===== 纯函数小工具 ===== */

function splitNameList(value: string): string[] {
  return value
    .split(/[,，、/]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function formatCount(value: number): string {
  return `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function headFor(flow: FlowState): { label: string; title: string; body: string } {
  switch (flow.kind) {
    case "form":
      return {
        label: "Step 1 of 3",
        title: "Upload your chat export",
        body: "The file is read right here in your browser. It never leaves your device — you can unplug the internet and this still works.",
      };
    case "date":
      return {
        label: "Step 1 of 3 · Date format",
        title: "One quick check",
        body: "Your export writes dates as numbers only. Before any timing number is counted, tell us which way to read them.",
      };
    case "speakers":
      return {
        label: "Step 1 of 3 · Speakers",
        title: "Lock the speakers",
        body: "We never guess who is who — if this is wrong, every number in the report is attributed to the wrong person.",
      };
    case "one-sided":
      return {
        label: "Before the preview",
        title: "One side is missing",
        body: "Only one person’s messages appear in this export.",
      };
    case "oversize":
      return {
        label: "Before the preview",
        title: "This export is large",
        body: "We can still build the report, with a smaller evidence set kept in this tab.",
      };
    case "error":
      return {
        label: "Couldn’t continue",
        title: "Let’s fix this",
        body: "Nothing was uploaded. Start over with another export, or paste the text instead.",
      };
  }
}

function parseError(issue: ParseIssue, source: InputSource): UiError {
  if (issue.code === "E-3") {
    return {
      title: "We couldn’t find any messages in this file",
      body: "There were no timestamped message lines inside it, so there is nothing to count.",
      hint: issue.hint ?? EXPORT_HINT,
      showExportHelp: true,
    };
  }
  if (issue.code === "E-7") {
    return {
      title: "We couldn’t read this paste",
      body: "Each message needs a name at the start, like “Alex: hey” on its own line.",
      hint: issue.hint,
    };
  }
  return {
    title: "We couldn’t parse this conversation",
    body: issue.message,
    hint: issue.hint ?? (source === "file" ? EXPORT_HINT : undefined),
    showExportHelp: source === "file",
  };
}

function emptyError(issue: ParseIssue | undefined, source: InputSource): UiError {
  if (issue) return parseError(issue, source);
  return {
    title: "This export has no messages",
    body: "Nothing in it looks like a message from either person.",
    hint: EXPORT_HINT,
    showExportHelp: true,
  };
}

function groupChatError(senders: number): UiError {
  return {
    title: "This looks like a group chat",
    body: `We found ${senders} different names in this export. Reports only analyze a one-to-one conversation — a group chat would make every “you vs them” number meaningless.`,
    hint: "Pick the chat with just the two of you and export it again. If one person simply changed their nickname, go back and list both names in the “Who are you” field, separated by commas.",
  };
}

/* ===== 页面 ===== */

export default function AnalyzePage() {
  const router = useRouter();

  // 原始文本只存在于本组件的内存里：不写 localStorage、不发网络请求。
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [fileText, setFileText] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [speakerA, setSpeakerA] = useState("");
  const [speakerB, setSpeakerB] = useState("");
  const [drag, setDrag] = useState(false);

  const [flow, setFlow] = useState<FlowState>({ kind: "form" });
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [selectedWho, setSelectedWho] = useState<string | null>(null);
  const [mergeUser, setMergeUser] = useState<string[]>([]);
  const [mergePartner, setMergePartner] = useState<string[]>([]);
  const [speakerError, setSpeakerError] = useState<{ message: string; hint?: string } | null>(null);

  // Web Worker 客户端：懒创建（SSR 安全）；Worker 不可用/超时自动回退主线程同步解析。
  const parseWorkerRef = useRef<ParseWorker | null>(null);
  const parseRequestIdRef = useRef(0);

  useEffect(
    () => () => {
      parseWorkerRef.current?.terminate();
      parseWorkerRef.current = null;
    },
    [],
  );

  function getParseWorker(): ParseWorker {
    if (!parseWorkerRef.current) parseWorkerRef.current = createParseWorker();
    return parseWorkerRef.current;
  }

  function resetFlow() {
    setFlow({ kind: "form" });
    setBusy(false);
    setSelectedWho(null);
    setMergeUser([]);
    setMergePartner([]);
    setSpeakerError(null);
  }

  /* ---- 读文件（File.text，纯浏览器内） ---- */

  async function onFile(file: File | undefined) {
    if (!file) return;
    resetFlow();
    setPasted("");
    setFileName("");
    setFileSize(0);
    setFileText(null);

    if (!/\.txt$/i.test(file.name)) {
      track("upload_reject", { reason: "unsupported-extension" });
      setFlow({
        kind: "error",
        error: {
          title: "That file type does not work here",
          body: `We can only read WhatsApp text exports (.txt) in the browser right now, and “${file.name}” is not one.`,
          hint: EXPORT_HINT,
          showExportHelp: true,
        },
      });
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      track("upload_reject", { reason: "file-too-large", size: file.size });
      setFlow({
        kind: "error",
        error: {
          title: "That file is too big to open safely",
          body: `“${file.name}” is ${formatMegabytes(file.size)}. Opening a file that large in a tab can freeze the page before we can say anything useful.`,
          hint: "Export a shorter date range — or the same chat without media — then try again.",
        },
      });
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setBusy(true);
    setBusyLabel("Opening your file…");
    try {
      const text = await file.text();
      if (text.trim().length === 0) {
        setFileName("");
        setFileSize(0);
        setFlow({
          kind: "error",
          error: {
            title: "That file is empty",
            body: "We opened it, but there was no text inside.",
            hint: "Re-export the chat, or paste the conversation instead.",
            showExportHelp: true,
          },
        });
        return;
      }
      setFileText(text);
      track("upload_pick", { kind: "file", size: file.size });
    } catch {
      setFileName("");
      setFileSize(0);
      setFlow({
        kind: "error",
        error: {
          title: "We couldn’t open that file",
          body: "The read was interrupted, or another app is holding the file.",
          hint: "Close the file elsewhere and try again — or paste the conversation instead.",
        },
      });
    } finally {
      setBusy(false);
    }
  }

  /* ---- 解析主流程 ---- */

  async function runParse(
    text: string,
    source: InputSource,
    fileLabel: string,
    dateOrder?: DateOrder,
  ) {
    setBusy(true);
    setBusyLabel("Parsing in this tab…");
    // 让 busy 状态先绘制一帧。Worker 正常时解析在后台线程；Worker 不可用/超时回退主线程时
    // 这一步更是必要 —— 否则同步 fallback 会先阻塞，用户看不到任何状态反馈。
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 解析在 Web Worker 里跑（大文件不阻塞主线程）。Worker 不可用 / 超时 / 报错时，
    // worker-client 自动回退到同一份纯函数在主线程同步执行 —— 行为与错误态保持一致。
    try {
      const response = await getParseWorker().parse({
        id: (parseRequestIdRef.current += 1),
        text,
        source,
        ...(dateOrder === undefined ? {} : { dateOrder }),
      });
      const issues = response.issues;
      const chat = response.chat;

      // 传输/解析器内部异常：与既有 catch 分支同一套人话错误。
      if (chat === null) {
        console.error("[analyze] parse failed", response.ok ? "missing chat" : response.error);
        setFlow({
          kind: "error",
          error: {
            title: "We couldn’t read this conversation",
            body: "The parser stopped unexpectedly. Your text stayed in this tab and was never uploaded.",
            hint: "Try a different export, or paste the conversation instead.",
          },
        });
        return;
      }

      if (chat.meta.tier === "over-limit") {
        setFlow({
          kind: "error",
          error: {
            title: "This conversation is too large for a standard report",
            body: `It has ${formatCount(chat.meta.messageCount)} messages. Standard reports cover up to 80,000; deep reports up to 150,000.`,
            hint: "Export a shorter date range, then try again.",
          },
        });
        return;
      }

      const errorIssue = issues.find((issue) => issue.severity === "error");
      if (chat.meta.messageCount === 0) {
        setFlow({ kind: "error", error: emptyError(errorIssue, source) });
        return;
      }
      if (!response.ok && errorIssue) {
        setFlow({ kind: "error", error: parseError(errorIssue, source) });
        return;
      }

      // 日期歧义：必须先让用户确认一次，选后带 dateOrder 重解析（同样走 worker/fallback）。
      if (chat.meta.needsDateConfirmation && dateOrder === undefined) {
        setFlow({ kind: "date", text, source, fileLabel });
        return;
      }

      continueWithChat(chat, fileLabel);
    } catch (error) {
      console.error("[analyze] parse failed", error);
      setFlow({
        kind: "error",
        error: {
          title: "We couldn’t read this conversation",
          body: "The parser stopped unexpectedly. Your text stayed in this tab and was never uploaded.",
          hint: "Try a different export, or paste the conversation instead.",
        },
      });
    } finally {
      setBusy(false);
    }
  }

  /* ---- 说话人锁定（绝不自动猜） ---- */

  function continueWithChat(chat: ParsedChat, fileLabel: string) {
    const userNames = splitNameList(speakerA);
    const partnerNames = splitNameList(speakerB);
    const mapping = createSpeakerMap(chat, {
      ...(userNames.length > 0 ? { user: userNames } : {}),
      ...(partnerNames.length > 0 ? { partner: partnerNames } : {}),
    });

    if (mapping.status === "confirmed") {
      finishWithConversation(conversationFromChat(chat, mapping.map), fileLabel);
      return;
    }

    // 群聊：用户一个字都没填 → 明确拒绝，给出返回路径（不展示"点选合并"的诱导）。
    if (
      mapping.code === "group-chat-unsupported" &&
      userNames.length === 0 &&
      partnerNames.length === 0
    ) {
      track("analyze_blocked", { reason: "group-chat", senders: mapping.candidates.length });
      setFlow({ kind: "error", error: groupChatError(mapping.candidates.length) });
      return;
    }

    // 把用户已经输入的名字预选到候选人里（只做预选，仍需用户点确认按钮）。
    const matchedCandidates = (names: string[]) => {
      const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
      return mapping.candidates.filter((candidate) =>
        wanted.has(candidate.displayName.trim().toLowerCase()),
      );
    };
    const presetUser = matchedCandidates(userNames);
    const presetPartner = matchedCandidates(partnerNames);

    setSelectedWho(
      mapping.candidates.length <= 2 && presetUser.length === 1 ? (presetUser[0]?.id ?? null) : null,
    );
    setMergeUser(presetUser.map((candidate) => candidate.displayName));
    setMergePartner(presetPartner.map((candidate) => candidate.displayName));
    setSpeakerError(null);
    setFlow({ kind: "speakers", chat, fileLabel, result: mapping });
  }

  function confirmSingleSpeaker() {
    if (flow.kind !== "speakers" || selectedWho === null) return;
    const candidate = flow.result.candidates.find((item) => item.id === selectedWho);
    if (!candidate) return;
    // 只传用户点选的名字；另一方由 speaker-map 的"剩余候选人"确定，不是猜测。
    const mapping = createSpeakerMap(flow.chat, { user: candidate.displayName });
    if (mapping.status === "needsConfirmation") {
      setSpeakerError({ message: mapping.message, hint: mapping.hint });
      return;
    }
    track("speaker_lock", { mode: "single", candidates: flow.result.candidates.length });
    finishWithConversation(conversationFromChat(flow.chat, mapping.map), flow.fileLabel);
  }

  function confirmMergedSpeakers() {
    if (flow.kind !== "speakers" || mergeUser.length === 0) return;
    const mapping = createSpeakerMap(flow.chat, {
      user: mergeUser,
      ...(mergePartner.length > 0 ? { partner: mergePartner } : {}),
    });
    if (mapping.status === "needsConfirmation") {
      setSpeakerError({ message: mapping.message, hint: mapping.hint });
      return;
    }
    track("speaker_lock", { mode: "merge", candidates: flow.result.candidates.length });
    finishWithConversation(conversationFromChat(flow.chat, mapping.map), flow.fileLabel);
  }

  function toggleMerge(role: "user" | "partner", name: string) {
    const setter = role === "user" ? setMergeUser : setMergePartner;
    setter((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  }

  /* ---- 特征构建 → 体积判断 → 本地保存 → 预览页 ---- */

  function finishWithConversation(conversation: Conversation, fileLabel: string) {
    let features: ReportFeatures;
    try {
      features = buildReportFeatures(conversation);
    } catch (error) {
      console.error("[analyze] feature build failed", error);
      setFlow({
        kind: "error",
        error: {
          title: "We couldn’t turn this into a preview",
          body: "The counts and scores failed to compute. Your conversation stayed in this tab and was never uploaded.",
          hint: "Try another export, or paste the text instead.",
        },
      });
      return;
    }

    track("parse_ok", {
      messages: features.sample.messageCount,
      platform: conversation.platform,
      timed: features.dataQuality.timestampCoverage > 0,
      dateOrder: features.dataQuality.dateOrder,
    });

    if (conversation.user.messageCount === 0 || conversation.partner.messageCount === 0) {
      setFlow({ kind: "one-sided", features, conversation, fileLabel });
      return;
    }
    prepareCommit(features, conversation, fileLabel);
  }

  function prepareCommit(
    features: ReportFeatures,
    conversation: Conversation,
    fileLabel: string,
  ) {
    const speakers = speakersFromConversation(conversation);
    const bytes = estimateSessionBytes({ features, conversation, fileName: fileLabel, speakers });
    if (bytes > MAX_SESSION_BYTES) {
      track("analyze_oversize", { bytes });
      setFlow({ kind: "oversize", features, conversation, fileLabel, bytes });
      return;
    }
    commitSession(features, conversation, fileLabel);
  }

  function commitSession(
    features: ReportFeatures,
    conversation: Conversation,
    fileLabel: string,
  ) {
    const speakers = speakersFromConversation(conversation);
    const saved = saveSession({ features, conversation, fileName: fileLabel, speakers });
    if (!saved.ok) {
      track("analyze_save_failed", { reason: saved.reason });
      setFlow({
        kind: "error",
        error: {
          title: "We couldn’t save this preview in your browser",
          body: "The chat is safe — nothing was uploaded — but this browser blocked the local space the next step needs.",
          hint: "Allow site data (cookies and local storage) for this site, then try again.",
          retryCommit: { features, conversation, fileLabel },
        },
      });
      return;
    }

    saveLastInput({
      fileName: fileLabel,
      dateRangeLabel: features.sample.dateRangeLabel,
      messageCount: features.sample.messageCount,
    });
    // 兼容既有 /checkout 只读元数据；绝不写聊天原文。
    saveCheckoutInput({ fileName: fileLabel, speakerA: speakers.user, speakerB: speakers.partner });
    track("analyze_ready", {
      messages: features.sample.messageCount,
      bytes: saved.bytes,
      degraded: saved.degraded,
      storage: saved.storage,
    });
    router.push("/report/preview");
  }

  /* ---- 表单事件 ---- */

  function onContinue() {
    const pasteText = pasted.trim();
    if (pasteText.length > 0) {
      track("analyze_continue", { kind: "paste" });
      void runParse(pasted, "paste", "Pasted text");
      return;
    }
    if (fileText) {
      track("analyze_continue", { kind: "file" });
      void runParse(fileText, "file", fileName || "Uploaded chat");
    }
  }

  function onChooseDate(order: DateOrder) {
    if (flow.kind !== "date") return;
    track("date_order_pick", { order });
    void runParse(flow.text, flow.source, flow.fileLabel, order);
  }

  /* ---- 渲染 ---- */

  const head = headFor(flow);

  function renderFlow() {
    switch (flow.kind) {
      case "form":
        return (
          <>
            <div
              className={`dropzone${drag ? " drag" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDrag(false);
                void onFile(event.dataTransfer.files?.[0]);
              }}
            >
              <div className="dz-ic">
                <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                  <path
                    d="M22 30V10m0 0l-8 8m8-8l8 8"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M8 34h28" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </div>
              <p className="dz-title">{fileText ? "File ready" : "Drop your chat export, or"}</p>
              <p className="dz-sub">
                <label>
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // 清空 value，同一个文件改完再选也能触发 change
                      event.target.value = "";
                      void onFile(file);
                    }}
                  />
                  <span style={{ color: "var(--teal)", fontWeight: 600, cursor: "pointer" }}>
                    choose a file
                  </span>
                </label>
              </p>
              <p className="dz-formats">.txt · plain-text paste below</p>
            </div>

            {fileName && fileText && (
              <div className="file-meta">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path
                    d="M4 2h7l3 3v11H4V2z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="fname">{fileName}</span>
                <span className="fsize">
                  {(fileSize / 1024).toFixed(1)} KB ·{" "}
                  <span className="file-private">stays in this tab</span>
                </span>
              </div>
            )}

            <label className="field-label" htmlFor="paste">
              Or paste a few messages
            </label>
            <textarea
              id="paste"
              className="textarea"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              placeholder={"Alex: are you okay?\nSam: fine\nAlex: did you read this?"}
            />
            {fileText && pasted.trim().length > 0 && (
              <p className="acc-note">We will use the pasted text and ignore the file.</p>
            )}

            <label className="field-label" htmlFor="spk-a">
              Who are you in this chat? (optional)
            </label>
            <input
              id="spk-a"
              className="input"
              value={speakerA}
              onChange={(event) => setSpeakerA(event.target.value)}
              placeholder="e.g. Alex — your name exactly as it appears in the export"
            />
            <label className="field-label" htmlFor="spk-b">
              Who are they? (optional)
            </label>
            <input
              id="spk-b"
              className="input"
              value={speakerB}
              onChange={(event) => setSpeakerB(event.target.value)}
              placeholder="e.g. Sam — their name exactly as it appears in the export"
            />
            <p className="acc-note">
              Leave these blank and we will show you the names found in the export and ask you to
              pick. We never guess who is who.
            </p>

            <div className="cta-row" style={{ marginTop: 28, justifyContent: "space-between" }}>
              <Link className="btn-secondary" href="/" onClick={() => track("analyze_back", {})}>
                ← Back to home
              </Link>
              <button
                className="btn-cta"
                onClick={onContinue}
                disabled={busy || (!fileText && pasted.trim().length === 0)}
              >
                {busy ? (
                  "Working…"
                ) : (
                  <>
                    Continue to free preview <span className="arr">→</span>
                  </>
                )}
              </button>
            </div>
            <p className="privacy-note">
              Parsed locally in this tab. The raw file is never uploaded — not before payment, not
              after.
            </p>
          </>
        );

      case "date":
        return (
          <div className="step-card">
            <p className="step-body">
              Your export writes dates as numbers, like 05/04/2026. Both readings are valid, and the
              choice changes the reply-time cards. Pick the one that matches this chat.
            </p>
            <div className="choice-row">
              <button
                type="button"
                className="choice"
                onClick={() => onChooseDate("DMY")}
                disabled={busy}
              >
                <span className="ch-name">Day first</span>
                <span className="ch-meta">05/04/2026 → 5 April 2026</span>
              </button>
              <button
                type="button"
                className="choice"
                onClick={() => onChooseDate("MDY")}
                disabled={busy}
              >
                <span className="ch-name">Month first</span>
                <span className="ch-meta">05/04/2026 → April 5, 2026</span>
              </button>
            </div>
            <p className="acc-note">
              Only the order of day and month changes. Nothing is uploaded, now or later.
            </p>
            <div className="cta-row" style={{ marginTop: 24 }}>
              <button className="btn-secondary" onClick={resetFlow} disabled={busy}>
                ← Start over
              </button>
            </div>
          </div>
        );

      case "speakers": {
        const candidates = flow.result.candidates;
        const pairMode = candidates.length <= 2;
        return (
          <div className="step-card">
            <p className="step-body">{flow.result.message}</p>
            {flow.result.hint && <p className="step-hint">{flow.result.hint}</p>}
            {speakerError && (
              <p className="step-alert" role="alert">
                {speakerError.message}
                {speakerError.hint ? ` ${speakerError.hint}` : ""}
              </p>
            )}

            {pairMode ? (
              <div className="spk-list">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`spk-option${selectedWho === candidate.id ? " sel" : ""}`}
                    onClick={() => setSelectedWho(candidate.id)}
                    aria-pressed={selectedWho === candidate.id}
                  >
                    <span className="ch-name">{candidate.displayName}</span>
                    <span className="ch-meta">
                      {formatCount(candidate.messageCount)} messages ·{" "}
                      {formatDateRange(candidate.firstTimestamp, candidate.lastTimestamp)}
                    </span>
                    <span className="ch-pick">
                      {selectedWho === candidate.id ? "✓ This is me" : "This is me"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <p className="acc-note">
                  This export has {candidates.length} names. Reports only analyze a one-to-one chat.
                  If one person changed their nickname, tick each of their names on the correct side
                  — otherwise go back and pick the two-person chat.
                </p>
                <ul className="spk-list">
                  {candidates.map((candidate) => (
                    <li key={candidate.id} className="spk-row">
                      <span className="spk-who">
                        <span className="ch-name">{candidate.displayName}</span>
                        <span className="ch-meta">
                          {formatCount(candidate.messageCount)} messages
                        </span>
                      </span>
                      <label className="spk-tick">
                        <input
                          type="checkbox"
                          checked={mergeUser.includes(candidate.displayName)}
                          onChange={() => toggleMerge("user", candidate.displayName)}
                        />{" "}
                        Me
                      </label>
                      <label className="spk-tick">
                        <input
                          type="checkbox"
                          checked={mergePartner.includes(candidate.displayName)}
                          onChange={() => toggleMerge("partner", candidate.displayName)}
                        />{" "}
                        Partner
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div className="cta-row" style={{ marginTop: 24, justifyContent: "space-between" }}>
              <button className="btn-secondary" onClick={resetFlow} disabled={busy}>
                ← Start over
              </button>
              <div className="action-cluster">
                <Link className="btn-secondary" href="/">
                  Back to home
                </Link>
                <button
                  className="btn-cta"
                  onClick={pairMode ? confirmSingleSpeaker : confirmMergedSpeakers}
                  disabled={busy || (pairMode ? selectedWho === null : mergeUser.length === 0)}
                >
                  Lock speakers <span className="arr">→</span>
                </button>
              </div>
            </div>
          </div>
        );
      }

      case "one-sided": {
        const speakers = speakersFromConversation(flow.conversation);
        const userPresent = flow.conversation.user.messageCount > 0;
        const present = userPresent ? speakers.user : speakers.partner;
        const missing = userPresent ? "your partner" : "you";
        return (
          <div className="step-card">
            <p className="step-body">
              Only messages from <strong>{present}</strong> appear in this export — nothing from{" "}
              {missing}. We can still run the report, but it will state the imbalance and lower its
              confidence.
            </p>
            <p className="step-hint">
              If both sides should be there, re-export the chat and make sure the conversation was
              fully included.
            </p>
            <div className="cta-row" style={{ marginTop: 24, justifyContent: "space-between" }}>
              <button className="btn-secondary" onClick={resetFlow} disabled={busy}>
                ← Start over
              </button>
              <button
                className="btn-cta"
                onClick={() => prepareCommit(flow.features, flow.conversation, flow.fileLabel)}
                disabled={busy}
              >
                Continue anyway <span className="arr">→</span>
              </button>
            </div>
          </div>
        );
      }

      case "oversize":
        return (
          <div className="step-card">
            <p className="step-body">
              This conversation produced about {formatMegabytes(flow.bytes)} of derived data.
              Browsers give a tab only a small local quota, so we&apos;ll keep the computed report
              and only the messages it cites — not the whole normalized conversation.
            </p>
            <p className="step-hint">
              The free cards and the full report still work. Evidence quotes may be fewer, and this
              preview lives only in this tab.
            </p>
            <div className="cta-row" style={{ marginTop: 24, justifyContent: "space-between" }}>
              <button className="btn-secondary" onClick={resetFlow} disabled={busy}>
                ← Start over
              </button>
              <button
                className="btn-cta"
                onClick={() => commitSession(flow.features, flow.conversation, flow.fileLabel)}
                disabled={busy}
              >
                Continue with a smaller copy <span className="arr">→</span>
              </button>
            </div>
          </div>
        );

      case "error": {
        const retry = flow.error.retryCommit;
        return (
          <div className="err-panel" role="alert">
            <p className="err-title">{flow.error.title}</p>
            <p className="err-body">{flow.error.body}</p>
            {flow.error.hint && <p className="err-hint">{flow.error.hint}</p>}
            {flow.error.showExportHelp && (
              <div className="help-box">
                <p className="help-title">How to export from WhatsApp</p>
                <p>iPhone: open the chat → tap the contact name → Export Chat → Without Media.</p>
                <p>Android: open the chat → ⋮ → More → Export chat → Without media.</p>
                <p>
                  You&apos;ll get a .txt file. It stays on your device — this page reads it in the
                  browser.
                </p>
              </div>
            )}
            <div className="cta-row" style={{ marginTop: 24, justifyContent: "space-between" }}>
              <Link className="btn-secondary" href="/">
                ← Back to home
              </Link>
              <div className="action-cluster">
                {retry && (
                  <button
                    className="btn-cta"
                    onClick={() => commitSession(retry.features, retry.conversation, retry.fileLabel)}
                  >
                    Try saving again
                  </button>
                )}
                <button className="btn-secondary" onClick={resetFlow}>
                  Start over
                </button>
              </div>
            </div>
          </div>
        );
      }
    }
  }

  return (
    <>
      <style>{styleTag}</style>
      <TopBar />
      <section className="inner">
        <div className="wrap">
          <div className="inner-head">
            <p className="sec-label">{head.label}</p>
            <h1>{head.title}</h1>
            <p>{head.body}</p>
          </div>

          {busy && (
            <p className="working" role="status">
              {busyLabel || "Working…"}
            </p>
          )}

          {renderFlow()}
        </div>
      </section>
      <Footer />
    </>
  );
}

/* 本页专用样式（不改共享 components.css / globals.css） */
const styleTag = `
.step-card{border:1px solid var(--sand-line);border-radius:var(--r-card);background:#fff;padding:26px 28px;box-shadow:var(--shadow-1)}
.step-body{font-size:15.5px;line-height:1.65;color:var(--ink-700)}
.step-hint{margin-top:12px;font-size:14px;line-height:1.6;color:var(--ink-500)}
.step-alert{margin-top:14px;border:1px solid #e6b8b0;background:#fdf3f1;border-radius:8px;padding:12px 14px;font-size:13.5px;line-height:1.55;color:#8a2f21}
.choice-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}
.choice{display:flex;flex-direction:column;gap:6px;align-items:flex-start;border:1px solid var(--sand-line);border-radius:var(--r-btn);background:#fff;padding:16px 18px;text-align:left;transition:border-color .15s var(--ease-standard),background .15s var(--ease-standard)}
.choice:hover{border-color:var(--teal);background:var(--teal-tint)}
.choice:disabled{opacity:.55;cursor:default}
.choice .ch-name{font-size:16px;font-weight:700}
.choice .ch-meta{font-family:var(--font-mono);font-size:11.5px;color:var(--ink-500);letter-spacing:.02em}
.spk-list{display:grid;gap:10px;margin:18px 0 0;padding:0;list-style:none}
.spk-option{display:flex;flex-direction:column;gap:4px;align-items:flex-start;border:1px solid var(--sand-line);border-radius:var(--r-btn);background:#fff;padding:14px 16px;text-align:left;transition:border-color .15s var(--ease-standard),background .15s var(--ease-standard)}
.spk-option:hover{border-color:var(--teal)}
.spk-option.sel{border-color:var(--teal);background:var(--teal-tint);box-shadow:inset 0 0 0 1px var(--teal)}
.spk-option .ch-pick{margin-top:4px;font-size:12px;font-weight:600;color:var(--teal)}
.spk-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid var(--sand-line);border-radius:var(--r-btn);background:#fff;padding:12px 14px}
.spk-who{display:flex;flex-direction:column;gap:2px;flex:1;min-width:140px}
.spk-tick{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--ink-700);cursor:pointer}
.spk-tick input{accent-color:var(--teal)}
.action-cluster{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.working{margin:-8px 0 18px;font-family:var(--font-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--clay)}
.privacy-note{margin-top:18px;font-size:12.5px;line-height:1.6;color:var(--ink-500)}
.err-panel{border:1px solid #e6b8b0;background:#fdf3f1;border-radius:var(--r-card);padding:26px 28px}
.err-title{font-size:19px;font-weight:700;color:#8a2f21;margin-bottom:10px}
.err-body{font-size:14.5px;line-height:1.65;color:var(--ink-700)}
.err-hint{margin-top:10px;font-size:13.5px;line-height:1.6;color:var(--ink-500)}
.help-box{margin-top:16px;border-top:1px solid #e6b8b0;padding-top:14px;font-size:13px;line-height:1.6;color:var(--ink-700)}
.help-title{font-weight:700;margin-bottom:6px}
.file-private{font-size:11.5px;color:var(--ink-500);font-family:var(--font-mono)}
@media (max-width:600px){.choice-row{grid-template-columns:1fr}}
`;
