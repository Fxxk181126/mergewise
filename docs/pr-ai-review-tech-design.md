# MergeWise · GitHub PR AI Review 技术方案与技术选型

承接《[pr-ai-review-prototype-design.md](pr-ai-review-prototype-design.md)》，本文回答"怎么做、用什么做、为什么"。
范围：2026-10-27 → 10-31 的 MVP 实现 + 演示可靠性设计。

---

## 0. 结论先行（推荐栈一句话）

**TypeScript + Hono 单服务容器（Fly.io 香港）+ Supabase Postgres + 进程内异步任务 + 国产旗舰 LLM（DeepSeek/GLM）+ Claude 作质量对照。**
全程同构 TypeScript，5 天内一人可完成；总运行成本 < $10/月；每个推理 PR 成本为分/毛级。

---

## 1. 系统架构

```
GitHub                    我们的容器                        LLM
──────                    ─────────                        ───
PR opened/pushed ──POST──▶ /webhook (HMAC 校验, <10s ACK)
                             │ 写 job 表 (status=pending, head_sha)
                             ▼
                          worker 循环 (进程内, 每 2s 轮询)
                             │ 1. installation_token (缓存 ≤55min, 401 时刷新)
                             │ 2. GET pulls/files → diff
                             │ 3. 解析 hunks → newLine 映射
                             │ 4. 分块 + prompt ────────────▶ 结构化 findings JSON
                             │ 5. 校验 + 行锚定 + 阈值/去重/上限
                             │ 6. POST /reviews (body=总结, comments=inline)
                             ▼
                          GitHub PR 上出现评论
```

要点：**webhook 立即 ACK，重活在后台做**。GitHub 对 webhook 只等 10 秒，LLM 调用 30–120 秒，绝不能同步等。

## 2. 技术选型与对比

### 2.1 接入形态（产品壳）

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **GitHub App** | 安装即用、按 installation 发 token、权限最小化、有商业感 | 要注册 App、管 PEM 私钥 | **选它**，这是产品形态本身 |
| OAuth App | 简单 | 无法按仓库安装、权限过粗 | 不选 |
| GitHub Action（PR 触发跑 LLM） | 1 天可上线、零服务器 | 不是 SaaS 形态、无安装页 | **只作 Plan B 应急**（见 §8） |

App 权限：Pull requests RW（用于发布评论，不修改代码）、Contents R、Metadata R、Issues R（`issue_comment` 事件归属 Issues 权限范畴，漏了则 mute 命令静默失效）。订阅事件勾 `pull_request`（opened / synchronize）、`issue_comment`（created，PR 会话顶层评论，用于解析 mute 命令）、`pull_request_review_comment`（created，inline 评论回复，也用于解析 mute 命令——用户最自然的操作是回复行内评论，两个通道都要监听）。👎 reaction 无独立 webhook 事件（官方 activity types 仅 created/edited/deleted），v2 采集改为定时轮询 Reactions API。

### 2.2 语言 / 运行时

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Node 20 + TypeScript** | 与前端团队同构；GitHub/LLM SDK 成熟；类型直通 DB→API→UI | CPU 密集弱（本场景无此需求） | **推荐** |
| Python + FastAPI | LLM 实验生态最快 | 再养一套语言栈；部署略重 | 若实现者 Python 优先则切换到此 |
| Go | 资源省、部署简单 | 5 天内迭代 prompt/JSON 处理太慢 | 不选 |

### 2.3 Web 框架

**Hono**（推荐）：轻、TS 原生、中间件够用。备选 Express（生态旧但稳）、Fastify（也快）。此服务只有 2 个路由（webhook、health），框架不构成决策点，选熟悉的即可。

### 2.4 部署

| 选项 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Fly.io 容器 / hkg 区** | 香港 = 到 GitHub 和到国产 LLM API 双向低延迟；无需备案；$2–3/月 | 要装 flyctl、写 Dockerfile（半小时事） | **推荐** |
| Railway / Render | 最快上手（连 GitHub 即部署） | 区域无 HK，到国内 LLM 延迟高；价格略高 | 可接受的替代 |
| Cloudflare Workers | 最便宜、边缘 | **长任务硬伤**：waitUntil 后台时长受限，LLM 60–120s 调用不可靠，需再配 Queues | MVP 后期再迁 |
| 国内云 HK 轻量服务器 | 便宜、可控 | 要自己管运维/HTTPS | 备选 |

### 2.5 数据库

