/* =========================================================================
 * 「盛宣怀的客厅」前端游戏逻辑
 * 纯 HTML + CSS + JS，数据来自 ../data/gameData.json，存档存于 localStorage
 * ========================================================================= */

/* —— 配置：填入你的 Cloudflare Worker 地址（末尾不带斜杠） ——
 * 例如：const WORKER_URL = "https://sxh-ai.yourname.workers.dev";
 * 留空字符串时，AI 输入将直接使用预设降级回应（不请求后端）。
 */
const WORKER_URL = "https://sxh-ai.yourname.workers.dev"; // ← 改成你的 Worker 地址（含 yourname 等占位符时不会发起请求）

const STORAGE_PREFIX = "sxh_save_";
const SLOT_COUNT = 3;

let DATA = null;
let state = null;

/* ============================ 工具函数 ============================ */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/* 将文本数组渲染为 HTML（每行为一段，"> " 行为引用块） */
function renderMarkdown(lines) {
  if (!lines) return "";
  if (typeof lines === "string") lines = lines.split("\n");
  const html = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) {
      html.push('<blockquote>' + quote.map(inlineMd).join("<br>") + "</blockquote>");
      quote = [];
    }
  };
  for (const raw of lines) {
    const line = raw == null ? "" : String(raw);
    if (line.startsWith(">")) {
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    const t = line.trim();
    if (t === "") continue;
    if (t.startsWith("### ")) { html.push("<h3>" + inlineMd(t.slice(4)) + "</h3>"); continue; }
    if (t.startsWith("## ")) { html.push("<h2>" + inlineMd(t.slice(3)) + "</h2>"); continue; }
    if (t.startsWith("# ")) { html.push("<h1>" + inlineMd(t.slice(2)) + "</h1>"); continue; }
    if (t === "---") { html.push('<hr class="sep" />'); continue; }
    html.push("<p>" + inlineMd(t) + "</p>");
  }
  flushQuote();
  return html.join("");
}

function truncate(s, n) {
  s = String(s).trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function getNode(id) {
  return DATA.nodes.find((n) => n.id === id);
}

function getEnding(id) {
  return DATA.endings[id] || null;
}

/* ============================ 状态 ============================ */

function freshState() {
  return {
    phase: "title",          // title | background | prologue | node | interlude | ending
    nodeId: null,
    optionId: null,          // 已选选项（展示结果视图时）
    interludeId: null,
    sceneIndex: 0,
    endingId: null,
    aiLog: [],
    choices: { node1: null, node2: null, node3: null, node4: null, node5: null }
  };
}

function stateDesc(s) {
  switch (s.phase) {
    case "title": return "未开始";
    case "background": return "时代背景";
    case "prologue": return "序幕：客厅之外";
    case "interlude": {
      const it = DATA.interludes[s.interludeId];
      return it ? it.title : "幕间";
    }
    case "node": {
      const n = getNode(s.nodeId);
      return n ? n.title : "节点";
    }
    case "ending": {
      const e = getEnding(s.endingId);
      return e ? e.title : "结局";
    }
    default: return "";
  }
}

/* ============================ 存档 ============================ */

function readSlots() {
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + i);
      slots.push(raw ? JSON.parse(raw) : null);
    } catch (e) {
      slots.push(null);
    }
  }
  return slots;
}

function writeSlot(i, data) {
  localStorage.setItem(STORAGE_PREFIX + i, JSON.stringify(data));
}

function deleteSlot(i) {
  localStorage.removeItem(STORAGE_PREFIX + i);
}

function doSave(i) {
  const snap = {
    name: "存档 " + (i + 1),
    time: formatNow(),
    desc: stateDesc(state),
    state: JSON.parse(JSON.stringify(state))
  };
  writeSlot(i, snap);
}

function doLoad(i) {
  const raw = localStorage.getItem(STORAGE_PREFIX + i);
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    state = snap.state || freshState();
    closeModal();
    render();
  } catch (e) {
    alert("存档读取失败：" + e.message);
  }
}

function formatNow() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/* ============================ 弹层 ============================ */

