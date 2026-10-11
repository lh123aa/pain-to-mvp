// Pain-to-MVP Dashboard - 前端脚本
const REFRESH_INTERVAL = 3000;
let currentFilter = "all";
let cache = null;

const STATUS_LABELS = {
  "discovered": "新发现",
  "in_progress": "进行中",
  "analyzing": "分析中",
  "mvp_design": "MVP设计中",
  "validating": "验证中",
  "completed": "已完成",
  "dropped": "已放弃",
};

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch { return iso; }
}

function renderStats(summary) {
  summary = summary || {};
  document.getElementById("s-total").textContent = summary.total ?? 0;
  document.getElementById("s-in-progress").textContent = summary.in_progress ?? 0;
  document.getElementById("s-completed").textContent = summary.completed ?? 0;
  document.getElementById("s-dropped").textContent = summary.dropped ?? 0;
  document.getElementById("s-high").textContent = summary.high_score ?? 0;
}

function renderCard(req) {
  const status = req.status || "discovered";
  const statusLabel = STATUS_LABELS[status] || status;
  const progress = req.progress ?? 0;
  const score = req.score != null ? Number(req.score).toFixed(1) : "—";
  const quotes = (req.representative_quotes || []).slice(0, 2);
  const stage = req.stage || "";
  const next = req.next_action || "";

  const quotesHtml = quotes.map(q => `<div class="quote">「${esc(q)}」</div>`).join("");

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-id">${esc(req.id)}</div>
          <div class="card-title">${esc(req.title) || "未命名需求"}</div>
        </div>
        <span class="badge ${status}">${statusLabel}</span>
      </div>
      <div class="card-meta">
        <span class="score">⭐ ${score}</span>
        <span>📅 ${fmtTime(req.discovered_at)}</span>
      </div>
      ${quotesHtml}
      <div class="progress-wrap">
        <div class="progress-label">
          <span>进度</span>
          <span>${progress}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="stage">${esc(stage)}</div>
      </div>
      ${next ? `<div class="next-action">${esc(next)}</div>` : ""}
    </div>
  `;
}

function applyFilter(reqs) {
  if (currentFilter === "all") return reqs;
  if (currentFilter === "in_progress") {
    return reqs.filter(r => ["in_progress", "analyzing", "mvp_design", "validating"].includes(r.status));
  }
  return reqs.filter(r => r.status === currentFilter);
}

function render(data) {
  renderStats(data.summary);
  document.getElementById("last-updated").textContent = fmtTime(data.last_updated);

  const reqs = applyFilter(data.requirements || []);
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");

  if (!data.requirements || data.requirements.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  if (reqs.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:40px"><p>该分类下暂无需求</p></div>`;
    return;
  }

  grid.innerHTML = reqs.map(renderCard).join("");
}

async function fetchData() {
  try {
    const r = await fetch("/dashboard.json", { cache: "no-store" });
    const data = await r.json();
    cache = data;
    render(data);
  } catch (e) {
    document.getElementById("last-updated").textContent = "⚠️ 连接失败";
  }
}

function setupFilters() {
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      if (cache) render(cache);
    });
  });
}

// 启动
setupFilters();
fetchData();
setInterval(fetchData, REFRESH_INTERVAL);
