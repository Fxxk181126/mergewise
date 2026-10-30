# MergeWise Changelog

日期格式：`YYYY-MM-DD`。按时间倒序排列，最新改动在最上面。

---

## 2026-10-30

### chore · 建立独立 GitHub 发布仓库

**受影响文件 / 模块：**

- 将 `mergewise-app` 迁移为仓库内 `app/`，排除依赖、构建产物、Wrangler 本地状态和本机环境文件。
- 将原型与用户手册迁移到 `prototype/`，产品与技术设计文档、新闻稿迁移到 `docs/`。
- 新增根级 `README.md` 与 `.gitignore`。
- 将 `app/wrangler.toml` 中的真实 D1 `database_id` 替换为部署占位符，避免发布环境资源标识。

## 2026-10-27

### fix · 统一产品口径与修复事实性错误

依据新闻稿、用户手册、Figma 原型与技术方案的交叉审查结论，按 18 条决策对齐全部材料。

**受影响文件 / 模块：**

- `pr-ai-review-prototype-design.md`
  - 评论上限从"每文件 ≤3 条"收紧为"每 PR ≤ 1 inline + 1 summary"
  - 阈值三档从 90/75/60 改为 0.90/0.80/0.65，档位"激进"改为"探索"
  - 定价从按席位三档改为按仓库（开源免费 / Team ¥199 / Enterprise）
  - 反馈交互从"按钮"改为"👎 reaction + @mergewise mute this 命令"
  - 数据模型补 repo_settings / observations / rule_stats
  - Webhook 补 issue_comment 事件订阅

- `pr-ai-review-tech-design.md`
  - 阈值默认值 75 → 80
  - Severity 枚举删除 perf / style，锁定三类
  - 新增 §4.2 大 PR 风险排序（关键词加权）
  - 新增 rule_stats 表和自动降权/自动静音状态机说明
  - Prompt 更新：severity 只允许三类，补 threshold 参数
  - 反馈描述从"reactions 后置"改为"👎 reaction + @mergewise mute this 命令"
  - 订阅事件补 `issue_comment`（created）

- `mergewise-user-guide.html`
  - 权限描述修正：Pull requests 改为（读写），补"需要仓库管理员"
  - "Not a bug 按钮"改为"👎 reaction / @mergewise mute this 命令"
  - 审查范围从四类改为三类（删除"性能退化"）
  - 每周摘要从"Slack/飞书/邮件"改为"仅邮件"（Slack/飞书标 roadmap）
  - Review 记录描述改为"不阻塞合并但会在 review 时间线里留记录"
  - 档位"激进"改为"探索"

- `diffguard-prototype.html` → 重命名为 `mergewise-prototype.html`
  - 全局替换 DiffGuard → MergeWise（6 处）

**未改动：** `mergewise-press-release.html`（作为基准文档，其余材料向它对齐）

### fix · 技术方案评审修正（Claude 评审报告 22 条逐条核对后落实 18 条）

**受影响文件 / 模块：**

- `pr-ai-review-tech-design.md`
  - Finding 类型补 `quote` 字段（§4.1 锚定算法依赖它但类型缺失）
  - GitHub App 权限补 `Issues R`（`issue_comment` 事件归属 Issues 权限范畴）
  - 删除 "suggestion 块行数必须 === endLine−line+1" 的虚构约束（GitHub 不要求等行数）
  - 降权公式 `+0.05` → `+5`（confidence 为 0–100 整数刻度）
  - Prompt 删掉"已知团队规则（阈值、静音列表）"，由代码 filter 分流，防止 LLM 自行过滤导致 observations 采不到数据
  - Prompt schema 补 `quote` 字段
  - 成本估算补"典型 3–8K，上限 15K"注释，与原型设计口径对齐
  - `fetchDiff` 补">3000 文件 GitHub API 406"兜底
  - installation token 缓存 1h → ≤55min，401 时刷新重试
  - 补 job 超时回收（running > 5 分钟标 failed）+ LLM fetch 120s timeout
  - 补 bot 评论自过滤（防止死循环）
  - 补 Supabase 免费层 7 天 pause 风险
  - Plan B 补 `pull_request_target` 供应链攻击警告（仅限自家私有仓库）
  - D3 里程碑 "每文件 ≤3" → "每 PR ≤ 1 inline（P0 按 security > bug > test）"
  - D4 里程碑补 mode 切换机制 + 邮件通知（Resend）
  - "代码不出你的 GitHub"措辞改为"diff 不全量落库、不用于训练"