const infoModal = document.getElementById("info-modal");
const saveModal = document.getElementById("save-modal");

function closeModal() {
  infoModal.hidden = true;
  saveModal.hidden = true;
  const c = document.getElementById("confirm-modal");
  if (c) c.remove();
}

function openInfo(title, bodyHTML) {
  document.getElementById("info-modal-title").textContent = title;
  document.getElementById("info-modal-body").innerHTML = bodyHTML;
  infoModal.hidden = false;
}

function openSaveModal(mode) {
  const title = mode === "save" ? "保存游戏" : "读取存档";
  document.getElementById("save-modal-title").textContent = title;
  const slots = readSlots();
  const box = document.getElementById("save-slots");
  box.innerHTML = "";
  slots.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "save-slot" + (s ? "" : " empty");
    if (s) {
      div.innerHTML =
        '<div class="slot-info">' +
          '<div class="slot-name">' + escapeHtml(s.name) + '</div>' +
          '<div class="slot-desc">' + escapeHtml(s.desc || "") + '</div>' +
          '<div class="slot-time">' + escapeHtml(s.time || "") + '</div>' +
        '</div>' +
        '<div class="slot-actions"></div>';
      const acts = div.querySelector(".slot-actions");
      if (mode === "save") {
        const b1 = document.createElement("button");
        b1.className = "btn btn-ghost";
        b1.textContent = "覆盖";
        b1.onclick = () => { doSave(i); renderSlots(openSaveModal, mode); };
        acts.appendChild(b1);
        const b2 = document.createElement("button");
        b2.className = "btn btn-ghost";
        b2.textContent = "删除";
        b2.onclick = () => { deleteSlot(i); renderSlots(openSaveModal, mode); };
        acts.appendChild(b2);
      } else {
        const b1 = document.createElement("button");
        b1.className = "btn btn-solid";
        b1.textContent = "读取";
        b1.onclick = () => doLoad(i);
        acts.appendChild(b1);
      }
    } else {
      if (mode === "save") {
        div.textContent = "（空存档位）";
        const b = document.createElement("button");
        b.className = "btn btn-solid";
        b.textContent = "存到此处";
        b.onclick = () => { doSave(i); renderSlots(openSaveModal, mode); };
        div.appendChild(b);
      } else {
        div.textContent = "（空存档位）";
      }
    }
    box.appendChild(div);
  });
  saveModal.hidden = false;
}

function renderSlots(modeFn, mode) {
  modeFn(mode);
}

/* 自定义确认弹窗 */
function confirmDialog(message, yesLabel, noLabel) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "confirm-modal";
    modal.innerHTML =
      '<div class="modal-card">' +
        '<h2 class="modal-title">请三思</h2>' +
        '<div class="prose"><p>' + escapeHtml(message) + '</p></div>' +
        '<div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;">' +
          '<button class="btn btn-ghost" data-no>' + escapeHtml(noLabel || "再想想") + '</button>' +
          '<button class="btn btn-solid btn-danger" data-yes>' + escapeHtml(yesLabel || "确定") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector("[data-yes]").onclick = () => { modal.remove(); resolve(true); };
    modal.querySelector("[data-no]").onclick = () => { modal.remove(); resolve(false); };
    modal.addEventListener("click", (e) => { if (e.target === modal) { modal.remove(); resolve(false); } });
  });
}

/* ============================ 渲染 ============================ */

const stage = document.getElementById("stage");

function render() {
  switch (state.phase) {
    case "title": renderTitle(); break;
    case "background": renderBackground(); break;
    case "prologue": renderPrologue(); break;
    case "node": renderNode(); break;
    case "interlude": renderInterlude(); break;
    case "ending": renderEnding(); break;
    default: renderTitle();
  }
  window.scrollTo(0, 0);
}

function paper(innerHTML) {
  return '<article class="paper">' + innerHTML + '</article>';
}

