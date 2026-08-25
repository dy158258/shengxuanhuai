/* =========================================================================
 * 「盛宣怀的客厅」——微信聊天式 galgame 前端
 * 聊天气泡 + 角色头像 + 打字机动画 + 开局选角，古典宣纸背景
 * 数据 ../data/gameData.json · 存档 localStorage · AI 由 Node 后端提供（可降级）
 * ========================================================================= */

/* —— AI 后端地址 ——
 * 云服务器（VPS）部署时，前后端同源，用相对路径 /api/ai 即可。
 * 若仍用 Cloudflare Worker 托管后端，可改为 Worker 完整地址，如 "https://xxx.workers.dev/api/chat"。
 */
const AI_BACKEND = "/api/ai";

const STORAGE_PREFIX = "sxh_save_";
const SLOT_COUNT = 3;

/* 角色头像：古典配色 + 代表字 */
const AVATARS = {
  "盛宣怀": { char: "盛", color: "#a63b2a" },
  "张之洞": { char: "张", color: "#2f5d8a" },
  "赵尔巽": { char: "赵", color: "#6b4fa0" },
  "郑观应": { char: "郑", color: "#3f6b5a" },
  "李维格": { char: "李", color: "#b07a2e" },
  "张赞宸": { char: "赞", color: "#8a6a3a" },
  "卜聂": { char: "卜", color: "#4a7a9a" },
  "小田切万寿之助": { char: "田", color: "#7a4a5a" },
  "蒋鸿林": { char: "蒋", color: "#3a7a5a" },
  "宋炜臣": { char: "宋", color: "#a05a3a" },
  "袁世凯": { char: "袁", color: "#5a5a8a" },
  "奕劻": { char: "奕", color: "#8a3a5a" },
  "案头笔录": { char: "案", color: "#8a7a5f" },
  "书札": { char: "札", color: "#a57a2e" }
};

/* 章回体回目 + 年号日期（用于场景/幕间开头） */
const CHAPTERS = {
  "prologue": { regnal: "光绪二十二年春 · 1896年", couplet: "督署两折相逼　杏荪一诺接下" },
  "node1": { regnal: "光绪二十四年六月十三日 · 1898年7月31日", couplet: "账册惊心　三十万两难为继" },
  "node2": { regnal: "光绪二十五年六月 · 1899年7月", couplet: "萍焦劣质　钢厂停工告急" },
  "node3": { regnal: "光绪二十五年六月十八日 · 1899年7月25日", couplet: "焦炭一战　三策殊途定去留" },
  "node4": { regnal: "光绪三十三年七月 · 1907年8月", couplet: "四面夹击　新旧官商各怀心" },
  "node5": { regnal: "光绪三十三年十月 · 1907年11月", couplet: "体制之争　官商去留一线悬" },
  "node6": { regnal: "光绪三十四年二月 · 1908年3月", couplet: "十载苦功　汉冶萍一朝成立" },
  "interlude-1to2": { regnal: "光绪二十四年秋 — 二十五年春", couplet: "萍矿初创　日人初探矿山" },
  "interlude-2to3": { regnal: "光绪二十五年七月", couplet: "焦战前夕　密谈定三策" },
  "interlude-3to4": { regnal: "光绪二十六年 — 三十三年", couplet: "十年苦撑　输血管遭断" },
  "interlude-4to5": { regnal: "光绪三十三年七月", couplet: "奏折密信　官商起波澜" },
  "interlude-5to6": { regnal: "光绪三十三年冬 — 三十四年二月", couplet: "最后冲刺　注册待朱批" }
};

let DATA = null;
let state = null;
let selectedAvatar = "盛宣怀";

