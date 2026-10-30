# GitHub PR AI Review · 产品原型设计

**产品代号：MergeWise** ｜ 依据 2026-10-26 X 需求调研 ｜ 面向 2026-10-31 Coffee Talk 演示
配套可交互原型：`mergewise-prototype.html`（6 屏，可点击）

---

## 0. 需求 → 设计的映射

| 调研结论（已核实）                                                                                               | 设计响应                                                     |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| X 主帖（1.7K replies / 612 likes）讨论 AI 产品付费点，回复明确写 "the github pull requests are the part i would pay for" | 选定 PR AI Review 为唯一方向，不做第二产品分心                           |
| 现场核心问题：**AI Review 的误报率要低到多少，开发者才愿意让它持续跑在团队仓库里？**                                                       | 把"噪声控制"从卖点升格为产品第一性设计：置信度门槛、分类开关、静音规则、每 PR 评论上限、可量化的采纳率看板 |
| 演示要求 30–60 秒内见效（p95 < 90s）、现场可打开真实 GitHub PR                                                            | 演示路径压到 4 步：装 App → 开 PR → 评论出现 → 拖阈值看降噪                  |

## 1. 产品定位

**一句话**：MergeWise 是装在 GitHub 上的 AI 审查员——读 diff、标 Bug / 安全 / 缺测试；置信度不够的话只进总结不吵你，反馈越多越安静。

- **买家**：小型工程团队的 tech lead / CTO（付费决策人）、独立开发者、开源维护者
- **核心差异**（对标 CodeRabbit / GitHub Copilot Code Review / Claude Code Action）：对手比"看得多"，我们比"说得准"。评论即行动率（acted / posted）作为一等指标直接显示在工作台
- **北极星指标**：评论即行动率 ≥ 60%（这是待现场验证的假设，不是已知事实）

## 2. 用户与核心场景

- **场景 A · 团队日常**：成员开 PR → 30–60 秒内 MergeWise 发出 1 条 inline 评论（P0 高置信）+ 1 条总结；人从"逐行初筛"变为"只看关键点"
- **场景 B · 开源维护者**：外部贡献 PR 质量参差 → 免费层先跑起来，降低维护者逐条回复成本，同时成为获客入口
- **场景 C · 反馈闭环**：开发者点 👎 或回复 `@mergewise mute this` → 同类规则误报率 > 30% 即自动静音 → 下个 PR 起此类问题不再出现

## 3. 核心用户流程

```
安装(GitHub App, 选仓库, 选严格度)
  → 触发(pull_request opened / synchronize webhook)
  → 分析(拉 diff + 相关上下文文件 → LLM 结构化输出 findings[])
  → 过滤(置信度 ≥ 阈值 → P0 贴 inline, 每 PR 最多 1 条; 其余 → 唯一总结评论)
  → 反馈(👎 reaction / @mergewise mute this → 抑制规则)
  → 度量(采纳率/误报率 → 工作台看板)
```

## 4. 信息架构（对应原型 6 屏）

| # | 屏幕 | 目的 | 关键元素 |
|---|---|---|---|
| 1 | 首页 Landing | 30 秒讲清价值 | 一句话主张、示例评论卡、3 个卖点（置信度门槛 / 上下文感知 / 越用越安静） |
| 2 | 安装流程 | 把摩擦降到 3 步 | 权限说明 → 仓库选择 → 严格度档位（对应阈值 0.90/0.80/0.65） |
| 3 | 工作台 Insights | 让信任可量化 | 评论采纳率、误报率、降噪趋势、仓库明细、团队基线提醒 |
| 4 | PR 审查（演示核心） | 复刻 GitHub 内观感 | diff + inline 评论卡 + 总结评论 + **阈值滑杆现场演示**（P0 贴 inline，其余进 summary） |
| 5 | 信任设置 | 噪声控制的中枢 | 阈值滑杆与预设、分类开关、静音规则列表（含撤销）、路径范围、回复方式 |
| 6 | 定价 | 讲清收入模型 | 开源免费 / Team 按仓库 / Enterprise，按仓库计费 |

## 5. 核心组件规范：Review Comment 卡片

```
[🔴 Bug] [置信度 94%]                        src/auth/session.ts · L44
结论：device_trust cookie 未加 httpOnly / secure，可被 XSS 读取
为什么：登录后写入的信任 Cookie 无任何安全属性，注入脚本可读走并复放 90 天
建议：res.cookie("device_trust", token, { httpOnly: true, secure: true, sameSite: "lax" })
[👎 误报（reaction）] [@mergewise mute this]     MergeWise 生成
```

发布规则（降噪的硬约束）：
1. 每 PR 最多 1 条 inline（取全 PR 最高优先级 P0）+ 1 条 summary，用户可见打扰 ≤ 2 条
2. 置信度 < 阈值的发现只进待观察池，不打扰 diff
3. 同一文件同一模式只发一次
4. Style / Docs / Performance 类默认关闭，MVP 不开启
5. 点 👎 reaction 或回复 `@mergewise mute this` 即生成仓库级抑制规则

## 6. 噪声控制设计（回应演示问题）