function renderTitle() {
  const hasSave = readSlots().some(Boolean);
  const saveBtn = hasSave
    ? '<button class="btn btn-solid" id="title-load">读取存档</button>'
    : "";
  stage.innerHTML = paper(
    '<div class="title-screen">' +
      '<div class="title-seal">盛</div>' +
      '<h1>' + escapeHtml(DATA.meta.title) + '</h1>' +
      '<div class="subtitle">' + escapeHtml(DATA.meta.subtitle) + '</div>' +
      '<div class="tagline">' + escapeHtml(DATA.meta.engine) + '</div>' +
      '<div class="title-actions">' +
        '<button class="btn btn-primary" id="title-start">开 始 游 戏</button>' +
        saveBtn +
        '<button class="btn btn-ghost" id="title-rules">玩法说明</button>' +
      '</div>' +
    '</div>'
  );
  document.getElementById("title-start").onclick = () => { state = freshState(); state.phase = "background"; render(); };
  const tr = document.getElementById("title-rules");
  if (tr) tr.onclick = showRules;
  const tl = document.getElementById("title-load");
  if (tl) tl.onclick = () => openSaveModal("load");
}

function renderBackground() {
  const bg = DATA.background;
  const tl = bg.timeline.map((t) =>
    '<div class="tl-row"><span class="tl-year">' + escapeHtml(t.year) + '</span><span>' + escapeHtml(t.event) + '</span></div>'
  ).join("");
  stage.innerHTML = paper(
    '<div class="scene-head">' +
      '<div class="scene-title">' + escapeHtml(bg.title) + '</div>' +
    '</div>' +
    '<div class="prose">' + renderMarkdown(bg.text) + '</div>' +
    '<hr class="sep" />' +
    '<h3>核心时间线</h3>' +
    '<div class="timeline">' + tl + '</div>' +
    '<hr class="sep" />' +
    '<h3>角色关系速查</h3>' +
    '<pre class="relations">' + escapeHtml(bg.relations) + '</pre>' +
    '<div class="stage-actions center">' +
      '<button class="btn btn-primary" id="bg-start">进入序幕</button>' +
    '</div>'
  );
  document.getElementById("bg-start").onclick = () => { state.phase = "prologue"; state.sceneIndex = 0; render(); };
}

function renderPrologue() {
  const scenes = DATA.prologue.scenes;
  const i = state.sceneIndex;
  const sc = scenes[i];
  const isLast = i >= scenes.length - 1;
  stage.innerHTML = paper(
    '<div class="scene-head">' +
      '<div class="scene-title">' + escapeHtml(DATA.prologue.title) + '</div>' +
      '<div class="scene-meta"><span>' + escapeHtml(sc.title) + '</span></div>' +
    '</div>' +
    '<div class="prose">' + renderMarkdown(sc.text) + '</div>' +
    '<div class="stage-actions center">' +
      (isLast
        ? '<button class="btn btn-primary" id="pro-next">前往节点一</button>'
        : '<button class="btn btn-primary" id="pro-next">继续</button>') +
    '</div>'
  );
  document.getElementById("pro-next").onclick = () => {
    if (isLast) { state.phase = "node"; state.nodeId = "node1"; state.optionId = null; }
    else { state.sceneIndex++; }
    render();
  };
}

function renderInterlude() {
  const it = DATA.interludes[state.interludeId];
  const scenes = it.scenes;
  const i = state.sceneIndex;
  const sc = scenes[i];
  const isLast = i >= scenes.length - 1;
  stage.innerHTML = paper(
    '<div class="scene-head">' +
      '<div class="scene-title">' + escapeHtml(it.title) + '</div>' +
      '<div class="scene-meta"><span>' + escapeHtml(sc.title) + '</span></div>' +
    '</div>' +
    '<div class="prose">' + renderMarkdown(sc.text) + '</div>' +
    '<div class="stage-actions center">' +
      '<button class="btn btn-primary" id="it-next">' + (isLast ? "进入下一节点" : "继续") + '</button>' +
    '</div>'
  );
  document.getElementById("it-next").onclick = () => {
    if (isLast) { state.phase = "node"; state.nodeId = it.next; state.optionId = null; }
    else { state.sceneIndex++; }
    render();
  };
}