**Supabase Postgres**（免费层）：MVP 需 5 张表，但要可靠性约束（唯一键幂等）——SQLite 单机也可，Supabase 省运维且有控制台可查数据，演示排错直观。备选：Neon（同价位）、本地 SQLite（Plan C）。

> ⚠️ Supabase 免费层 7 天不活跃自动 pause。D1 部署后若几天没流量，演示当天 DB 可能已停机。建议 D1–D5 每天 curl 一次 health endpoint（顺带触达 Supabase 保持活跃），或临时升付费层。

```sql
CREATE TABLE repos (
  id BIGINT PRIMARY KEY,            -- GitHub repo id
  installation_id BIGINT NOT NULL,
  full_name TEXT NOT NULL,
  threshold INT NOT NULL DEFAULT 80,
  mode TEXT NOT NULL DEFAULT 'shadow',          -- shadow | commenting
  shadow_started_at TIMESTAMPTZ
);
CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  finding JSONB NOT NULL,           -- 未达阈值的完整 finding
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE rule_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  rule TEXT NOT NULL,
  false_positive_count INT NOT NULL DEFAULT 0,
  published_count INT NOT NULL DEFAULT 0,        -- 该规则已发布评论数（误报率 = false_positive / published）
  auto_state TEXT NOT NULL DEFAULT 'active',     -- active | downweighted | muted
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (repo_id, rule)
);
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id BIGINT NOT NULL REFERENCES repos(id),
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|running|done|failed|skipped
  started_at TIMESTAMPTZ,                   -- 进入 running 时写入，用于超时回收
  findings JSONB,
  posted_review_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (repo_id, pr_number, head_sha)     -- 幂等基石
);
```

### 2.6 异步任务

**进程内 worker + DB job 表**（推荐 MVP）：`SET status='running' WHERE status='pending'` 抢占，每 2 秒轮询。零新增组件。备选 BullMQ+Redis（量起来再说）、QStash/CF Queues（仅 serverless 架构需要）。

并发细节：
- 抢占式认领保证 webhook 重投不会双跑（配合唯一键）
- 同 PR 新 push（synchronize）进来时：旧 job 若未发布，发布前 re-check head SHA，不一致则 `skipped` 退出
- 单 worker 串行即可满足演示吞吐；一天几百 PR 也能扛
- `issue_comment.created` 只解析以 `@mergewise mute this` 开头的命令，其余忽略
- 过滤 bot 自身评论（`comment.user.type === 'Bot'`），防止自触发死循环
- running 状态 job 超 5 分钟自动标 `failed`（防止 Fly 部署重启后永久卡死）；LLM fetch 设 120s timeout

### 2.7 LLM 选型

| 选项 | 代码审查质量 | 中文输出 | 成本量级*/M tokens | 结论 |
|---|---|---|---|---|
| **DeepSeek（对话旗舰）** | 强 | 好 | 最低档 | **主选（成本敏感时）** |
| **GLM 旗舰** | 强 | 很好（可全程中文评论） | 低档 | **主选（备选），国内合规友好** |
| Claude Sonnet 级 | 顶级（我们的质量标杆） | 好 | 高一个量级 | 质量对照 / 演示重质量时切它 |
| GPT 级 | 强 | 好 | 中高 | 备选 |

\* 以当期价目表为准，此处只谈量级。

**策略**：
- MVP 单模型 + `temperature: 0.2`，模型名进环境变量，一天内可换
- 结构化输出：prompt 硬约束 JSON schema + **zod 校验**，失败带错误信息重试 1 次；再失败则该 PR 只发总结评论（降级不炸）
- 每个 PR 成本：典型 diff ≈ 3–8K tokens（小型 PR），上限 10 文件 × 1.5K ≈ 15K in + 1K out → DeepSeek/GLM 量为**几分钱/PR**，Claude 约 $0.05–0.1/PR（量级估算）
- 降本开关（后置）：`.md/.lock` 直接跳过；单文件 diff 超 400 行截断送审；未变更 blob 按 SHA 缓存

### 2.8 其余小件

| 件 | 选择 | 备注 |
|---|---|---|
| diff 解析 | npm `parse-diff` | 解析 hunks，自建 newLine→代码行 映射表 |
| GitHub 调用 | `octokit` + App 认证（`createAppAuth`） | installation token 缓存 ≤55min，401 时刷新重试 |
| 本地联调 | cloudflared tunnel（免费稳）或 smee | 也可 deploy-first：D1 就上 HK，直接对真实仓库调 |
| 日志 | 结构化 JSON log，request_id = X-GitHub-Delivery | 平台日志可检索即可；Sentry 后置 |
| 校验 | zod | findings schema 的运行时把关 |

