# OpenQuestionBank

OpenQuestionBank 是一个以文件为基础的开源题库与知识库框架，适合考试备考、学校课程、企业培训和个人知识整理。题库内容使用 YAML 和 Markdown 保存，可以通过 Git 进行版本管理、审阅和协作。

它提供统一的数据格式和命令行校验工具，帮助维护者检查题目结构、题目与知识点之间的引用、资源文件、审核状态和发布授权。源数据与 GitHub、Obsidian、Notion 等展示平台分离，避免题库被某一个平台锁定。

项目目前处于 V1.0 的 P2 阶段：Schema 1.0、Core 读取与校验、题库初始化模板、CLI 校验、统计和诊断已实现。具体平台导出、规则组卷执行、自动评分、在线刷题和学习记录尚未实现。

## 适合什么场景

- 用普通文件长期维护题目、知识笔记、考点、材料题组和试卷
- 在 Git 中查看题目修改历史，并通过分支或 Pull Request 审阅内容
- 在编辑期间快速发现格式错误、重复 ID、无效引用或缺失资源
- 在发布前检查审核状态和内容授权信息
- 为后续导出或其他工具提供稳定、平台无关的数据源

OpenQuestionBank 是本地运行的软件框架，不提供在线题库网站、用户账号或数据库服务。一个题库可以作为独立 Git 仓库维护，与本框架仓库分开。

## 快速开始

### 环境要求

- Node.js `>=22.13.0`
- pnpm `11.25.0`（版本由 `packageManager` 字段锁定）

### 创建题库

在 OpenQuestionBank 仓库根目录运行：

```sh
pnpm install
pnpm build
pnpm oqb --help
pnpm oqb init ./my-question-bank
```

`init` 会创建一个可以直接校验的题库示例。如果目标目录不存在，命令会创建它；如果目录已存在，它必须为空。命令不会覆盖已有文件。

### 校验和查看题库

```sh
pnpm oqb validate ./my-question-bank
pnpm oqb stats ./my-question-bank
pnpm oqb doctor ./my-question-bank
```

校验默认使用 `draft` 模式，适合日常录入和编辑。下面的例子会检查发布审核条件：

```sh
pnpm oqb validate ./my-question-bank --mode strict
pnpm oqb validate ./my-question-bank --mode release
```

CLI 命令也可以直接运行编译后的入口：

```sh
node packages/cli/dist/index.js validate ./my-question-bank
```

### 将题库单独交给 Git 管理

题库内容建议放在框架仓库之外，作为独立仓库保存。下面的命令仍在 OpenQuestionBank 仓库根目录执行：

```sh
pnpm oqb init ../my-question-bank
git -C ../my-question-bank init
git -C ../my-question-bank add .
git -C ../my-question-bank commit -m "初始化题库"
pnpm oqb validate ../my-question-bank
```

这样可以为题库单独设置远端仓库、访问权限和协作流程，并在框架升级时保留题库自己的 Git 历史。

## 一份题库包含什么

初始化后，目录大致如下：

```text
my-question-bank/
├── bank.yaml                 # 题库名称、版本、许可证和数据目录
├── topics/                   # 考点分类
├── knowledge/                # Markdown 知识笔记
├── questions/                # YAML 题目
├── groups/                   # 材料题组
├── exams/                    # 固定试卷或规则组卷模板
├── assets/                   # 图片及其他本地资源
└── README.md                 # 题库自己的使用说明
```

每个 YAML 文件保存一个实体。Knowledge 使用 Markdown 正文和 YAML Front Matter；目录由 `bank.yaml` 的 `paths` 配置。实体之间通过稳定 ID 关联，文件名可以按维护习惯调整。

### 添加一道题

在 `questions/` 下创建 YAML 文件，例如：

```yaml
id: question-001
type: single_choice
stem: 水的化学式是什么？
choices:
  - id: choice-a
    text: H2O
  - id: choice-b
    text: CO2
answer:
  choiceId: choice-a
explanation: 水分子由两个氢原子和一个氧原子组成。
topicIds: [topic-chemistry]
knowledgeIds: [knowledge-water]
difficulty: 入门
tags: [化学]
score: 1
source:
  type: original
review:
  status: draft
```

`type` 决定答案结构。V1.0 支持：`single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`numeric` 和 `short_answer`。每道题都需要稳定 `id`、考点和知识引用、难度、来源及审核状态。题型字段和答案示例见 [数据模型说明](docs/data-model.md)。

### 添加知识笔记

在 `knowledge/` 下创建 Markdown 文件：

```markdown
---
id: knowledge-water
title: 水的组成
topicIds: [topic-chemistry]
summary: 水分子的基本组成
prerequisiteIds: []
relatedIds: []
tags: [化学]
source:
  type: original
review:
  status: draft
---

