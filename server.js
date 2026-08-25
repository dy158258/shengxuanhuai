/**
 * 「盛宣怀的客厅」Node.js 后端
 *
 * 职责：
 *  1. 托管前端静态文件（frontend/、data/、根目录跳转页）
 *  2. 提供 POST /api/ai —— 接收玩家自由输入的「决策意图」，调用
 *     百度千帆 AppBuilder 智能体：判断意图匹配哪个选项 + 生成盛宣怀口吻的「优化说辞」
 *
 * 部署（云服务器 VPS）：
 *   1. 安装 Node.js（18+）
 *   2. 上传整个项目目录
 *   3. npm install
 *   4. 复制 .env.example 为 .env，填入 BAIDU_APP_ID / BAIDU_API_KEY
 *   5. npm start（生产建议用 pm2：pm2 start server.js --name sxh）
 *
 * 环境变量（.env）：
 *   PORT             服务端口，默认 3000
 *   BAIDU_APP_ID     千帆智能体的 app_id
 *   BAIDU_API_KEY    千帆 AppBuilder 的 API Key（Bearer 鉴权）
 *   BAIDU_API_BASE   可选，默认 https://qianfan.baidubce.com
 */

require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "200kb" }));

const ROOT = __dirname;

/* ---------- 静态托管 ---------- */
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.use("/frontend", express.static(path.join(ROOT, "frontend")));
app.use("/data", express.static(path.join(ROOT, "data")));

/* ---------- 健康检查 ---------- */
app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ---------- 调用千帆 AppBuilder 智能体 ---------- */
async function callAppBuilder(env, prompt) {
  const base = (env.BAIDU_API_BASE || "https://qianfan.baidubce.com").replace(/\/+$/, "");
  const key = env.BAIDU_API_KEY;
  const appId = env.BAIDU_APP_ID;
  if (!key || !appId) throw new Error("BAIDU_API_KEY 或 BAIDU_APP_ID 未配置");

  // ① 新建会话，获取 conversation_id
  const cRes = await fetch(base + "/v2/app/conversation", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId })
  });
  if (!cRes.ok) throw new Error("新建会话失败 HTTP " + cRes.status + ": " + (await cRes.text()).slice(0, 200));
  const cData = await cRes.json();
  const conversationId = cData.conversation_id;
  if (!conversationId) throw new Error("未返回 conversation_id：" + JSON.stringify(cData).slice(0, 200));

  // ② 发送消息
  const rRes = await fetch(base + "/v2/app/conversation/runs", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, query: prompt, stream: false })
  });
  if (!rRes.ok) throw new Error("对话失败 HTTP " + rRes.status + ": " + (await rRes.text()).slice(0, 200));
  const rData = await rRes.json();

  // ③ 提取回答（兼容多种字段名）
  let answer = rData.answer || rData.content || rData.result || rData.output_text || "";
  if (!answer && Array.isArray(rData.choices) && rData.choices[0]) {
    answer = rData.choices[0].message && rData.choices[0].message.content
      ? rData.choices[0].message.content
      : (rData.choices[0].text || "");
  }
  if (!answer) answer = JSON.stringify(rData);
  return String(answer);
}

/* ---------- 组装提示词 ---------- */
function buildPrompt({ intent, nodeTitle, situation, options, corpus }) {
  const optLines = (options || []).map((o, i) => String.fromCharCode(65 + i) + ". " + o).join("\n");
  const corpusLines = (corpus || []).map((c, i) => (i + 1) + ". " + c).join("\n");
  return [
    "【当前场景】" + (nodeTitle || "未知"),
    "【场景局势】" + String(situation || "").slice(0, 400),
    "",
    "【可选的三条路】",
    optLines,
    "",
    "玩家（扮演盛宣怀）用自己的话写了一段决策意图。请你完成两件事：",
    "1. 判断这段意图最接近上面哪一条路（只回答 A / B / C 之一）；",
    "2. 参考盛宣怀的书信文风，把玩家的意图润色成一段「优化说辞」——符合盛宣怀口吻的奏折/书信体文言，并附一句白话翻译。",
    "",
    "【盛宣怀书信文风范例（语料）】",
    corpusLines,
    "",
    "玩家意图：" + intent,
    "",
    "请严格按如下格式回复（不要多余的话）：",
    "匹配：A",
    "优化说辞：<文言正文>",
    "白话：<白话翻译>"
  ].join("\n");
}

function parseAnswer(text) {
  const matched = (text.match(/匹配[：:]\s*([A-C])/) || [])[1] || null;
  const wording = (text.match(/优化说辞[：:]\s*([\s\S]*?)(?=白话[：:]|$)/) || [])[1] || "";
  const vernacular = (text.match(/白话[：:]\s*([\s\S]*)/) || [])[1] || "";
  return {
    matched,
    wording: String(wording).trim(),
    vernacular: String(vernacular).trim(),
    raw: text
  };
}

/* ---------- AI 接口 ---------- */
app.post("/api/ai", async (req, res) => {
  try {
    const { intent, nodeTitle, situation, options, corpus } = req.body || {};
    if (!intent || !String(intent).trim()) return res.status(400).json({ error: "empty intent" });
    const prompt = buildPrompt({ intent: String(intent).trim(), nodeTitle, situation, options, corpus });
    const answer = await callAppBuilder(process.env, prompt);
    res.json(parseAnswer(answer));
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

/* ---------- 启动 ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("盛宣怀的客厅 已启动：http://localhost:" + PORT);
});
