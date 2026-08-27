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
const AUTO_KEY = STORAGE_PREFIX + "auto";
let IMMERSION_AUTO = true;
let immAutoTimer = null;

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
    mode: "negotiation", // negotiation（模拟谈判）| immersion（剧情沉浸）
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

function modeLabel() { return state.mode === "immersion" ? "剧情沉浸" : "模拟谈判"; }

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
  const snap = {
    name: modeLabel() + " · " + stateDesc(state),
    time: formatNow(),
    desc: stateDesc(state),
    mode: state.mode || "negotiation",
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
    state.mode = state.mode || "negotiation";
    closeModal();
    document.getElementById("select").hidden = true;
    document.getElementById("catalog").hidden = true;
    updatePlayerAvatar();
    render();
  } catch (e) { alert("存档读取失败：" + e.message); }
}
function autosave() {
  if (!state || state.phase === "select" || state.phase === "background") return;
  const snap = {
    name: "自动存档",
    time: formatNow(),
    desc: modeLabel() + " · " + stateDesc(state),
    mode: state.mode || "negotiation",
    state: JSON.parse(JSON.stringify(state))
  };
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(snap)); } catch (e) {}
}
function readAuto() {
  try { const raw = localStorage.getItem(AUTO_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function isCleared(mode) { try { return localStorage.getItem("sxh_cleared_" + mode) === "1"; } catch (e) { return false; } }
function markCleared(mode) { try { localStorage.setItem("sxh_cleared_" + mode, "1"); } catch (e) {} }
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
    i = Math.min(text.length, i + 1);
    el.textContent = text.slice(0, i);
    if (i >= text.length) completeType();
  }, 42);
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
      autoTimer = setTimeout(() => { if (!runner.typing && runner.idx < runner.msgs.length) revealNext(); }, m.delay || 1500);
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
  clearTimeout(immAutoTimer);
  document.querySelector(".app").classList.remove("is-hidden");
  autosave();
  updateImmAuto();
  switch (state.phase) {
    case "background": renderBackground(); break;
    case "prologue": renderPrologue(); break;
    case "node": state.mode === "immersion" ? renderImmersionNode() : renderNode(); break;
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
  renderMessages(msgs, footer.html, footer.bind, immersionAutoComplete());
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
  renderMessages(msgs, footer.html, footer.bind, immersionAutoComplete());
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

function getHistoryOption(node) {
  return node.options.find((o) => o.marker === "history") || node.options[0];
}

function finishImmersion(msgs, footer) {
  renderMessages(msgs, footer.html, footer.bind, () => {
    if (IMMERSION_AUTO) {
      clearTimeout(immAutoTimer);
      immAutoTimer = setTimeout(() => { if (footer.auto) footer.auto(); }, 2600);
    }
  });
}

function immersionAutoComplete() {
  if (state.mode !== "immersion" || !IMMERSION_AUTO) return null;
  return () => {
    clearTimeout(immAutoTimer);
    immAutoTimer = setTimeout(() => {
      const btn = document.querySelector("#chat-footer .btn");
      if (btn) btn.click();
    }, 2600);
  };
}

function renderImmersionNode() {
  const node = getNode(state.nodeId);
  if (!node) { showCatalog(); return; }
  setHeader(node.title, "剧情沉浸 · " + node.time);
  const msgs = [];
  const ch = chapterMsg(node.id);
  if (ch) msgs.push(ch);
  msgs.push(...narratorMsgs(node.situation));

  if (!node.options.length) {
    const onNext = () => { state.phase = "ending"; state.endingId = "A"; render(); };
    finishImmersion(msgs, {
      html: '<div class="cta-row"><button class="btn btn-primary" id="imm-next">查看终局结算</button></div>',
      bind: () => { document.getElementById("imm-next").onclick = () => { clearTimeout(immAutoTimer); onNext(); }; },
      auto: onNext
    });
    return;
  }

  const opt = getHistoryOption(node);
  msgs.push(sysMsg("—— 史实抉择 · 盛宣怀 ——"));
  msgs.push(choiceMsg(opt.title));
  msgs.push(...writeMsgs(opt.write));
  msgs.push(...advisorMsgs(opt.advisor));

  let onNext;
  if (opt.resultType === "advance") {
    const adv = opt.advance;
    if (adv.note) msgs.push(sysMsg(adv.note.replace(/\*\*/g, "")));
    if (adv.text && adv.text.length) msgs.push(...narratorMsgs(adv.text));
    onNext = () => {
      const nx = adv.next;
      if (nx && nx.indexOf("interlude-") === 0) { state.phase = "interlude"; state.interludeId = nx; state.sceneIndex = 0; }
      else if (nx && nx.indexOf("node") === 0) { state.phase = "node"; state.nodeId = nx; }
      render();
    };
  } else if (opt.resultType === "ending") {
    msgs.push(sysMsg(opt.endingNarrative.title.replace(/^■\s*/, "")));
    msgs.push(...narratorMsgs(opt.endingNarrative.text));
    onNext = () => { state.phase = "ending"; state.endingId = opt.endingId; render(); };
  } else {
    onNext = () => { showCatalog(); };
  }

  finishImmersion(msgs, {
    html: '<div class="cta-row"><button class="btn btn-primary" id="imm-next">继续 →</button></div>',
    bind: () => { document.getElementById("imm-next").onclick = () => { clearTimeout(immAutoTimer); onNext(); }; },
    auto: onNext
  });
}

function renderEnding() {
  const e = getEnding(state.endingId);
  if (!e) { showCatalog(); return; }
  const isA = e.id === "A";
  if (isA) markCleared(state.mode);
  showOutcome({
    stamp: isA ? "成" : "覆",
    kind: "终局 · " + e.basisLabel,
    title: e.title,
    bad: !isA,
    bodyHTML: '<div class="prose">' + renderMarkdown(e.text) + '</div>' +
      '<div class="outcome-route">达成路径：' + escapeHtml(e.route) + '</div>' +
      '<div class="outcome-basis">历史依据说明：' + escapeHtml(e.basis) + '</div>',
    actions: [
      ["返回目录", "btn-primary", showCatalog],
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
  document.getElementById("select-confirm").onclick = showCatalog;
  document.querySelector(".app").classList.add("is-hidden");
}

function startNegotiation() {
  state = freshState();
  state.mode = "negotiation";
  state.avatar = "盛宣怀";
  state.phase = "prologue";
  document.getElementById("catalog").hidden = true;
  updatePlayerAvatar();
  showIntro();
}
function startImmersion() {
  state = freshState();
  state.mode = "immersion";
  state.avatar = "盛宣怀";
  state.phase = "prologue";
  document.getElementById("catalog").hidden = true;
  updatePlayerAvatar();
  showIntro();
}
function restartMode() {
  if (state.mode === "immersion") startImmersion();
  else startNegotiation();
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

/* ============================ 目录 ============================ */

const CATALOG_ITEMS = [
  { id: "negotiation", chapter: "模拟谈判", tag: "谈判", tagClass: "seal", title: "三厂合并 · 十年经营", subtitle: "六个决策场景 · 七种结局", tagline: "自由表达 · AI辅助 · 上桌博弈", desc: "扮演盛宣怀，与对手当面博弈。用你自己的话谈条件，AI幕僚会为你递上锦囊。", locked: false, onEnter: startNegotiation },
  { id: "immersion", chapter: "剧情沉浸", tag: "剧情", tagClass: "brown", title: "汉冶萍十年风云", subtitle: "沿史实方向 · 自动展卷", tagline: "无抉择 · 无AI · 静观史实", desc: "进入一段真实历史故事。剧情沿盛宣怀的真实抉择自动展开，静观十年兴衰。", locked: false, onEnter: startImmersion },
  { id: "preview", chapter: "更新预告", tag: "筹备中", tagClass: "gray", title: "新章筹备中", subtitle: "轮船招商局收购旗昌案", tagline: "敬请期待", desc: "", locked: true },
  { id: "manual", chapter: "玩家手册", tag: "手册", tagClass: "gray", title: "玩法 · 人物 · 背景", subtitle: "常驻入口", tagline: "", desc: "", locked: false, onEnter: openManual }
];

function showCatalog() {
  hideOutcome();
  document.getElementById("select").hidden = true;
  document.getElementById("intro").hidden = true;
  document.getElementById("catalog").hidden = false;
  document.querySelector(".app").classList.add("is-hidden");
  renderCatalog();
}

function renderCatalog() {
  const list = document.getElementById("catalog-list");
  list.innerHTML = "";
  const resume = document.getElementById("catalog-resume");
  const auto = readAuto();
  if (auto) {
    resume.innerHTML = '<button class="catalog-resume-btn" id="catalog-resume-btn">继续上次进度<span>' + escapeHtml(auto.desc || "") + '</span></button>';
    resume.style.display = "block";
    document.getElementById("catalog-resume-btn").onclick = () => doLoadAuto(auto);
  } else {
    resume.innerHTML = "";
    resume.style.display = "none";
  }

  CATALOG_ITEMS.forEach((item) => {
    const card = document.createElement("div");
    card.className = "catalog-card" + (item.locked ? " locked" : "");
    const cleared = !item.locked && isCleared(item.id);
    card.innerHTML =
      '<div class="card-bar">' +
        '<span class="card-chapter">' + escapeHtml(item.chapter) + '</span>' +
        '<span class="card-tag ' + escapeHtml(item.tagClass) + '">' + escapeHtml(item.tag) + '</span>' +
        (cleared ? '<span class="card-clear">阅</span>' : '') +
      '</div>' +
      '<div class="card-body"><div class="card-inner">' +
        '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="card-subtitle">' + escapeHtml(item.subtitle) + '</div>' +
        (item.tagline ? '<div class="card-tagline">' + escapeHtml(item.tagline) + '</div>' : '') +
        (item.desc ? '<div class="card-desc">' + escapeHtml(item.desc) + '</div>' : '') +
        (item.locked ? '' : '<button class="card-enter ' + (item.tagClass === "brown" ? "brown" : "") + '">进入</button>') +
      '</div></div>';
    card.querySelector(".card-bar").onclick = () => {
      if (item.locked) { shakeCard(card); return; }
      const wasOpen = card.classList.contains("open");
      document.querySelectorAll(".catalog-card.open").forEach((c) => c.classList.remove("open"));
      if (!wasOpen) card.classList.add("open");
    };
    const enter = card.querySelector(".card-enter");
    if (enter) enter.onclick = () => { if (item.onEnter) item.onEnter(); };
    list.appendChild(card);
  });
}

function doLoadAuto(snap) {
  if (!snap) return;
  state = snap.state || freshState();
  state.mode = state.mode || "negotiation";
  document.getElementById("catalog").hidden = true;
  updatePlayerAvatar();
  render();
}

function openManual() {
  const body = '<div class="manual-entries">' +
    '<button class="btn manual-entry" id="manual-rules">玩法说明</button>' +
    '<button class="btn manual-entry" id="manual-cast">人物志</button>' +
    '<button class="btn manual-entry" id="manual-bg">时代背景</button></div>';
  openModal("玩家手册", body);
  document.getElementById("manual-rules").onclick = () => { closeModal(); showRules(); };
  document.getElementById("manual-cast").onclick = () => { closeModal(); showCast(); };
  document.getElementById("manual-bg").onclick = () => { closeModal(); showBackgroundInfo(); };
}

function shakeCard(card) {
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
  toast("新章筹备中 · 敬请期待");
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 320); }, 1600);
}

function updateImmAuto() {
  const b = document.getElementById("imm-auto");
  if (!b) return;
  const show = state && state.mode === "immersion" && state.phase !== "select";
  b.hidden = !show;
  b.textContent = IMMERSION_AUTO ? "自动 ▸" : "手动 ▸";
  b.classList.toggle("off", !IMMERSION_AUTO);
}

/* ============================ AI 幕僚 ============================ */

function aiInputBar() {
  return '<div class="ai-row">' +
    '<textarea class="ai-input" id="ai-input" rows="1" placeholder="写下你的决策想法，AI 判断对应哪条路…"></textarea>' +
    '<button class="btn-send" id="ai-send">判断</button>' +
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
    } else if (r.matched) {
      const opt = node.options.find((o) => o.letter === r.matched);
      if (opt) {
        appendLive(sysMsg("（你的想法最接近选项 " + r.matched + "）"));
        setTimeout(() => onSelectOption(node, opt), 450);
      } else {
        appendAdvisorBubble(r.advice || "未能判断，请换个说法。", null);
      }
    } else {
      appendAdvisorBubble(r.advice || "你的想法与三条路都不太相符，请重新表述。", null);
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

async function askAI(message, node) {
  const payload = {
    current_node: node.id,
    query: message
  };
  try {
    const res = await fetch(AI_BACKEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (data && data.raw) return Object.assign({ source: "ai" }, data);
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
    ["返回目录", () => showCatalog()],
    ["时代背景", showBackgroundInfo],
    ["玩法说明", showRules],
    ["人物志", showCast],
    ["历史对照", showHistory],
    ["结局路线表", showRoute],
    ["重新开始", () => confirmDialog("确定要放弃当前进度，重新开始吗？", "重新开始", "取消").then((ok) => { if (ok) restartMode(); })]
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
  const title = mode === "save" ? "保存游戏" : "读取存档";
  let html = '<div class="save-slots">';
  slots.forEach((s, i) => {
    if (s) {
      const modeName = s.mode === "immersion" ? "剧情沉浸" : "模拟谈判";
      html += '<div class="save-slot">' +
        '<div class="slot-info"><div class="slot-head"><span class="slot-name">' + escapeHtml(s.name) + '</span><span class="slot-mode">' + escapeHtml(modeName) + '</span></div>' +
        '<div class="slot-desc">' + escapeHtml(s.desc || "") + '</div><div class="slot-time">' + escapeHtml(s.time || "") + '</div></div>' +
        '<div class="slot-actions">' +
        (mode === "save"
          ? '<button class="btn btn-ghost" data-save="overwrite" data-slot="' + i + '">覆盖</button><button class="btn btn-ghost" data-save="delete" data-slot="' + i + '">删除</button>'
          : '<button class="btn" data-save="load" data-slot="' + i + '">读取</button>') +
        '</div></div>';
    } else {
      html += '<div class="save-slot empty"><span class="slot-info"><span class="slot-desc">（空存档位）</span></span><div class="slot-actions">' +
        (mode === "save" ? '<button class="btn" data-save="new" data-slot="' + i + '">存到此处</button>' : '') +
        '</div></div>';
    }
  });
  html += '</div>';
  openModal(title, html);
  // 关键：openModal 用 innerHTML 渲染会丢掉 DOM 上的 onclick，这里用 data-* 属性 + 重新绑定
  document.querySelectorAll("#modal-body [data-save]").forEach((btn) => {
    btn.onclick = () => {
      const slot = Number(btn.getAttribute("data-slot"));
      const action = btn.getAttribute("data-save");
      if (action === "new") { doSave(slot); openSave(mode); }
      else if (action === "overwrite") { confirmDialog("覆盖存档位 " + (slot + 1) + " 吗？原进度将被替换。", "覆盖", "取消").then((ok) => { if (ok) { doSave(slot); openSave(mode); } }); }
      else if (action === "delete") { confirmDialog("删除存档位 " + (slot + 1) + " 吗？此操作不可恢复。", "删除", "取消").then((ok) => { if (ok) { deleteSlot(slot); openSave(mode); } }); }
      else if (action === "load") { doLoad(slot); }
    };
  });
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
  const sections = (r.sections || []).map((s) =>
    '<h3>' + escapeHtml(s.title) + '</h3><div class="prose">' + s.items.map((it) => "<p>" + inlineMd(it) + "</p>").join("") + "</div>"
  ).join("");
  const markers = r.markers.map((m) => "<tr><td><strong>" + escapeHtml(m.symbol + " " + m.label) + "</strong></td><td>" + escapeHtml(m.desc) + "</td></tr>").join("");
  openModal("玩法说明", sections + '<table class="marker-table"><thead><tr><th>标识</th><th>含义</th></tr></thead><tbody>' + markers + "</tbody></table>");
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
  const mermaidCode = bg.mermaid || bg.relations;
  openModal("时代背景", '<div class="prose">' + renderMarkdown(bg.text) + '</div><div class="timeline">' + tl + "</div>" +
    '<h3>角色关系速查图</h3><div id="mermaid-box" class="mermaid-box"></div>');
  renderMermaid(mermaidCode, document.getElementById("mermaid-box"));
}

function renderMermaid(code, box) {
  if (!box) return;
  if (!window.mermaid) {
    box.innerHTML = '<pre class="relations">' + escapeHtml(code) + "</pre>";
    return;
  }
  try {
    window.mermaid.initialize({ startOnLoad: false, theme: "base" });
    window.mermaid.render("m-" + Date.now(), code).then((r) => {
      box.innerHTML = r.svg;
    }).catch(() => {
      box.innerHTML = '<pre class="relations">' + escapeHtml(code) + "</pre>";
    });
  } catch (e) {
    box.innerHTML = '<pre class="relations">' + escapeHtml(code) + "</pre>";
  }
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
  const ia = document.getElementById("imm-auto");
  if (ia) ia.onclick = () => { IMMERSION_AUTO = !IMMERSION_AUTO; clearTimeout(immAutoTimer); updateImmAuto(); };
  const cb = document.getElementById("catalog-back");
  if (cb) cb.onclick = () => { document.getElementById("catalog").hidden = true; showSelect(); };
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