/* ============================ 工具 ============================ */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function inlineMd(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
function renderMarkdown(lines) {
  if (!lines) return "";
  if (typeof lines === "string") lines = lines.split("\n");
  const out = [];
  let quote = [];
  const flush = () => {
    if (quote.length) { out.push("<blockquote>" + quote.map(inlineMd).join("<br>") + "</blockquote>"); quote = []; }
  };
  for (const raw of lines) {
    const line = String(raw == null ? "" : raw);
    if (line.startsWith(">")) { quote.push(line.replace(/^>\s?/, "")); continue; }
    flush();
    const t = line.trim();
    if (!t) continue;
    if (/^#{1,3}\s/.test(t)) { out.push("<p>" + inlineMd(t.replace(/^#{1,3}\s*/, "")) + "</p>"); continue; }
    if (t === "---") continue;
    out.push("<p>" + inlineMd(t) + "</p>");
  }
  flush();
  return out.join("");
}
function truncate(s, n) { s = String(s).trim(); return s.length > n ? s.slice(0, n) + "…" : s; }
function getNode(id) { return DATA.nodes.find((n) => n.id === id); }
function getEnding(id) { return DATA.endings[id] || null; }

/* ============================ 状态 ============================ */

function freshState() {
  return {
    phase: "select",     // select | background | prologue | node | interlude | ending
    avatar: "盛宣怀",
    nodeId: null,
    optionId: null,
    interludeId: null,
    sceneIndex: 0,
    endingId: null,
    aiLog: [],
    choices: { node1: null, node2: null, node3: null, node4: null, node5: null }
  };
}

function stateDesc(s) {
  switch (s.phase) {
    case "background": return "时代背景";
    case "prologue": return "序幕 · 客厅之外";
    case "interlude": { const it = DATA.interludes[s.interludeId]; return it ? it.title : "幕间"; }
    case "node": { const n = getNode(s.nodeId); return n ? n.title : "场景"; }
    case "ending": { const e = getEnding(s.endingId); return e ? e.title : "结局"; }
    default: return "未开始";
  }
}

/* ============================ 存档 ============================ */

function readSlots() {
  const slots = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    try { const raw = localStorage.getItem(STORAGE_PREFIX + i); slots.push(raw ? JSON.parse(raw) : null); }
    catch (e) { slots.push(null); }
  }
  return slots;
}
function writeSlot(i, data) { localStorage.setItem(STORAGE_PREFIX + i, JSON.stringify(data)); }
function deleteSlot(i) { localStorage.removeItem(STORAGE_PREFIX + i); }
function doSave(i) {
  const snap = { name: "存档 " + (i + 1), time: formatNow(), desc: stateDesc(state), state: JSON.parse(JSON.stringify(state)) };
  writeSlot(i, snap);
}
function doLoad(i) {
  const raw = localStorage.getItem(STORAGE_PREFIX + i);
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    state = snap.state || freshState();
    closeModal();
    document.getElementById("select").hidden = true;
    updatePlayerAvatar();
    render();
  } catch (e) { alert("存档读取失败：" + e.message); }
}
function formatNow() {
  const d = new Date(), p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

/* ============================ 头像 / 气泡 ============================ */

function avatarEl(name) {
  const a = AVATARS[name] || { char: (name || "?").slice(0, 1), color: "#9b8a6b" };
  const d = document.createElement("div");
  d.className = "avatar"; d.style.background = a.color; d.textContent = a.char;
  return d;
}

function createBubble(m) {
  const row = document.createElement("div");
  if (m.side === "center") {
    row.className = "msg-row center";
    const d = document.createElement("div"); d.className = "bubble-text";
    const wrap = document.createElement("div");
    if (m.kind === "chapter") wrap.className = "chapter";
    else if (m.kind === "verdict") wrap.className = "verdict";
    else wrap.className = "sys";
    wrap.appendChild(d); row.appendChild(wrap);
    return { row, textEl: d };
  }
  const isRight = m.side === "right";
  row.className = "msg-row " + (isRight ? "right" : "left");
  if (!isRight && m.avatar) row.appendChild(avatarEl(m.avatar));
  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap" + (m.kind === "letter" && !m.avatar && !isRight ? " letter-wrap" : "");
  if (m.name) { const nm = document.createElement("div"); nm.className = "bubble-name"; nm.textContent = m.name; wrap.appendChild(nm); }
  const b = document.createElement("div");
  b.className = "bubble" + (isRight ? " mine" : "") + (m.kind === "letter" ? " letter" : "");
  const d = document.createElement("div"); d.className = "bubble-text";
  b.appendChild(d); wrap.appendChild(b); row.appendChild(wrap);
  if (isRight && m.avatar) row.appendChild(avatarEl(m.avatar));
  return { row, textEl: d };
}

/* ============================ 打字机 ============================ */

let typeTimer = null, typeEl = null, typeHtml = null, typeOnDone = null;

function typeInto(el, html, onDone) {
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const text = tmp.textContent || "";
  typeEl = el; typeHtml = html; typeOnDone = onDone;
  if (!text.trim()) { completeType(); return; }
  el.textContent = "";
  let i = 0;
  typeTimer = setInterval(() => {
    i = Math.min(text.length, i + 2);
    el.textContent = text.slice(0, i);
    if (i >= text.length) completeType();
  }, 22);
}
function completeType() {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  if (typeEl) typeEl.innerHTML = typeHtml;
  typeEl = null; typeHtml = null;
  const cb = typeOnDone; typeOnDone = null;
  if (cb) cb();
}

/* ============================ 消息流 ============================ */

let runner = null;
let autoTimer = null;

function renderMessages(msgs, footerHTML, footerBind, onComplete) {
  document.getElementById("chat-body").innerHTML = "";
  document.getElementById("chat-footer").innerHTML = "";
  hideHint();
  runner = { msgs, idx: 0, footerHTML: footerHTML || "", footerBind: footerBind || null, typing: false, onComplete: onComplete || null };
  revealNext();
}
function revealNext() {
  clearTimeout(autoTimer);
  if (!runner) return;
  if (runner.idx >= runner.msgs.length) { setTimeout(showFooter, 120); return; }
  const m = runner.msgs[runner.idx++];
  const item = createBubble(m);
  document.getElementById("chat-body").appendChild(item.row);
  scrollBody();
  const finish = () => {
    runner.typing = false;
    if (runner.idx < runner.msgs.length) {
      showHint();
      autoTimer = setTimeout(() => { if (!runner.typing && runner.idx < runner.msgs.length) revealNext(); }, m.delay || 820);
    } else {
      hideHint();
      autoTimer = setTimeout(showFooter, 260);
    }
  };
  if (m.instant) {
    item.textEl.innerHTML = m.html;
    finish();
  } else {
    runner.typing = true;
    typeInto(item.textEl, m.html, finish);
  }
  if (runner.idx < runner.msgs.length) showHint();
}
function onBodyTap() {
  clearTimeout(autoTimer);
  if (!runner) return;
  if (runner.typing) { completeType(); runner.typing = false; return; }
  if (runner.idx < runner.msgs.length) { revealNext(); return; }
  showFooter();
}
function showFooter() {
  clearTimeout(autoTimer);
  if (!runner || runner.footerShown) return;
  runner.footerShown = true;
  document.getElementById("chat-footer").innerHTML = runner.footerHTML;
  if (runner.footerBind) runner.footerBind();
  scrollBody();
  if (runner.onComplete) setTimeout(runner.onComplete, 700);
}
function showHint() { document.getElementById("tap-hint").hidden = false; }
function hideHint() { document.getElementById("tap-hint").hidden = true; }
function scrollBody() { const b = document.getElementById("chat-body"); b.scrollTop = b.scrollHeight; }

/* ============================ 消息构造 ============================ */

function sysMsg(text) { return { side: "center", kind: "system", html: inlineMd(text) }; }
function choiceMsg(title) { return { side: "right", avatar: state.avatar, name: state.avatar, kind: "text", html: "<p>" + inlineMd(title) + "</p>" }; }

function chapterMsg(key) {
  const c = CHAPTERS[key];
  if (!c) return null;
  return {
    side: "center", kind: "chapter", instant: true, delay: 1900,
    html: '<div class="chapter-couplet">' + escapeHtml(c.couplet) + '</div><div class="chapter-regnal">' + escapeHtml(c.regnal) + '</div>'
  };
}
function verdictMsg(lines) {
  return {
    side: "center", kind: "verdict", instant: true, delay: 1500,
    html: '<div class="verdict-text">' + lines.map(inlineMd).join("<br>") + '</div><div class="verdict-seal">赞</div>'
  };
}

function narratorMsgs(lines) {
  const msgs = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) {
      const isVerdict = quote.some((l) => /^\s*\*/.test(l));
      if (isVerdict) {
        msgs.push(verdictMsg(quote));
      } else {
        msgs.push({ side: "left", avatar: "书札", name: "书札", kind: "letter", html: quote.map(inlineMd).join("<br>") });
      }
      quote = [];
    }
  };
  for (const raw of lines) {
    const line = String(raw == null ? "" : raw);
    if (line.startsWith(">")) { quote.push(line.replace(/^>\s?/, "")); continue; }
    flushQuote();
    const t = line.trim();
    if (!t) continue;
    if (/^#{1,3}\s/.test(t)) { msgs.push(sysMsg(t.replace(/^#{1,3}\s*/, ""))); continue; }
    if (t === "---") continue;
    msgs.push({ side: "left", avatar: "案头笔录", name: "案头笔录", kind: "text", html: "<p>" + inlineMd(t) + "</p>" });
  }
  flushQuote();
  return msgs;
}