| 严格度 | 阈值 | 行为预期 | 适用 |
|---|---|---|---|
| 保守 | 0.90 | 极少打扰，几乎只报确定性 Bug | 上线初期建立信任 |
| 标准（默认） | 0.80 | 平衡档 | 多数团队 |
| 探索 | 0.65 | 更多发现，容忍更多误报 | Shadow 期观察用 |

工作台直接展示"评论即行动率"，团队可设基线（如 < 60% 提醒调高阈值）。
**诚实标注**：60% 及格线是产品假设，Coffee Talk 现场要收集的正是各位的底线数字。

## 7. 数据模型与集成

**实体**：`installation(id, account, repos[], plan)`、`repo_settings(mode, shadow_started_at, threshold)`、`review(id, pr, commit, findings[])`、`finding(id, file, line, severity, category, confidence, rule, reason, suggestion)`、`observation(finding, confidence, reason)`、`feedback(id, finding, user, vote, reaction)`、`mute_rule(pattern, scope, source)`、`rule_stats(rule, published_count, false_positive_count, auto_state)`、`metric(week, posted, acted)`

**GitHub 集成**：
- GitHub App 权限最小化：Pull requests（Read & write，用于发布评论）、Contents（Read only）、Metadata（Read only）、Issues（Read only，`issue_comment` 事件依赖）；不需要修改代码权限
- Webhook：`pull_request`（opened / synchronize）+ `issue_comment`（created，用于解析 @mergewise mute this 命令）
- 发布通道：Reviews API（inline comments，默认）；Checks API 可选（阻塞 / 非阻塞模式）

**Pipeline**：diff 分块 → 带上下文的 LLM 结构化输出（JSON findings）→ 规则后处理（阈值 / 静音 / 上限 / 去重）→ 发布。

**成本估算（粗）**：典型 PR 约 3–8K tokens（上限 15K，按 10 文件×1.5K 计），Haiku 级模型 ≈ $0.005/PR，Sonnet 级 ≈ $0.03/PR。10 人团队月 300 PR → $1.5–9/月，对比 $40/月团队订阅，毛利约 90%+（估算值，需实测修正）。

## 8. MVP 范围（10-26 → 10-31，5 天）

**必做**：
1. GitHub App 脚手架 + webhook 接收（D1）
2. diff → LLM → findings 的最小 pipeline（D2）
3. Reviews API 发布 + 全局置信度阈值（D3）
4. 真实 demo 仓库 + 一个含典型问题的演示 PR，与原型界面口径对齐（D4）
5. 彩排 + 备用录屏（D5）

**MVP 包含**（2026-10-27 修订）：mute 命令解析（`@mergewise mute this`，监听 `issue_comment.created` + `pull_request_review_comment.created` 两个通道）+ rule_stats 计数（含 published_count 分母）与自动静音，排进 D3/D4。**明确不做（现场口头 roadmap）**：👎 reaction 反馈采集（GitHub 无 reaction webhook 事件，v2 用定时轮询 Reactions API）、工作台看板、计费与登录体系。原型承担这三块的可视化叙事。

**120 秒演示脚本**：
① 装 App（30s，讲权限最小化）→ ② 开演示 PR（30s，评论出现，讲"只说有把握的话"）→ ③ 拖阈值 0.80→0.90→0.65（30s，讲误报率问题的产品化回答）→ ④ 定价一页 + 抛出问题收集底线数字（30s）

## 9. 定价与获客

| 档位 | 价格 | 内容 |
|---|---|---|
| 开源 / 个人 | $0 | 公开仓库永久免费，不限 PR（获客层：开源维护者） |
| Team | ¥199/仓库/月（约 $29） | 私有仓库、置信度门槛、抑制规则、误报率看板与 shadow 模式 |
| Enterprise | 定制 | 私有化部署（VPC / 内网），代码不出网，模型可替换 |

关键设计：**按仓库计费，不走人头采购**——团队规模扩大时成本不涨。
获客路径：开源免费层 → Show HN / X 演示视频 → 在开发者抱怨 AI review 噪声的社区讨论中做"安静版"定位。

## 10. 风险与应对

| 风险 | 应对 |
|---|---|
| LLM 幻觉评论伤害信任 | 阈值 + 每文件上限 + 只引 diff 内事实；演示选保守档 |
| CodeRabbit 等竞品全功能压制 | 不比功能清单，比"每条评论都值得看"的定位与 seat 定价 |
| token 成本失控 | diff 分块 + 结果缓存 + 按文件哈希跳过未变更块 |
| 安装摩擦（需要 repo admin） | 演示用预装好的仓库；安装流程压缩到 3 屏 |

## 11. 原型使用说明

交互原型覆盖上述 6 屏，现场可玩的三个点：
1. **PR 审查屏的阈值滑杆**：0.80→0.90 只剩 P0 一条行内，0.65→测试缺口也发布，直观演示噪声控制
2. **评论卡的 👎 reaction / @mergewise mute this**：演示反馈闭环如何让产品"越用越安静"（设置屏可看到规则被加入并可撤销）
3. **安装屏的严格度档位**：对应阈值 0.90/0.80/0.65，讲清"信任是分档交付的"

其余数据均为演示样例。

**Figma 版原型**：以 Figma Make（浏览器内在线生成）为准。`figma-plugin/` 目录已废弃——本地不存在该目录，不再引用。
