/**
 * 「盛宣怀的客厅」Cloudflare Worker 后端
 *
 * 职责：接收玩家自由输入，调用 OpenAI / Claude API，
 * 以「郑观应」的口吻给出符合历史语境的幕僚反馈。
 *
 * 环境变量（在 Cloudflare Dashboard → Workers → Settings → Variables 配置）：
 *   AI_PROVIDER        "openai"（默认） 或 "claude"
 *   AI_BASE_URL        可选，自定义 OpenAI 兼容接口地址。留空默认 OpenAI 官方；
 *                      接百度千帆可填 https://qianfan.baidubce.com/v2
 *   OPENAI_API_KEY     OpenAI/百度千帆 密钥（AI_PROVIDER=openai 时必填）
 *   OPENAI_MODEL       可选，默认 "gpt-4o-mini"；百度千帆可填如 "ernie-4.0-8k"
 *   ANTHROPIC_API_KEY  Claude 密钥（AI_PROVIDER=claude 时必填）
 *   ANTHROPIC_MODEL    可选，默认 "claude-sonnet-4-6"
 *
 * 前端调用约定：POST /api/chat  body = { message, nodeId, nodeTitle, situation, choices }
 * 返回：{ reply } 或 非 2xx（前端将自动降级为预设回应）
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

const SYSTEM_PROMPT = `你是郑观应，清末洋务思想家、《盛世危言》的作者，也是盛宣怀（字杏荪）最倚重的智囊幕僚。

此刻玩家正扮演盛宣怀，置身于 1898—1908 年汉阳铁厂、萍乡煤矿与"汉冶萍"合并的历史情境中。玩家会以盛宣怀的口吻，向你陈述他（不选预设选项时）自己拟定的决策与理由。

请你扮演郑观应，对玩家提出的这个决策给出反馈：
1. 先以"大人"称呼，态度恭敬而坦诚，不阿谀。
2. 结合当前节点的局势（下面会给出"当前局势"），评估此策的利弊得失——既要算眼前的钱，也要看长远的局。
3. 若此策有明显隐患（如损官声、伤根本、失商信、被外人趁机），要直言指出，并给出一条更稳妥的变通建议。
4. 行文用文言与白话夹杂的口吻（类似《盛世危言》），但需让现代玩家看得懂。
5. 控制在 120—220 个汉字以内，直接回复正文，不要加任何前缀或署名。

盛宣怀当年的核心关切：煤铁并举、以轮电之利养钢铁之基、矿权绝不可落入外人（尤其日本）之手、官商之间要留有余地。`;

function corsJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

async function callOpenAI(env, userContent) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 未配置");
  const model = env.OPENAI_MODEL || "gpt-4o-mini";
  const base = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + key
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent }
      ]
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("OpenAI HTTP " + res.status + ": " + t.slice(0, 300));
  }
  const data = await res.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
}

async function callClaude(env, userContent) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 未配置");
  const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Claude HTTP " + res.status + ": " + t.slice(0, 300));
  }
  const data = await res.json();
  return (data.content && data.content[0] && data.content[0].text) || "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const message = (body.message || "").toString().trim();
        if (!message) return corsJson({ error: "empty message" }, 400);

        const nodeTitle = body.nodeTitle || "";
        const situation = (body.situation || "").toString().trim();
        const choices = body.choices || {};

        let context = "当前节点：" + (nodeTitle || "未知") + "\n";
        if (situation) context += "当前局势：\n" + situation + "\n";
        const choiceSummary = Object.entries(choices)
          .filter(([, v]) => v)
          .map(([k, v]) => k + " 选了 " + v)
          .join("；");
        if (choiceSummary) context += "此前抉择：" + choiceSummary + "\n";
        context += "\n玩家（盛宣怀）向你陈述的决策与理由：\n" + message;

        const provider = (env.AI_PROVIDER || "openai").toLowerCase();
        let reply;
        if (provider === "claude") {
          reply = await callClaude(env, context);
        } else {
          reply = await callOpenAI(env, context);
        }

        reply = reply.trim();
        if (!reply) return corsJson({ error: "empty reply" }, 502);
        return corsJson({ reply });
      } catch (e) {
        // 返回 500，前端据此自动降级为预设回应
        return corsJson({ error: String(e && e.message || e) }, 500);
      }
    }

    // 其它路径
    return corsJson({ ok: true, service: "盛宣怀的客厅 AI 幕僚", endpoint: "POST /api/chat" });
  }
};