function writeMsgs(lines) {
  return [{ side: "right", avatar: state.avatar, name: state.avatar, kind: "letter", html: renderMarkdown(lines) }];
}

function advisorMsgs(lines) {
  const msgs = [];
  let name = "郑观应", action = "";
  const content = [];
  for (const raw of lines) {
    const line = String(raw == null ? "" : raw);
    const m = line.match(/^\*\*(.+?)\*\*\s*/);
    if (m) {
      const label = m[1];
      const nm = Object.keys(AVATARS).find((n) => label.indexOf(n) === 0);
      if (nm) { name = nm; action = label.slice(nm.length).replace(/[：:]$/, ""); }
      const leftover = line.slice(m[0].length).trim();
      if (leftover) content.push(leftover);
    } else content.push(line);
  }
  if (action) msgs.push(sysMsg("（" + name + action + "）"));
  if (content.length) msgs.push({ side: "left", avatar: name, name: name, kind: "text", html: '<div class="prose">' + renderMarkdown(content) + "</div>" });
  return msgs;
}

function decisionLogMsg() {
  const labels = { node1: "场景一", node2: "场景二", node3: "场景三", node4: "场景四", node5: "场景五" };
  const parts = [];
  ["node1", "node2", "node3", "node4", "node5"].forEach((id) => { if (state.choices[id]) parts.push(labels[id] + "·选" + state.choices[id]); });
  return parts.length ? sysMsg("抉择记录 " + parts.join("　")) : null;
}