function renderNode() {
  const node = getNode(state.nodeId);

  // 已选定某选项 → 展示结果
  if (state.optionId) {
    const opt = node.options.find((o) => o.id === state.optionId);
    if (opt) { renderOptionResult(node, opt); return; }
  }

  // 决策点：局势 + 选项 + AI 输入
  const optionsHTML = node.options.map((o) => {
    const badge = markerBadge(o);
    return (
      '<button class="option" data-opt="' + o.id + '">' +
        '<span class="letter">' + escapeHtml(o.letter) + '</span>' +
        '<span class="body">' +
          '<span class="opt-title">' + escapeHtml(o.title) + badge + '</span>' +
        '</span>' +
      '</button>'
    );
  }).join("");

  const decisionLog = renderDecisionLog();

  stage.innerHTML = paper(
    '<div class="scene-head">' +
      '<div class="scene-title">' + escapeHtml(node.title) + '</div>' +
      '<div class="scene-meta">' +
        '<span>' + escapeHtml(node.time) + '</span>' +
        '<span class="tag ' + tagClass(node.tag) + '">' + escapeHtml(node.tag) + '</span>' +
        '<span>' + escapeHtml(node.location) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="prose">' + renderMarkdown(node.situation) + '</div>' +
    (node.options.length ? '<div class="options">' + optionsHTML + '</div>' : '') +
    (node.options.length ? renderAIBox(node) : '') +
    decisionLog +
    (node.options.length === 0 ? renderNode6Actions() : '')
  );

  if (node.options.length) {
    node.options.forEach((o) => {
      const el = stage.querySelector('[data-opt="' + o.id + '"]');
      el.onclick = () => onSelectOption(node, o);
    });
  } else {
    const b = document.getElementById("node6-ending");
    if (b) b.onclick = () => { state.phase = "ending"; state.endingId = "A"; render(); };
  }
  bindAIBox(node);
}

function renderNode6Actions() {
  return (
    '<div class="stage-actions center">' +
      '<button class="btn btn-primary" id="node6-ending">查看终局结算</button>' +
    '</div>'
  );
}

function renderOptionResult(node, opt) {
  const badge = markerBadge(opt);
  let consequence = "";
  let actions = "";

  if (opt.resultType === "failure") {
    consequence =
      '<hr class="sep" />' +
      '<div class="scene-title" style="font-size:20px;margin-bottom:8px;">' + escapeHtml(opt.failure.title) + '</div>' +
      '<div class="prose">' + renderMarkdown(opt.failure.text) + '</div>';
    actions =
      '<div class="stage-actions center">' +
        '<button class="btn btn-primary" id="opt-retry">🔄 回退，重新选择</button>' +
      '</div>';
  } else if (opt.resultType === "advance") {
    const adv = opt.advance;
    if (adv.note || (adv.text && adv.text.length)) {
      consequence =
        '<hr class="sep" />' +
        (adv.note ? '<div class="prose"><p>' + inlineMd(adv.note) + '</p></div>' : "") +
        (adv.text && adv.text.length ? '<div class="prose">' + renderMarkdown(adv.text) + '</div>' : "");
    }
    actions =
      '<div class="stage-actions center">' +
        '<button class="btn btn-primary" id="opt-next">继续 →</button>' +
      '</div>';
  } else if (opt.resultType === "ending") {
    consequence =
      '<hr class="sep" />' +
      '<div class="scene-title" style="font-size:20px;margin-bottom:8px;">' + escapeHtml(opt.endingNarrative.title) + '</div>' +
      '<div class="prose">' + renderMarkdown(opt.endingNarrative.text) + '</div>';
    actions =
      '<div class="stage-actions center">' +
        '<button class="btn btn-primary" id="opt-ending">查看终局结算</button>' +
      '</div>';
  }

  stage.innerHTML = paper(
    '<div class="scene-head">' +
      '<div class="scene-title">' + escapeHtml(node.title) + '</div>' +
      '<div class="scene-meta"><span>选项 ' + escapeHtml(opt.letter) + '</span></div>' +
    '</div>' +
    '<div class="prose">' +
      '<p><strong>' + escapeHtml(opt.title) + '</strong>' + badge + '</p>' +
    '</div>' +
    '<div class="prose"><p class="rednote">你在禀报中写道：</p>' + renderMarkdown(opt.write) + '</div>' +
    '<div class="prose">' + renderMarkdown(opt.advisor) + '</div>' +
    consequence +
    actions
  );

  if (opt.resultType === "failure") {
    document.getElementById("opt-retry").onclick = () => { state.optionId = null; render(); };
  } else if (opt.resultType === "advance") {
    document.getElementById("opt-next").onclick = () => {
      const next = opt.advance.next;
      if (next && next.startsWith("interlude-")) {
        state.phase = "interlude"; state.interludeId = next; state.sceneIndex = 0; state.optionId = null;
      } else if (next && next.startsWith("node")) {
        state.phase = "node"; state.nodeId = next; state.optionId = null;
      }
      render();
    };
  } else if (opt.resultType === "ending") {
    document.getElementById("opt-ending").onclick = () => {
      state.phase = "ending"; state.endingId = opt.endingId; state.optionId = null;
      render();
    };
  }
}