# 水的组成

水分子的化学式是 H₂O。正文支持 Markdown、表格和数学公式。
```

题目和笔记使用 `knowledgeIds` / `topicIds` 关联考点及知识笔记；知识之间可以设置前置和相关关系。图片等本地资源放在 `assets/`，并在实体的 `assets` 字段及 Markdown 链接中使用题库根目录下的相对路径。Core 会检查资源是否存在以及路径是否越出题库目录。

## 校验模式

| 模式      | 适用时机         | 行为                                                                                           |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `draft`   | 日常录入、编辑   | 检查文件、Schema、实体引用和资源，不额外要求内容已审核或授权字段齐全                           |
| `strict`  | 发布前审核       | 保留全部结构有效实体；内容实体必须为 `approved`，并满足来源授权信息要求。未满足时以错误报告    |
| `release` | 生成发布候选内容 | 只保留审核通过且授权信息完整的知识、题目和题组；相关不可发布依赖会一并筛除，再校验最终引用关系 |

三种模式的校验细节见 [Core 使用说明](docs/core.md)。`release` 检查许可证和署名信息是否填写，不会判断许可证法律效力或许可证之间的兼容性。官方公开资料不自动代表允许转载。

## CLI 命令

```text
oqb init [目录]
oqb validate [目录] [--mode draft|strict|release]
oqb stats [目录] [--mode draft|strict|release]
oqb doctor [目录] [--mode draft|strict|release]
```

- `init` 从仓库模板创建题库。省略目录时使用当前目录；目标目录必须不存在或为空。
- `validate` 打印错误、警告、文件位置和修复建议。错误或致命错误使命令以退出码 `1` 结束。
- `stats` 按指定模式统计考点、知识、题目、题组和试卷；统计的是校验器保留的结构有效实体。
- `doctor` 检查 Node.js 版本、`bank.yaml` 加载结果和题库校验状态。
- 未知命令、参数错误或执行错误使用退出码 `2`；通过使用退出码 `0`。警告不会单独导致校验失败。

所有命令支持 `--help`，目录参数默认为当前目录。CLI 不要求交互输入，可用于本地脚本或 CI。

## 建议的维护流程

1. 使用 `oqb init` 创建独立题库仓库，修改 `bank.yaml` 中的题库 ID、名称、维护者、版本和许可证。
2. 按稳定 ID 添加考点、知识笔记和题目；录入时将审核状态保持为 `draft`。
3. 每次修改后运行 `oqb validate <目录>`，根据文件位置和建议修复诊断。
4. 审阅题目内容及来源授权后更新审核状态，再运行 `--mode strict`。
5. 发布前运行 `--mode release`，并检查被筛除内容和引用问题。
6. 使用 Git 提交题库文件的变更，保留可追踪的审核记录。

## 常见问题

### 为什么 `strict` 模式失败，而 `draft` 通过？

`strict` 要求每条 Knowledge、Question 和 QuestionGroup 的 `review.status` 为 `approved`。它也要求题库许可证明确；非原创来源还需要填写 `source.license` 和 `source.attribution`。请确认审核和实际授权后再补齐字段，不要仅为消除诊断而填写。

### 为什么实体 ID 不跟文件名走？

文件可移动或重命名，稳定 ID 用于维护题目、知识和考点之间的关系。实体关系不会因目录调整而改变。

### 为什么题库能通过 Schema 检查，仍然报告引用错误？

Schema 检查单个实体的字段结构；重复 ID、引用目标是否存在、关系是否形成环以及材料题完整性，需要 Core 在读取整份题库后检查。

### `release` 通过是否代表内容可以合法发布？

不代表。Core 只按保守规则检查审核状态和授权字段是否完整，不会判断内容权利归属、许可条款效力或许可兼容性。发布者仍需确认自己拥有发布权限。

### 是否可以直接导出到 Obsidian 或 Notion？

当前版本尚未实现平台导出器。现阶段可以用文件管理题库、运行校验和统计命令；导出属于后续 P3 阶段。

## 当前能力边界

已实现：Schema 1.0、YAML / Markdown 读取、结构和语义校验、资源检查、题库索引、审核授权模式、初始化模板、CLI 校验、统计和诊断。

尚未实现：规则组卷执行、自动评分、质量审核规则、GitHub Markdown / Obsidian / Notion / JSON 导出、在线刷题、账号、数据库和学习记录。项目架构和职责边界见 [架构说明](docs/architecture.md)。

## 开发与贡献

安装依赖并运行与代码贡献相关的检查：

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

`pnpm check` 会依次执行类型检查、ESLint、Vitest 和各包构建。模块依赖方向为 `schema → core → cli`；导出器可以依赖 `schema` 和 `core`。数据模型版本策略见 [Schema 版本策略](docs/schema-versioning.md)。