/* ============================ 头部 ============================ */

function setHeader(name, sub) {
  document.getElementById("hdr-name").textContent = name;
  document.getElementById("hdr-sub").textContent = sub || "三厂合并 · 1898—1908";
}
function updatePlayerAvatar() {
  const h = document.getElementById("hdr-avatar");
  const a = AVATARS[state.avatar] || AVATARS["盛宣怀"];
  h.style.background = a.color; h.textContent = a.char;
}

/* ============================ 视图 ============================ */

function render() {
  hideHint();
  switch (state.phase) {
    case "background": renderBackground(); break;
    case "prologue": renderPrologue(); break;
    case "node": renderNode(); break;
    case "interlude": renderInterlude(); break;
    case "ending": renderEnding(); break;
    default: showSelect();
  }
}

function renderBackground() {
  setHeader("时代背景", "1896 · 甲午战败后");
  const msgs = narratorMsgs(DATA.background.text);
  const footer = {
    html: '<div class="cta-row"><button class="btn btn-primary" id="bg-start">进入序幕</button></div>',
    bind: () => { document.getElementById("bg-start").onclick = () => { state.phase = "prologue"; state.sceneIndex = 0; render(); }; }
  };
  renderMessages(msgs, footer.html, footer.bind);
}

function renderPrologue() {
  const scenes = DATA.prologue.scenes;
  const i = state.sceneIndex;
  const sc = scenes[i];
  const isLast = i >= scenes.length - 1;
  setHeader("序幕 · 客厅之外", sc.title);
  const msgs = [];
  const ch = chapterMsg("prologue");
  if (ch) msgs.push(ch);
  msgs.push(...narratorMsgs(sc.text));
  const footer = {
    html: '<div class="cta-row"><button class="btn btn-primary" id="pro-next">' + (isLast ? "前往场景一" : "继续") + "</button></div>",
    bind: () => { document.getElementById("pro-next").onclick = () => {
      if (isLast) { state.phase = "node"; state.nodeId = "node1"; state.optionId = null; }
      else state.sceneIndex++;
      render();
    }; }
  };
  renderMessages(msgs, footer.html, footer.bind);
}

function renderInterlude() {
  const it = DATA.interludes[state.interludeId];
  const i = state.sceneIndex;
  const sc = it.scenes[i];
  const isLast = i >= it.scenes.length - 1;
  setHeader(it.title, sc.title);
  const msgs = [];
  const ch = chapterMsg(state.interludeId);
  if (ch) msgs.push(ch);
  msgs.push(...narratorMsgs(sc.text));
  const footer = {
    html: '<div class="cta-row"><button class="btn btn-primary" id="it-next">' + (isLast ? "进入下一场景" : "继续") + "</button></div>",
    bind: () => { document.getElementById("it-next").onclick = () => {
      if (isLast) { state.phase = "node"; state.nodeId = it.next; state.optionId = null; }
      else state.sceneIndex++;
      render();
    }; }
  };
  renderMessages(msgs, footer.html, footer.bind);
}

function renderNode() {
  const node = getNode(state.nodeId);
  if (state.optionId) {
    const opt = node.options.find((o) => o.id === state.optionId);
    if (opt) { renderOptionResult(node, opt); return; }
  }
  setHeader(node.title, node.time + " · " + node.tag);
  const msgs = [];
  const ch = chapterMsg(node.id);
  if (ch) msgs.push(ch);
  const log = decisionLogMsg();
  if (log) msgs.push(log);
  msgs.push(...narratorMsgs(node.situation));
  let footer = { html: "", bind: () => {} };
  if (node.options.length) {
    footer = nodeFooter(node);
  } else {
    footer = {
      html: '<div class="cta-row"><button class="btn btn-primary" id="node6-ending">查看终局结算</button></div>',
      bind: () => { document.getElementById("node6-ending").onclick = () => { state.phase = "ending"; state.endingId = "A"; render(); }; }
    };
  }
  renderMessages(msgs, footer.html, footer.bind);
}