function onSelectOption(node, opt) {
  const commit = () => {
    if (opt.resultType === "advance" || opt.resultType === "ending") {
      state.choices[node.id] = opt.letter;
    }
    state.optionId = opt.id;
    render();
  };
  if (opt.marker === "lock") {
    confirmDialog(
      "这是不可回退的方向性抉择，选定后将锁定结局，无法回头。\n\n" + opt.title + "\n\n确定要做此决定吗？",
      "确定，不再回头", "再想想"
    ).then((ok) => { if (ok) commit(); });
  } else {
    commit();
  }
}

function markerBadge(o) {
  if (o.marker === "history") return '<span class="badge badge-history">★ 历史路径</span>';
  if (o.marker === "retry") return '<span class="badge badge-retry">🔄 可回退</span>';
  if (o.marker === "lock") return '<span class="badge badge-lock">⚠️ 不可回退</span>';
  return "";
}

function tagClass(tag) {
  if (tag && tag.indexOf("不可回退") >= 0) return "tag-lock";
  if (tag && tag.indexOf("可回退") >= 0) return "tag-retry";
  if (tag && tag.indexOf("历史") >= 0) return "tag-history";
  return "";
}

function renderDecisionLog() {
  const entries = [];
  const order = ["node1", "node2", "node3", "node4", "node5"];
  const labels = { node1: "节点一", node2: "节点二", node3: "节点三", node4: "节点四", node5: "节点五" };
  for (const id of order) {
    if (state.choices[id]) {
      entries.push('<div class="dl-row"><span class="dl-node">' + labels[id] + '</span> · 选 ' + escapeHtml(state.choices[id]) + '</div>');
    }
  }
  if (!entries.length) return "";
  return '<div class="decision-log"><h4>抉择记录</h4>' + entries.join("") + '</div>';
}

/* ============================ AI 幕僚 ============================ */

function workerConfigured() {
  if (!WORKER_URL) return false;
  return !/yourname|example|xxxx|占位|your-worker/i.test(WORKER_URL.trim());
}

function renderAIBox(node) {
  return (
    '<div class="ai-box">' +
      '<div class="ai-hint">不必选预设选项？可写下自己的决策理由，向幕僚郑观应呈报（AI）：</div>' +
      '<div class="ai-log" id="ai-log">' + aiLogMessages() + '</div>' +
      '<div class="ai-log-clear" id="ai-log-clear-bar">' +
        '<button class="btn btn-ghost" id="ai-log-clear">清空对话</button>' +
      '</div>' +
      '<div class="ai-input-row">' +
        '<textarea class="ai-input" id="ai-input" rows="2" placeholder="例如：我想先稳住开平，同时悄悄给萍矿拨一笔建炉的银子……"></textarea>' +
        '<button class="btn btn-ai" id="ai-send">呈报</button>' +
      '</div>' +
      '<div class="ai-loading" id="ai-loading" hidden>郑观应正在斟酌……</div>' +
    '</div>'
  );
}