- `pr-ai-review-prototype-design.md`
  - §8 MVP 范围修订：mute 命令 + rule_stats 排进 D3/D4（不再列入"明确不做"）
  - §11 删除断链的 `figma-plugin/README.md` 引用
  - §7 成本估算补"典型 3–8K，上限 15K"

- `mergewise-prototype.html`
  - 审查范围"性能退化"开关从 on 改为 off（与"刻意只做三类"文案对齐）
  - "点一次 Not a bug"改为"点 👎（reaction）或回复 @mergewise mute this"
  - Summary 评论卡补 `@mergewise mute this` 交互提示

- `mergewise-press-release.html`
  - Gate 03 "点一次 Not a bug"改为"点 👎 或回复 @mergewise mute this"
  - FAQ 同步修改

**核对结论：** 22 条评审发现中 18 条确认正确并落实，4 条部分正确（#4 时效口径已在上一轮统一、#11 成本为乐观/保守估算差异非矛盾、#21 邮件 MVP 用 Resend 5 分钟接入非设计缺陷、#22 P0 优先级补一句定义即可），0 条不采纳。

### fix · 第二轮评审修正（Claude 二次评审 16 条逐条核对后落实 13 条）

**受影响文件 / 模块：**

- `pr-ai-review-tech-design.md`
  - Finding 类型补 `rule` 字段（rule_stats.rule 需要写入来源，mute 命令靠它关联规则）
  - 评论体模板补"印 `rule {f.rule}` 标识"（缺失则 mute 无法定位 this）
  - 订阅事件补 `pull_request_review_comment.created`（inline 评论回复也走 mute 命令，仅监听 issue_comment 会漏）
  - 修正 `reaction_created` 为不存在的事件（GitHub 官方 activity types 仅 created/edited/deleted），v2 👎 采集改为轮询 Reactions API
  - rule_stats 表补 `published_count` 字段（误报率 = false_positive / published，原来没有分母）
  - reviews 表补 `started_at` 列（job 超时判断依据）
  - pipeline filter 补 `mode` 参数，定义 shadow 期达阈值 finding 写入 observations
  - D3 验收前置步骤补"演示前手动 UPDATE repos SET mode='commenting'"
  - installation token 缓存描述"≤1h"统一为"≤55min"
  - 出网白名单"两家"更新为四家（补 Supabase DB + Resend）
  - prompt schema 补 `rule` 字段

- `pr-ai-review-prototype-design.md`
  - 场景 A "30 秒内 1–3 条 inline" 改为 "30–60 秒内 1 条 inline"
  - 场景 C "累计 2 次建议静音" 改为 "误报率 > 30% 自动静音"（与技术方案状态机统一）
  - §4 屏 6 "Free / Pro / Team 按席位" 改为 "开源免费 / Team 按仓库 / Enterprise"（与 §9 对齐）
  - §7 权限补 Issues (Read only)
  - §0 "30 秒内见效" 改为 "30–60 秒内见效（p95 < 90s）"
  - §8 实体 rule_stats 补 published_count、finding 补 rule
  - §8 reaction_created 修正为"GitHub 无 reaction webhook，v2 轮询 Reactions API"

- `mergewise-user-guide.html`
  - 权限描述补 Issues（读，用于接收 mute 命令）

**核对结论：** 16 条中 13 条确认正确并落实，3 条部分正确（R11 真 PR 👎 无反应和 R14 failed 无重试为演示注意事项非设计缺陷，R15 工时上轮已标注维持），0 条不采纳。

## 2026-10-27

### feat · MergeWise MVP 服务开发

**受影响文件 / 模块：** `mergewise-app/`

- 新增 GitHub App webhook、进程内 worker、diff 解析、LLM 结构化分析、行锚定、置信度过滤和 Reviews API 发布流程。
- 实现 shadow/commenting 双模式、每 PR 1 条 inline + 1 条 summary、低置信观察池、mute 命令解析、rule_stats 计数与 >30% 自动静音。
- 实现 LLM 校验重试、模型失败降级 summary、GitHub 422 降级发布、新仓库默认 shadow、多行评论范围校验和过期 SHA 跳过。
- 送审 prompt 按新文件行号标注增改行，删除行不编号，降低模型输出行号漂移。
- 新增 Node.js 测试、类型检查、生产构建、Dockerfile、schema.sql、环境变量模板与部署说明。
- 同步代码与应用级变更记录到 `mergewise-app/docs/CHANGELOG.md`。