function nodeFooter(node) {
  const opts = node.options.map((o) => {
    const mk = o.marker === "history" ? '<span class="mk mk-h">★</span>'
      : o.marker === "retry" ? '<span class="mk mk-r">🔄</span>'
      : '<span class="mk mk-l">⚠️</span>';
    return '<button class="quick" data-opt="' + o.id + '">' + mk + "<span>" + escapeHtml(o.title) + "</span></button>";
  }).join("");
  const html = '<div class="quick-list">' + opts + "</div>" + aiInputBar();
  const bind = () => {
    node.options.forEach((o) => {
      const el = document.querySelector('[data-opt="' + o.id + '"]');
      if (el) el.onclick = () => onSelectOption(node, o);
    });
    bindAI(node);
  };
  return { html, bind };
}

function renderOptionResult(node, opt) {
  setHeader(node.title, "选项 " + opt.letter);
  const msgs = [];
  msgs.push(choiceMsg(opt.title));
  msgs.push(...writeMsgs(opt.write));
  msgs.push(...advisorMsgs(opt.advisor));

  if (opt.resultType === "failure") {
    msgs.push(sysMsg(opt.failure.title.replace(/^■\s*/, "")));
    msgs.push(...narratorMsgs(opt.failure.text));
    renderMessages(msgs, "", null, () => showFailureOutcome(opt));
  } else if (opt.resultType === "advance") {
    const adv = opt.advance;
    if (adv.note) msgs.push(sysMsg(adv.note.replace(/\*\*/g, "")));
    if (adv.text && adv.text.length) msgs.push(...narratorMsgs(adv.text));
    const footer = {
      html: '<div class="cta-row"><button class="btn btn-primary" id="opt-next">继续 →</button></div>',
      bind: () => { document.getElementById("opt-next").onclick = () => {
        const nx = adv.next;
        if (nx && nx.indexOf("interlude-") === 0) { state.phase = "interlude"; state.interludeId = nx; state.sceneIndex = 0; state.optionId = null; }
        else if (nx && nx.indexOf("node") === 0) { state.phase = "node"; state.nodeId = nx; state.optionId = null; }
        render();
      }; }
    };
    renderMessages(msgs, footer.html, footer.bind);
  } else if (opt.resultType === "ending") {
    msgs.push(sysMsg(opt.endingNarrative.title.replace(/^■\s*/, "")));
    msgs.push(...narratorMsgs(opt.endingNarrative.text));
    const footer = {
      html: '<div class="cta-row"><button class="btn btn-primary" id="opt-ending">查看终局结算</button></div>',
      bind: () => { document.getElementById("opt-ending").onclick = () => { state.phase = "ending"; state.endingId = opt.endingId; state.optionId = null; render(); }; }
    };
    renderMessages(msgs, footer.html, footer.bind);
  }
}

function onSelectOption(node, opt) {
  const commit = () => {
    if (opt.resultType === "advance" || opt.resultType === "ending") state.choices[node.id] = opt.letter;
    state.optionId = opt.id;
    render();
  };
  if (opt.marker === "lock") {
    confirmDialog("这是不可回退的方向性抉择，选定后将锁定结局，无法回头。\n\n「" + opt.title + "」\n\n确定要做此决定吗？", "确定，不再回头", "再想想")
      .then((ok) => { if (ok) commit(); });
  } else commit();
}

function renderEnding() {
  const e = getEnding(state.endingId);
  if (!e) { showSelect(); return; }
  const isA = e.id === "A";
  showOutcome({
    stamp: isA ? "成" : "覆",
    kind: "终局 · " + e.basisLabel,
    title: e.title,
    bad: !isA,
    bodyHTML: '<div class="prose">' + renderMarkdown(e.text) + '</div>' +
      '<div class="outcome-route">达成路径：' + escapeHtml(e.route) + '</div>' +
      '<div class="outcome-basis">历史依据说明：' + escapeHtml(e.basis) + '</div>',
    actions: [
      ["重新开始", "btn-primary", showSelect],
      ["历史对照", "", showHistory],
      ["结局路线表", "", showRoute]
    ]
  });
}

/* ============================ 结局 / 失败 全屏 ============================ */

function showOutcome({ stamp, kind, title, bodyHTML, actions, bad }) {
  const el = document.getElementById("outcome");
  el.className = "fullscreen outcome" + (bad ? " bad" : "");
  document.getElementById("outcome-stamp").textContent = stamp;
  document.getElementById("outcome-kind").textContent = kind;
  document.getElementById("outcome-title").textContent = title;
  document.getElementById("outcome-body").innerHTML = bodyHTML || "";
  const actBox = document.getElementById("outcome-actions");
  actBox.innerHTML = "";
  (actions || []).forEach(([label, cls, fn]) => {
    const b = document.createElement("button");
    b.className = "btn " + (cls || "");
    b.textContent = label;
    b.onclick = fn;
    actBox.appendChild(b);
  });
  el.hidden = false;
}
function hideOutcome() { document.getElementById("outcome").hidden = true; }