---

## 3. 核心类型与 Pipeline 接口

```ts
type Severity = 'bug' | 'security' | 'test';

interface Finding {
  file: string;            // 相对路径，必须出现在本次 diff
  line: number;            // diff 新侧行号
  endLine?: number;        // 多行建议时 > line
  quote: string;           // LLM 输出的原文引用，用于行锚定校验（§4.1）
  severity: Severity;
  confidence: number;      // 0–100，LLM 自报，后置校准
  rule: string;            // 内部规则标识（如 sql-injection/v3），用于 mute 命令与 rule_stats 关联
  title: string;           // ≤ 40 字
  why: string;             // 根因，≤ 80 字，只准引用 diff/上下文事实
  suggestion?: string;     // 用于 ```suggestion 块；替换内容行数不限（可增删行）
}

// pipeline 每步都是纯函数，便于用黄金集回归
fetchDiff(installation, repo, pr)      → DiffFile[]        // 截止 10 文件/300 行每块；文件总数 > 3000 时 GitHub API 406，直接跳过该 PR 并发总结"PR 过大跳过审查"
parseHunks(diff)                       → LineMap           // newLine → content
prioritize(files)                      → DiffFile[]        // 按风险排序（见 §4.2）
analyze(files, context)                → Promise<Finding[]> // LLM 调用 + zod 校验
anchor(findings, lineMaps)             → { valid, invalid } // §4 行锚定
filter(findings, { mode, threshold, cats, mutes, maxInlinePerPr: 1 })
// mode='shadow'：达阈值 finding 全部写入 observations（不发评论），mode='commenting'：正常发布
publish(review)                        → ReviewResult      // §4 评论组装
```

## 4. 两个最容易翻车的技术点

### 4.1 评论行锚定（做错 = 评论挂错行 / API 400）

Reviews API 要求 `line`（及 `start_line`）必须是**该 commit diff 里真实存在的新侧行号**，否则整单被拒。算法：

```
1. LLM 必须输出 file + line + 原文引用 quote
2. 校验: normalize(lineMap[file][line]) === normalize(quote)
   ├─ 命中 → 通过
   ├─ 不命中 → 在 ±5 行内模糊搜索 quote → 命中则改用该行
   └─ 仍不命中 → 该 finding 降级进总结，不 inline（宁可少说不说错）
3. 多行: endLine 同样校验且 > line；suggestion 块替换内容行数不限（GitHub 不要求等行数，可增删行）
4. 组装: POST /reviews { commit_id: head_sha, event: 'COMMENT',
      body: 总结 markdown,
      comments: findings.map(f => ({ path, line, side:'RIGHT', start_line?, body })) }
5. 失败兜底: 整单 422 → 拆单逐条重发 → 全挂则只发总结
```

评论体模板即原型里的卡片规范（chip / 置信度 / 为什么 / suggestion 块 / 底部印 `rule {f.rule}` 标识——mute 命令靠这个定位"this"，缺失则 mute 无法关联到 rule_stats）。

### 4.2 大 PR 风险排序

超过 10 文件的 PR 在截断前先做一次排序，简单加权规则写死在代码里：

```
weight = 0
if path matches /auth|login|session|token|permission/ → weight += 30
if path matches /sql|query|migration|db/             → weight += 25
if path matches /payment|invoice|checkout|billing/   → weight += 20
if path matches /controller|handler|route|endpoint/  → weight += 15
if filename ends with .test.ts|.spec.ts              → weight -= 20
```

排序后取 top 10 送审，其余跳过。MVP 不做智能排序，关键词表写在 `src/prioritize.ts` 单文件里方便调整。

### 4.3 幂等与竞态

- webhook 校验 `X-Hub-Signature-256`（HMAC-SHA256, WEBHOOK_SECRET）后**先落库再 ACK**：`(repo, pr, head_sha)` 唯一键，重复投递直接 `ON CONFLICT DO NOTHING` → ACK 200
- GitHub 失败会自动重投：job 表 status 机 + 认领式 UPDATE，双投不会双评论
- 同 PR 连续 push：只处理最新 SHA（发布前 re-check），旧结果标 `skipped`
- 只处理 `opened` / `synchronize`；`draft`、`closed`、rebase 产生的中间 SHA 跳过

## 5. Prompt 设计（v1 骨架）

```
System: 你是资深代码审查员。只允许基于给定 diff 与上下文事实发言；
        不评论风格/格式/性能；不确定就降低 confidence；每条 finding 必须给出
        可直接执行的 suggestion（替换内容行数不限）。severity 只允许 bug / security / test。
        每条 finding 必须输出 quote（对应行原文，用于行锚定校验）。
        输出仅一个 JSON 对象：
        { "findings": [ { file, line, endLine?, quote, severity, confidence, rule, title, why, suggestion? } ] }
        confidence 标准化为整数：95+ 代码可证；80–94 高度可能；<75 存疑。
