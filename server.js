/**
 * 「盛宣怀的客厅」Node.js 后端
 *
 * 职责：
 *  1. 托管前端静态文件（frontend/、data/、根目录跳转页）
 *  2. 提供 POST /api/ai —— 接收玩家自由输入的「决策意图」，调用
 *     百度千帆 AppBuilder 智能体：判断玩家输入匹配哪个选项（匹配则推进，不匹配则提醒重输）
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
async function callAppBuilder(env, { current_node, rawQuery }) {
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

  // ② 发送消息（按智能体的两个输入变量 current_node / rawQuery 传参）
  const rRes = await fetch(base + "/v2/app/conversation/runs", {
    method: "POST",
    headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      query: rawQuery,
      conversation_id: conversationId,
      stream: false,
      input: {
        current_node: current_node || "",
        rawQuery: rawQuery || ""
      }
    })
  });
  if (!rRes.ok) throw new Error("对话失败 HTTP " + rRes.status + ": " + (await rRes.text()).slice(0, 200));
  const rData = await rRes.json();

  // ③ 提取回答（兼容多种字段名）
  let answer = rData.output || rData.answer || rData.content || rData.result || rData.output_text || "";
  if (!answer && Array.isArray(rData.choices) && rData.choices[0]) {
    answer = rData.choices[0].message && rData.choices[0].message.content
      ? rData.choices[0].message.content
      : (rData.choices[0].text || "");
  }
  if (!answer) answer = JSON.stringify(rData);
  return String(answer);
}

function parseAnswer(text) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || "";
  const m = first.match(/匹配[：:]\s*([A-C无])/);
  const rawMatch = m ? m[1] : null;
  const matched = (rawMatch && rawMatch !== "无") ? rawMatch : null;
  const advice = matched ? "" : lines.slice(1).join("\n").trim();
  return {
    matched,
    advice,
    raw: text
  };
}

/* ---------- AI 接口 ---------- */
app.post("/api/ai", async (req, res) => {
  try {
    const { current_node, query } = req.body || {};
    if (!query || !String(query).trim()) return res.status(400).json({ error: "empty query" });
    const answer = await callAppBuilder(process.env, { current_node, rawQuery: String(query).trim() });
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