function showFailureOutcome(opt) {
  const title = opt.failure.title.replace(/^■\s*/, "");
  let summary = "";
  for (const l of opt.failure.text) {
    const m = String(l).match(/【(.+?)】/);
    if (m) { summary = m[1].replace(/^结局[：:]\s*/, ""); break; }
  }
  showOutcome({
    stamp: "败",
    kind: "结局",
    title: title,
    bad: true,
    bodyHTML: summary ? '<div style="text-align:center;font-size:17px;">' + escapeHtml(summary) + "</div>" : "",
    actions: [
      ["🔄 回退，重新选择", "btn-primary", () => { hideOutcome(); state.optionId = null; render(); }]
    ]
  });
}

/* ============================ 选角 / 标题 ============================ */

function showSelect() {
  state = freshState();
  hideOutcome();
  document.getElementById("select").hidden = false;
  const grid = document.getElementById("select-grid");
  grid.innerHTML = "";
  DATA.characters.forEach((c) => {
    const a = AVATARS[c.name] || { char: c.name.slice(0, 1), color: "#9b8a6b" };
    const el = document.createElement("div");
    el.className = "select-char" + (c.name === selectedAvatar ? " sel" : "");
    el.innerHTML = '<div class="avatar" style="background:' + a.color + '">' + escapeHtml(a.char) + '</div><div class="cname">' + escapeHtml(c.name) + "</div>";
    el.onclick = () => {
      selectedAvatar = c.name;
      grid.querySelectorAll(".select-char").forEach((x) => x.classList.remove("sel"));
      el.classList.add("sel");
    };
    grid.appendChild(el);
  });
  document.getElementById("select-confirm").onclick = startGame;
}

function startGame() {
  state = freshState();
  state.avatar = selectedAvatar;
  state.phase = "prologue";
  document.getElementById("select").hidden = true;
  updatePlayerAvatar();
  showIntro();
}

function showIntro() {
  const bg = DATA.background;
  document.getElementById("scroll-text").textContent = bg.text.join("\n");
  document.getElementById("intro").hidden = false;
  document.getElementById("intro-skip").onclick = () => {
    document.getElementById("intro").hidden = true;
    state.phase = "prologue"; state.sceneIndex = 0;
    render();
  };
}

/* ============================ AI 幕僚 ============================ */

function aiInputBar() {
  return '<div class="ai-row">' +
    '<textarea class="ai-input" id="ai-input" rows="1" placeholder="写下你的决策意图，AI 帮你润色成盛宣怀口吻…"></textarea>' +
    '<button class="btn-send" id="ai-send">润色</button>' +
    "</div>";
}

function bindAI(node) {
  const input = document.getElementById("ai-input");
  const send = document.getElementById("ai-send");
  if (!input || !send) return;
  const doAsk = async () => {
    const msg = input.value.trim();
    if (!msg) { input.focus(); return; }
    input.value = "";
    input.style.height = "auto";
    appendPlayerBubble(msg);
    const typing = appendTyping();
    const r = await askAI(msg, node);
    typing.remove();
    if (r.source === "fallback") {
      appendAdvisorBubble(r.reply, r.note);
    } else {
      appendOptimized(r);
    }
    state.aiLog = state.aiLog || [];
    state.aiLog.push({ role: "player", text: msg });
    while (state.aiLog.length > 60) state.aiLog.shift();
  };
  send.onclick = doAsk;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAsk(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(90, input.scrollHeight) + "px"; });
}

function appendPlayerBubble(text) { appendLive({ side: "right", avatar: state.avatar, name: state.avatar, kind: "text", html: "<p>" + inlineMd(text) + "</p>" }); }
function appendAdvisorBubble(html, note) {
  appendLive({ side: "left", avatar: "郑观应", name: "郑观应", kind: "text", html: '<div class="prose">' + renderMarkdown([html]) + "</div>" });
  if (note) appendLive(sysMsg(note));
}
function appendOptimized(r) {
  if (r.wording) {
    const html = String(r.wording).split("\n").filter(Boolean).map(inlineMd).join("<br>");
    appendLive({ side: "left", avatar: "书札", name: "盛宣怀 · 优化说辞", kind: "letter", html: html });
  }
  if (r.vernacular) appendLive(sysMsg("白话：" + r.vernacular));
  if (r.matched) appendLive(sysMsg("此意最接近选项 " + r.matched));
}
function appendTyping() {
  const a = AVATARS["郑观应"];
  const row = document.createElement("div");
  row.className = "msg-row left";
  row.innerHTML = '<div class="avatar" style="background:' + a.color + '">' + escapeHtml(a.char) + '</div>' +
    '<div class="bubble-wrap"><div class="bubble-name">盛宣怀</div>' +
    '<div class="bubble"><div class="bubble-text typing-dots"><span></span><span></span><span></span></div></div></div>';
  document.getElementById("chat-body").appendChild(row);
  scrollBody();
  return row;
}
function appendLive(m) {
  const item = createBubble(m);
  item.textEl.innerHTML = m.html;
  document.getElementById("chat-body").appendChild(item.row);
  scrollBody();
}