function aiLogMessages() {
  const log = state.aiLog || [];
  if (!log.length) return '<div class="ai-log-empty">（尚无对话，输入决策呈报后，郑观应的回复会记录在此）</div>';
  return log.map((e) => {
    const who = e.role === "player" ? "盛宣怀" : "郑观应";
    const cls = e.role === "player" ? "ai-msg-you" : "ai-msg-ai";
    const body = e.role === "player"
      ? '<p>' + inlineMd(e.text) + '</p>'
      : '<div class="prose">' + renderMarkdown([e.text]) + '</div>';
    let note = "";
    if (e.note) note = '<div class="muted" style="margin-top:4px;font-size:11px;">' + escapeHtml(e.note) + '</div>';
    return '<div class="ai-msg ' + cls + '"><div class="ai-msg-who">' + who + '</div><div class="ai-msg-body">' + body + note + '</div></div>';
  }).join("");
}

function refreshAILog() {
  const el = document.getElementById("ai-log");
  if (el) el.innerHTML = aiLogMessages();
}

function scrollAILog() {
  const el = document.getElementById("ai-log");
  if (el) el.scrollTop = el.scrollHeight;
}

function bindAIBox(node) {
  const input = document.getElementById("ai-input");
  const send = document.getElementById("ai-send");
  const clear = document.getElementById("ai-log-clear");
  if (!input || !send) return;
  const doAsk = async () => {
    const msg = input.value.trim();
    if (!msg) { input.focus(); return; }
    state.aiLog = state.aiLog || [];
    state.aiLog.push({ role: "player", text: msg, node: node.id });
    while (state.aiLog.length > 60) state.aiLog.shift();
    input.value = "";
    refreshAILog();
    scrollAILog();
    const loading = document.getElementById("ai-loading");
    loading.hidden = false;
    const r = await askAI(msg, node);
    loading.hidden = true;
    state.aiLog.push({ role: "advisor", text: r.reply, node: node.id, source: r.source, note: r.note });
    while (state.aiLog.length > 60) state.aiLog.shift();
    refreshAILog();
    scrollAILog();
  };
  send.onclick = doAsk;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAsk(); }
  });
  if (clear) clear.onclick = () => { state.aiLog = []; refreshAILog(); };
}

async function askAI(message, node) {
  if (!workerConfigured()) {
    return { reply: fallbackReply(node, message), source: "fallback", note: "未配置 AI 后端（WORKER_URL 为占位），已使用预设回应。" };
  }
  try {
    const res = await fetch(WORKER_URL + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        nodeId: node.id,
        nodeTitle: node.title,
        situation: node.situation.join("\n"),
        choices: state.choices
      })
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && data.reply) return { reply: data.reply, source: "ai" };
    throw new Error("no reply");
  } catch (e) {
    return { reply: fallbackReply(node, message), source: "fallback", note: "AI 调用失败，已降级为预设回应。" };
  }
}

function fallbackReply(node, message) {
  const historyOpt = node.options.find((o) => o.marker === "history") || node.options[node.options.length - 1];
  const titles = node.options.map((o) => "「" + o.title + "」").join("、");
  return "（郑观应拱手）大人所议「" + truncate(message, 28) + "」，观应已谨记在心。眼下不过" + titles + "数端。以观应愚见，" +
    historyOpt.title + " 一条最为妥当——既不误眼前之急，亦为长远留有余地。然大局在大人，还请权衡利害，再作决断。";
}

/* ============================ 结局 ============================ */

