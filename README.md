# 「盛宣怀的客厅」—— 互动历史叙事游戏

以盛宣怀与汉阳铁厂（1898—1908）为背景的互动叙事游戏。玩家扮演盛宣怀，在六个决策节点中做出选择，走向七种结局之一；也可以自由输入文字，向「AI 幕僚郑观应」呈报自己的决策，获得符合历史语境的反馈。

- **前端**：纯 HTML + CSS + JavaScript，托管于 **Vercel**
- **后端**：**Cloudflare Workers**（Serverless），代理调用 OpenAI / Claude API
- **存档**：浏览器 `localStorage`（3 个手动存档位）
- **降级**：AI 未配置或调用失败时，自动降级为预设回应，游戏仍可完整游玩

---

## 目录结构

```
/
├── frontend/
│   ├── index.html       # 页面结构
│   ├── style.css        # 奏折/书信风格样式（米黄背景、仿宋字体）
│   └── script.js        # 游戏逻辑、存档、AI 输入
├── worker/
│   └── index.js         # Cloudflare Worker：AI 接口代理
├── data/
│   └── gameData.json    # 全部节点、选项、结局数据
└── README.md            # 本文件
```

---

## 一、部署前端到 Vercel

> 注意：前端通过相对路径 `../data/gameData.json` 读取数据，因此需要把**整个项目根目录**（含 `frontend/`、`data/`）作为站点根目录发布，而不是只发布 `frontend/` 子目录。

### 方式 A：网页操作（最简，推荐新手）

1. 打开 [vercel.com](https://vercel.com) 并登录（可用 GitHub 账号）。
2. 点击 **Add New → Project**。
3. 把本项目上传到 GitHub / GitLab 仓库后导入；或选择本地目录导入。
4. 在 **Root Directory（根目录）** 保持为项目根目录 `/`（**不要**填 `frontend`）。
5. Framework Preset 选择 **Other**（无需构建步骤）。
6. 点击 **Deploy**。部署完成后，访问 `https://<项目名>.vercel.app/frontend/` 即可开始游戏。

> 因为根目录没有 `index.html`，直接访问站点根会 404。请把入口地址指到 `/frontend/`。也可以把入口链接分享给玩家。

### 方式 B：命令行（Vercel CLI）

```bash
npm i -g vercel
cd 项目根目录
vercel          # 登录并按提示操作
vercel --prod   # 正式发布
```

发布后入口地址形如：`https://你的项目名.vercel.app/frontend/`。

---

## 二、部署后端到 Cloudflare Workers

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com)，进入 **Workers & Pages → Create → Create Worker**，给 Worker 起个名字（如 `sxh-ai`）。
2. 把 `worker/index.js` 的内容粘贴进编辑器（替换默认代码），点击 **Deploy**。
3. 进入该 Worker 的 **Settings → Variables and Secrets**，添加环境变量（见下表）。
4. 保存后，Worker 地址形如 `https://sxh-ai.<你的子域>.workers.dev`。

### 环境变量

| 变量名 | 说明 | 必填 |
| --- | --- | --- |
| `AI_PROVIDER` | `openai`（默认）或 `claude` | 否 |
| `AI_BASE_URL` | 自定义 OpenAI 兼容接口地址，留空默认 OpenAI 官方 | 否 |
| `OPENAI_API_KEY` | OpenAI / 百度千帆 密钥，选 openai 时必填 | 视 provider |
| `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini`；百度千帆可填 `ernie-4.0-8k` 等 | 否 |
| `ANTHROPIC_API_KEY` | Claude 密钥，选 claude 时必填 | 视 provider |
| `ANTHROPIC_MODEL` | Claude 模型名，默认 `claude-sonnet-4-6`（可用 `claude-haiku-4-5-20251001` 降低成本） | 否 |

> **接百度智能云（千帆）**：把 `AI_PROVIDER` 设为 `openai`、`AI_BASE_URL` 填 `https://qianfan.baidubce.com/v2`、`OPENAI_API_KEY` 填千帆的 API Key、`OPENAI_MODEL` 填模型名（如 `ernie-4.0-8k`）即可。前提是你在千帆开通了「OpenAI 兼容」模式并有对应模型权限。
>
> **安全提示**：密钥请放入 **Secrets**（加密），不要写在代码或公开仓库中。

---

## 三、把前端与后端连起来

编辑 `frontend/script.js` 顶部：

```js
const WORKER_URL = "https://sxh-ai.yourname.workers.dev"; // ← 改成你的 Worker 地址
```

把 `sxh-ai.yourname.workers.dev` 换成你自己的 Worker 域名，保存后重新部署前端即可。

- **未改 / 仍是占位地址**：前端会自动识别占位符（`yourname` 等），不发起请求，直接使用预设降级回应，游戏其余功能不受影响。
- **填了但后端不可用**：前端会自动捕获错误，降级为预设回应。

---

## 四、本地预览（可选）

最简单的方式是用任意静态服务器，从项目根目录启动：

```bash
# Python 方式
cd 项目根目录
python -m http.server 8080
# 浏览器打开 http://localhost:8080/frontend/
```

也可以用 Node：

```bash
npx serve .          # 然后访问 /frontend/
```

> 直接用 `file://` 双击打开 `index.html` 可能因浏览器跨域限制无法加载 `gameData.json`，请务必通过本地服务器访问。

---

## 五、游戏玩法速览

- **6 个决策节点**：节点一、二是「教学环节」，非历史路径可回退；节点三、四、五是「方向性抉择」，选定即锁定。
- **7 种结局**（A–G）：结局 A 为历史复刻者，B–G 为不同走向的推演结局。
- **选项标识**：★ 历史路径 / 🔄 可回退 / ⚠️ 不可回退。
- **AI 幕僚**：在节点下方文本框输入自己的决策，点「呈报」，郑观应（AI）会给出反馈。
- **存档/读档**：顶部「存档 / 读档」，共 3 个存档位，存于浏览器本地。
- **历史对照**：顶部「历史对照 / 路线」可随时查看真实历史结局与决策路线表。

---

## 六、常见问题

- **页面打开是空白/报错**：确认是通过服务器访问（不是双击文件），且 `data/gameData.json` 与 `frontend/` 在同一个站点的相对位置。
- **AI 一直是预设回应**：检查 `WORKER_URL` 是否填对、Worker 是否部署成功、环境变量（API Key）是否配置。
- **Worker 返回 500**：多为密钥缺失或模型名错误，可在 Worker 的实时日志中查看具体错误信息。