/* 收集盛宣怀本人的书信引语作为「语料」，供 AI 参考文风 */
function buildCorpus() {
  const quotes = [];
  for (const n of DATA.nodes) {
    for (const o of (n.options || [])) {
      for (const line of (o.write || [])) {
        const s = String(line).replace(/^>\s?/, "").trim();
        if (s.indexOf("「") === 0 && s.length < 90) quotes.push(s);
      }
    }
  }
  const seen = new Set();
  return quotes.filter((q) => (seen.has(q) ? false : (seen.add(q), true))).slice(0, 6);
}

async function askAI(message, node) {
  const payload = {
    intent: message,
    nodeTitle: node.title,
    situation: node.situation.join("\n"),
    options: (node.options || []).map((o) => o.title),
    corpus: buildCorpus()
  };
  try {
    const res = await fetch(AI_BACKEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && (data.wording || data.raw)) return Object.assign({ source: "ai" }, data);
    throw new Error("no reply");
  } catch (e) {
    return { source: "fallback", reply: fallbackReply(node, message), note: "AI 后端未接入或调用失败，已使用预设回应。" };
  }
}

function fallbackReply(node, message) {
  const hist = node.options.find((o) => o.marker === "history") || node.options[node.options.length - 1];
  const titles = node.options.map((o) => "「" + o.title + "」").join("、");
  return "（郑观应拱手）大人所议「" + truncate(message, 28) + "」，观应已谨记在心。眼下不过" + titles + "数端。以观应愚见，" +
    hist.title + " 一条最为妥当——既不误眼前之急，亦为长远留有余地。然大局在大人，还请权衡利害，再作决断。";
}

/* ============================ 菜单 / 弹窗 ============================ */

function openSheet() {
  const items = [
    ["保存游戏", () => openSave("save")],
    ["读取存档", () => openSave("load")],
    ["时代背景", showBackgroundInfo],
    ["玩法说明", showRules],
    ["人物志", showCast],
    ["历史对照", showHistory],
    ["结局路线表", showRoute],
    ["重新开始", () => confirmDialog("确定要放弃当前进度，重新开始吗？", "重新开始", "取消").then((ok) => { if (ok) showSelect(); })]
  ];
  const list = document.getElementById("sheet-list");
  list.innerHTML = "";
  items.forEach(([label, fn]) => {
    const b = document.createElement("button");
    b.className = "sheet-item" + (label === "重新开始" ? " danger" : "");
    b.textContent = label;
    b.onclick = () => { hideSheet(); fn(); };
    list.appendChild(b);
  });
  document.getElementById("sheet").hidden = false;
}
function hideSheet() { document.getElementById("sheet").hidden = true; }

function openModal(title, bodyHTML) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  document.querySelector(".modal-actions").innerHTML = '<button class="btn btn-ghost" data-close>关闭</button>';
  bindDataClose();
  document.getElementById("modal").hidden = false;
}
function closeModal() { document.getElementById("modal").hidden = true; }

function openSave(mode) {
  const slots = readSlots();
  const box = document.createElement("div");
  box.className = "save-slots";
  slots.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "save-slot" + (s ? "" : " empty");
    if (s) {
      div.innerHTML = '<div class="slot-info"><div class="slot-name">' + escapeHtml(s.name) + "</div>" +
        '<div class="slot-desc">' + escapeHtml(s.desc || "") + '</div><div class="slot-time">' + escapeHtml(s.time || "") + "</div></div><div class=\"slot-actions\"></div>";
      const acts = div.querySelector(".slot-actions");
      if (mode === "save") {
        const b1 = document.createElement("button"); b1.className = "btn btn-ghost"; b1.textContent = "覆盖"; b1.onclick = () => { doSave(i); openSave("save"); };
        acts.appendChild(b1);
        const b2 = document.createElement("button"); b2.className = "btn btn-ghost"; b2.textContent = "删除"; b2.onclick = () => { deleteSlot(i); openSave("save"); };
        acts.appendChild(b2);
      } else {
        const b1 = document.createElement("button"); b1.className = "btn"; b1.textContent = "读取"; b1.onclick = () => doLoad(i);
        acts.appendChild(b1);
      }
    } else {
      div.innerHTML = '<span class="slot-info"><span class="slot-desc">（空存档位）</span></span><div class="slot-actions"></div>';
      if (mode === "save") {
        const b = document.createElement("button"); b.className = "btn"; b.textContent = "存到此处"; b.onclick = () => { doSave(i); openSave("save"); };
        div.querySelector(".slot-actions").appendChild(b);
      }
    }
    box.appendChild(div);
  });
  openModal(mode === "save" ? "保存游戏" : "读取存档", box.outerHTML);
}