function renderEnding() {
  const e = getEnding(state.endingId);
  if (!e) { renderTitle(); return; }
  const basisLabel = e.basisLabel;
  stage.innerHTML = paper(
    '<div class="ending-screen">' +
      '<div class="ending-badge">' + escapeHtml(basisLabel) + '</div>' +
      '<h2>' + escapeHtml(e.title) + '</h2>' +
      '<div class="route">达成路径：' + escapeHtml(e.route) + '</div>' +
      '<div class="prose">' + renderMarkdown(e.text) + '</div>' +
      '<hr class="sep" />' +
      '<p class="muted"><strong>历史依据说明：</strong>' + escapeHtml(e.basis) + '</p>' +
      '<hr class="sep" />' +
      '<h3>' + escapeHtml(DATA.historyCard.title) + '</h3>' +
      '<pre class="history-card">' + escapeHtml(DATA.historyCard.lines.join("\n")) + '</pre>' +
      '<div class="stage-actions center">' +
        '<button class="btn btn-primary" id="end-restart">重新开始</button>' +
        '<button class="btn btn-ghost" id="end-route">查看路线表</button>' +
      '</div>' +
    '</div>'
  );
  document.getElementById("end-restart").onclick = () => { state = freshState(); render(); };
  document.getElementById("end-route").onclick = showRoute;
}

/* ============================ 信息弹层 ============================ */

function showRules() {
  const r = DATA.rules;
  const items = r.items.map((it) => '<p>' + inlineMd(it) + '</p>').join("");
  const markers = r.markers.map((m) =>
    '<tr><td><strong>' + escapeHtml(m.symbol) + ' ' + escapeHtml(m.label) + '</strong></td><td>' + escapeHtml(m.desc) + '</td></tr>'
  ).join("");
  openInfo(
    "玩法说明",
    '<div class="prose">' + items + '</div>' +
    '<table class="marker-table"><thead><tr><th>标识</th><th>含义</th></tr></thead><tbody>' + markers + '</tbody></table>'
  );
}

function showCast() {
  const cards = DATA.characters.map((c) =>
    '<div class="cast-card">' +
      '<span class="cast-name">' + escapeHtml(c.name) + '</span>' +
      '<span class="cast-role">' + escapeHtml(c.role) + '</span>' +
      '<div class="cast-intro">' + escapeHtml(c.intro) + '</div>' +
    '</div>'
  ).join("");
  openInfo("人物志 · 角色介绍", '<div class="cast-grid">' + cards + '</div>');
}

function showHistory() {
  openInfo(
    DATA.historyCard.title,
    '<pre class="history-card">' + escapeHtml(DATA.historyCard.lines.join("\n")) + '</pre>'
  );
}

function showRoute() {
  const rt = DATA.routeTable;
  const rows = rt.rows.map((r) =>
    '<tr><td>' + escapeHtml(r.node3) + '</td><td>' + escapeHtml(r.node4) + '</td><td>' + escapeHtml(r.node5) + '</td>' +
    '<td><strong>' + escapeHtml(r.ending) + '</strong></td><td>' + escapeHtml(r.basis) + '</td></tr>'
  ).join("");
  openInfo(
    rt.title,
    '<table class="route-table"><thead><tr><th>节点三</th><th>节点四</th><th>节点五</th><th>触发结局</th><th>历史依据</th></tr></thead><tbody>' + rows + '</tbody></table>'
  );
}

/* ============================ 顶栏绑定 ============================ */

function bindTopbar() {
  document.getElementById("btn-rules").onclick = showRules;
  document.getElementById("btn-cast").onclick = showCast;
  document.getElementById("btn-history").onclick = showHistory;
  document.getElementById("btn-route").onclick = showRoute;
  document.getElementById("btn-save").onclick = () => openSaveModal("save");
  document.getElementById("btn-load").onclick = () => openSaveModal("load");
  document.getElementById("btn-new").onclick = async () => {
    if (state.phase !== "title") {
      const ok = await confirmDialog("确定要放弃当前进度，新建游戏吗？", "新建游戏", "取消");
      if (!ok) return;
    }
    state = freshState();
    render();
  };
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  [infoModal, saveModal].forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); })
  );
}

/* ============================ 启动 ============================ */

async function init() {
  try {
    const res = await fetch("../data/gameData.json");
    DATA = await res.json();
  } catch (e) {
    stage.innerHTML = paper('<p>游戏数据加载失败：' + escapeHtml(e.message) + '。请确认 data/gameData.json 存在且可访问。</p>');
    return;
  }
  state = freshState();
  bindTopbar();
  render();
}

init();
