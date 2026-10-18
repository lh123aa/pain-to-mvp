"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Footer, TopBar } from "../components";
import { track } from "../hooks";

export default function AnalyzePage() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [pasted, setPasted] = useState("");
  const [speakerA, setSpeakerA] = useState("");
  const [speakerB, setSpeakerB] = useState("");
  const [drag, setDrag] = useState(false);

  function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setFileSize(f.size);
    setPasted("");
    track("upload_pick", { name: f.name, size: f.size, kind: "file" });
  }

  function onContinue() {
    // demo：把参数塞进 localStorage，报告页读取；真实解析后续接
    const payload = {
      fileName: fileName || "(pasted text)",
      speakerA: speakerA || "You",
      speakerB: speakerB || "Them",
      pasted: pasted.slice(0, 2000),
    };
    localStorage.setItem("tell:input", JSON.stringify(payload));
    track("analyze_continue", { hasFile: !!fileName, hasPaste: !!pasted });
    router.push("/report/preview");
  }

  return (
    <>
      <TopBar />
      <section className="inner">
        <div className="wrap">
          <div className="inner-head">
            <p className="sec-label">Step 1 of 3</p>
            <h1>Upload your chat export</h1>
            <p>
              The file is read right here in your browser. It never leaves your device — you can
              unplug the internet and this still works.
            </p>
          </div>

          {/* 文件拖放区 */}
          <div
            className={`dropzone${drag ? " drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onFile(e.dataTransfer.files?.[0]);
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
                <path
                  d="M8 34h28"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="dz-title">
              {fileName ? "File ready" : "Drop your chat export, or"}
            </p>
            <p className="dz-sub">
              <label>
                <input
                  type="file"
                  accept=".txt,.db,.chats,.csv"
                  style={{ display: "none" }}
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <span style={{ color: "var(--teal)", fontWeight: 600, cursor: "pointer" }}>
                  choose a file
                </span>
              </label>
            </p>
            <p className="dz-formats">.txt · chat.db · .csv · plain-text paste below</p>
          </div>

          {fileName && (
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
              <span className="fsize">{(fileSize / 1024).toFixed(1)} KB</span>
            </div>
          )}

          {/* 粘贴文本替代路径 */}
          <label className="field-label" htmlFor="paste">
            Or paste a few messages
          </label>
          <textarea
            id="paste"
            className="textarea"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"Mar 3  09:12\nYou: are you okay?\nThem: fine\nMar 3  23:40\nYou: did you read this? ..."}
          />

          {/* 说话人锁定 */}
          <label className="field-label" htmlFor="spk-a">
            Who is speaker A?
          </label>
          <input
            id="spk-a"
            className="input"
            value={speakerA}
            onChange={(e) => setSpeakerA(e.target.value)}
            placeholder="e.g. You / your name / 'Alex'"
          />
          <label className="field-label" htmlFor="spk-b">
            Who is speaker B?
          </label>
          <input
            id="spk-b"
            className="input"
            value={speakerB}
            onChange={(e) => setSpeakerB(e.target.value)}
            placeholder="e.g. Them / their name / 'Sam'"
          />
          <p className="acc-note" style={{ marginTop: 10 }}>
            Lock the two speakers so every number is attributed to the right person.
          </p>

          {/* 行动区 */}
          <div className="cta-row" style={{ marginTop: 28, justifyContent: "space-between" }}>
            <Link
              className="btn-secondary"
              href="/"
              onClick={() => track("analyze_back", {})}
            >
              ← Back to home
            </Link>
            <button
              className="btn-cta"
              onClick={onContinue}
              disabled={!fileName && !pasted.trim()}
            >
              Continue to free preview <span className="arr">→</span>
            </button>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