User:   仓库语言/框架元数据 + 逐文件 diff（带新侧行号标注）。不要把阈值/静音列表传给 LLM——由代码 filter 分流，否则 LLM 会自行过滤导致 observations 表采不到低置信度 finding。
```

黄金集回归：固定 10 个样例 PR（含 1 个干净 PR），每次改 prompt 跑一遍，人工核对发了几条、几条是误报——**这就是"误报率"问题的最小度量闭环**，演示时可直接引用这个数字。

**自动降权 / 自动静音状态机**：`rule_stats` 表由反馈驱动更新——当收到 `@mergewise mute this` 命令时，对应 `rule` 的 `false_positive_count` +1。同一仓库内某条规则的误报率 > 15% 时 `auto_state` 切到 `downweighted`（该规则 confidence 需在阈值基础上再 +5 才发布，confidence 与 threshold 均为 0–100 整数刻度）；> 30% 时切到 `muted`（该规则在本仓库不再发布）并给管理者发一封邮件通知。MVP 只实现计数与 `muted` 切换，`downweighted` 逻辑后置到 v2。邮件通知 MVP 用 Resend 免费层，D4 接入。

## 6. 安全与隐私（也是卖点）

- PEM 私钥、WEBHOOK_SECRET、LLM key 全走平台 secret，永不入库（团队安全基线）
- diff 不全量落库，不用于模型训练：reviews 表只存 findings 结构化元数据与状态。对外措辞用"diff 不全量落库、不用于训练"，避免说"代码不出你的 GitHub"（diff 确实发给 LLM API，suggestion 字段含代码片段）
- installation token 缓存 ≤55min（不用 ≤1h 表述，避免边界过期）；API 调用集中在服务端，前端零凭据
- 出网白名单：github.com + LLM API + Supabase DB + Resend（邮件通知）四家

## 7. 里程碑（10-27 → 10-31）

| 日 | 内容 | 验收 |
|---|---|---|
| D1 10-27 | 注册 GitHub App；Hono 骨架；HMAC 校验；install token；拉 diff；部署 Fly hkg | 开真实 PR → reviews 表出现记录与文件数 |
| D2 10-28 | `parse-diff` + LineMap；prompt v1 + zod；黄金集 10 PR 跑通 | 10/10 合法 JSON；锚定通过率 ≥ 90% |
| D3 10-29 | 发布：行锚定、阈值过滤、每 PR ≤ 1 inline（P0 按 security > bug > test 取最高）、总结组装、幂等/竞态处理；mute 命令解析 + rule_stats 计数。演示前手动 `UPDATE repos SET mode='commenting'`（切换 UI 排 D4） | 开 PR → 评论出现 ≤ 60s，重复投递零重复评论 |
| D4 10-30 | 演示仓库布景（bug/安全/缺测试三个 staged PR）；mode 切换机制（shadow→commenting）；阈值环境变量切换；邮件通知（Resend）；Plan B 演练；日志排查 | 全流程彩排 ×3 无人工干预 |
| D5 10-31 | 彩排 + 录屏备份；口播对齐（误报率问题 → 阈值演示 → 定价） | 备用录屏可播 |

## 8. Plan B（应急演示路径）

若 GitHub App 通道在 D4 前仍未稳定：用 GitHub Action（`pull_request_target` 触发）跑同一套 analyze 逻辑，`gh api` 发 review。1 天内可完成，只用于自家演示仓库——它保住"现场开 PR、AI 评论出现"的核心画面，SaaS 叙事交给原型承担。

> ⚠️ `pull_request_target` 以基仓库凭据运行，fork PR 存在供应链攻击向量（恶意 PR 可窃取 secrets）。Plan B 仅限自家私有演示仓库使用，secrets 最小化（只放 LLM key，不放 GitHub App PEM），不开公开仓库的 Plan B。

## 9. 需要现在拍板的三件事

1. **部署平台**：Fly.io（推荐）还是 Railway（更快）？账号谁来开？
2. **LLM 主选**：DeepSeek（最省）还是 GLM 旗舰（中文最佳、合规稳）？预算多少？
3. **Dashboard 是否进 MVP**：推荐不进（原型承担叙事），省出 1 天给可靠性。