function confirmDialog(msg, yesLabel, noLabel) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.innerHTML = '<div class="modal-card"><div class="modal-title">请三思</div>' +
      '<div class="modal-body"><div class="prose"><p>' + escapeHtml(msg).replace(/\n/g, "<br>") + "</p></div></div>" +
      '<div class="modal-actions" style="display:flex;gap:10px;justify-content:flex-end;">' +
      '<button class="btn btn-ghost" data-no>' + escapeHtml(noLabel || "再想想") + '</button>' +
      '<button class="btn btn-primary" data-yes>' + escapeHtml(yesLabel || "确定") + '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector("[data-yes]").onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector("[data-no]").onclick = () => { overlay.remove(); resolve(false); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

/* ============================ 信息弹窗 ============================ */

function showRules() {
  const r = DATA.rules;
  const items = r.items.map((it) => "<p>" + inlineMd(it) + "</p>").join("");
  const markers = r.markers.map((m) => "<tr><td><strong>" + escapeHtml(m.symbol + " " + m.label) + "</strong></td><td>" + escapeHtml(m.desc) + "</td></tr>").join("");
  openModal("玩法说明", '<div class="prose">' + items + '</div><table class="marker-table"><thead><tr><th>标识</th><th>含义</th></tr></thead><tbody>' + markers + "</tbody></table>");
}
function showCast() {
  const cards = DATA.characters.map((c) =>
    '<div class="cast-card"><span class="cast-name">' + escapeHtml(c.name) + '</span><span class="cast-role">' + escapeHtml(c.role) + "</span>" +
    '<div class="cast-intro">' + escapeHtml(c.intro) + "</div></div>"
  ).join("");
  openModal("人物志 · 角色介绍", '<div class="cast-grid">' + cards + "</div>");
}
function showHistory() {
  openModal(DATA.historyCard.title, '<pre class="history-card">' + escapeHtml(DATA.historyCard.lines.join("\n")) + "</pre>");
}
function showRoute() {
  const rt = DATA.routeTable;
  const rows = rt.rows.map((r) => "<tr><td>" + escapeHtml(r.node3) + "</td><td>" + escapeHtml(r.node4) + "</td><td>" + escapeHtml(r.node5) + "</td><td><strong>" + escapeHtml(r.ending) + "</strong></td><td>" + escapeHtml(r.basis) + "</td></tr>").join("");
  openModal(rt.title, '<table class="route-table"><thead><tr><th>场景三</th><th>场景四</th><th>场景五</th><th>触发结局</th><th>依据</th></tr></thead><tbody>' + rows + "</tbody></table>");
}
function showBackgroundInfo() {
  const bg = DATA.background;
  const tl = bg.timeline.map((t) => '<div class="tl-row"><span class="tl-year">' + escapeHtml(t.year) + "</span><span>" + escapeHtml(t.event) + "</span></div>").join("");
  openModal("时代背景", '<div class="prose">' + renderMarkdown(bg.text) + '</div><div class="timeline">' + tl + "</div>" +
    '<pre class="relations">' + escapeHtml(bg.relations) + "</pre>");
}

/* ============================ 绑定 / 启动 ============================ */

function bindDataClose() {
  document.querySelectorAll("[data-close]").forEach((b) => { b.onclick = () => { hideSheet(); closeModal(); }; });
}

function bindGlobals() {
  document.getElementById("hdr-more").onclick = openSheet;
  document.getElementById("hdr-avatar").onclick = openSheet;
  document.getElementById("chat-body").addEventListener("click", onBodyTap);
  document.getElementById("modal").addEventListener("click", (e) => { if (e.target === document.getElementById("modal")) closeModal(); });
  bindDataClose();
}

async function init() {
  try {
    const res = await fetch("../data/gameData.json");
    DATA = await res.json();
  } catch (e) {
    document.getElementById("select").hidden = true;
    document.getElementById("chat-body").innerHTML = '<div class="sys"><div class="bubble-text">游戏数据加载失败：' + escapeHtml(e.message) + "</div></div>";
    return;
  }
  bindGlobals();
  showSelect();
}

init();
