# OpenQuestionBank

OpenQuestionBank 是一个面向 AI 协作构建题库的开源格式与本地工具框架，适合考试备考、学校课程、企业培训和个人学习。用户可以把项目链接发给 AI，AI 按项目指南询问题库主题与范围，主动查找现成公开题库、官方样题和可靠知识资料，或读取用户提供的题目、题库仓库和学习资料，再生成符合规范的题库。

本项目提供数据格式、AI 构建指南、题库模板、命令行校验和导出工具。AI 助手负责需求沟通、资料整理和题目编写；OpenQuestionBank 负责把生成的内容组织成可维护的 YAML / Markdown 源文件、发现格式和引用问题，并按需导出为可导入 Obsidian 或 Notion 的文件包。题库内容可通过 Git 版本管理、审阅和协作。

V1.0 基础能力已实现：Schema、Core 读取 / 校验 / 客观题评分、题库初始化模板、CLI 校验 / 统计 / 诊断、规则组卷、标准 JSON、GitHub Markdown、Obsidian Vault 和 Notion CSV / Markdown 导入包。在线刷题和学习记录尚未实现。

## 适合什么场景

- 用普通文件长期维护题目、知识笔记、考点、材料题组和试卷
- 在 Git 中查看题目修改历史，并通过分支或 Pull Request 审阅内容
- 在编辑期间快速发现格式错误、重复 ID、无效引用或缺失资源
- 在发布前检查审核状态和内容授权信息
- 为后续导出或其他工具提供稳定、平台无关的数据源

OpenQuestionBank 是本地运行的软件框架，不提供在线题库网站、用户账号或数据库服务，也不内置 AI 模型。资料检索和题目编写由用户选择的 AI 助手完成；本项目提供格式规范、文件模板、校验和导出能力。每个题库可以作为独立 Git 仓库维护，与本框架仓库分开。

## 快速开始

### 用 AI 构建题库

把 [OpenQuestionBank 项目主页](https://github.com/sudazc/open-question-bank) 或 [AI 题库构建指南](AI_GUIDE.md) 发给 AI 助手即可开始，不需要提前准备主题或资料。AI 会先问你想创建哪方面的题库，再确认适用人群、覆盖范围、题量、题型和难度。你可以提供现成题目、已有题库仓库、教材、讲义、课程大纲或其他资料链接；如果没有资料，AI 会主动搜索现成公开题库、官方样题和权威知识来源，优先收录许可明确允许再发布的题目，并用可靠资料补足题库。

AI 会整理并记录实际使用的来源，生成题库源文件，再运行 OpenQuestionBank 校验。来源授权不明确时，AI 不会批量转载题目，而会依据可靠知识资料补充原创题目。完成后可按需导出 Obsidian Vault 或 Notion 导入包。项目链接告诉 AI 如何构建和校验题库；题库内容来自 AI 检索到的题目和知识来源，或你主动提供的资料。AI 无法访问网页或仓库时，会说明情况并请你粘贴或上传内容。

可以这样开始：

```text
请先阅读 OpenQuestionBank 的 AI 构建指南：
https://github.com/sudazc/open-question-bank/blob/main/AI_GUIDE.md

收到这个链接后，请先阅读指南，并先问我想创建哪方面的题库。确认方向后，再问清楚适用人群、覆盖范围、题量和题型。我可能提供现成题目、已有题库仓库或资料链接；如果没有提供资料，请主动查找可访问的权威公开来源并记录链接。请按指南生成并校验题库，最后按我的选择导出为可导入 Obsidian 或 Notion 的文件包。
```

AI 交付的核心内容是独立题库目录，其中包含题库配置、考点 / 知识 / 题目文件、来源信息和校验结果。Obsidian Vault 或 Notion 导入包是从这份源数据生成的展示格式；导入 Notion 时由用户选择何时导入单独的答案与解析表。

### 环境要求

- Node.js `>=22.13.0`
- pnpm `11.25.0`（版本由 `packageManager` 字段锁定）

### 下载已构建版本

后续版本发布后，可在 [GitHub Releases](https://github.com/sudazc/open-question-bank/releases) 下载 `openquestionbank-v<版本>-prebuilt.tar.gz`，解压后在目录内安装运行依赖：

```sh
tar -xzf openquestionbank-v0.1.0-prebuilt.tar.gz
cd openquestionbank-v0.1.0
pnpm install --prod --frozen-lockfile
pnpm oqb --help
pnpm oqb init ../my-question-bank
pnpm oqb validate ../my-question-bank
```

发布包已包含编译后的 CLI、模板和文档；首次使用仍需联网安装运行依赖。每个 Release 同时提供 `SHA256SUMS`，下载后可按 [Release 下载与校验说明](docs/release.md) 验证文件。也可以从 Release 页面下载 GitHub 自动生成的源码快照，再按本地开发方式安装依赖并构建。

目前仓库还没有已发布的 Release，因此暂时没有可下载的预构建版本。现在可以克隆源码仓库，再按[创建题库](#创建题库)中的步骤构建和使用。

### 创建题库

在 OpenQuestionBank 仓库根目录运行：

```sh
pnpm install
pnpm build
pnpm oqb --help
pnpm oqb init ./my-question-bank
```

`init` 会创建一个可以直接校验的题库示例，供理解格式和验证工具使用，不是可直接交付的正式题库。如果目标目录不存在，命令会创建它；如果目录已存在，它必须为空。命令不会覆盖已有文件。开始实际建库时，请替换或删除示例题目、知识笔记和考点，并按实际内容修改 `bank.yaml` 中的题库信息。许可证默认是 `TBD - not for publication`；确认实际授权前不要替换该值，`strict` 和 `release` 模式会拒绝待确认许可证。

### 校验和查看题库

```sh
pnpm oqb validate ./my-question-bank
pnpm oqb stats ./my-question-bank
pnpm oqb doctor ./my-question-bank
pnpm oqb build ./my-question-bank --out ./dist/my-question-bank
pnpm oqb export ./my-question-bank --format json --out ./dist/my-question-bank
pnpm oqb export ./my-question-bank --format github-markdown --out ./dist/my-question-bank-github
pnpm oqb export ./my-question-bank --format obsidian --out ./dist/my-question-bank-obsidian
pnpm oqb export ./my-question-bank --format notion --out ./dist/my-question-bank-notion
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

`type` 决定答案结构。V1.0 支持：`single_choice`、`multiple_choice`、`true_false`、`fill_blank`、`numeric` 和 `short_answer`。每道题都需要稳定 `id`、题干、正确答案、难度、来源及审核状态。AI 建库时应至少关联一个考点或知识笔记；Schema 要求 `topicIds` 和 `knowledgeIds` 为数组，Core 会检查引用目标；两类关联都为空时会发出不阻断校验的质量警告。填空题用 `{{blank-id}}` 标记题干中的空，并在答案中使用对应 ID。题型字段和答案示例见 [数据模型说明](docs/data-model.md) 和 [AI 构建指南](AI_GUIDE.md)。

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

题目和笔记使用 `knowledgeIds` / `topicIds` 关联考点及知识笔记；知识之间可以设置前置和相关关系。图片等本地资源放在 `assets/`，并在实体的 `assets` 字段及 Markdown 链接中使用题库根目录下的相对路径。Core 校验和导出器都会检查资源是否存在、路径边界及每一层路径中的符号链接。默认情况下，一份题库中所有被实体引用的资源文件累计最多为 256 MiB；CLI 校验和导出都会执行此限制，未被实体引用的文件不计入。调用 Core 的 `LoadOptions.maxTotalAssetBytes` 或导出 API 的同名选项可以调整上限。为兼容 Windows、macOS 和 Linux 导出，资源文件名每段不能包含 Windows 非法字符（包括 `:`）或控制字符，不能以点或空格结尾，不能使用 `CON`、`NUL` 等设备名，每段 UTF-8 长度不能超过 255 字节；资源与生成文件之间也不能在大小写折叠或 Unicode 规范化后重名，不能发生文件与目录冲突。遇到导出路径错误时，请重命名冲突文件后再导出。

## 校验模式

| 模式      | 适用时机         | 行为                                                                                           |
| --------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `draft`   | 日常录入、编辑   | 检查文件、Schema、实体引用和资源，不额外要求内容已审核或授权字段齐全                           |
| `strict`  | 发布前审核       | 保留全部结构有效实体；内容实体必须为 `approved`，并满足来源授权信息要求。未满足时以错误报告    |
| `release` | 生成发布候选内容 | 只保留审核通过且授权信息完整的知识、题目和题组；相关不可发布依赖会一并筛除，再校验最终引用关系 |

三种模式的校验细节见 [Core 使用说明](docs/core.md)。非原创来源缺少来源链接或链接不是 HTTP / HTTPS 时会显示警告；维护者 URL、来源 URL、Markdown 链接目标或正文中的 HTTP(S) 自动链接含 authority 用户名 / 密码或常见凭据查询 / 片段参数时会阻止导出，诊断不会回显凭据。检查覆盖 `token`、`access_token`、`api_key`、`key`、`signature` 及常见云存储签名参数；普通查询参数不受影响。公开 exporter API 也执行这项检查，不能绕过 CLI 校验直接导出凭据。Core 不联网检查链接可访问性。`strict` 和 `release` 会拒绝空值及明确的待确认许可证或署名占位值，但不会判断许可证法律效力或许可证之间的兼容性。官方公开资料不自动代表允许转载。

Core 会拒绝 Markdown 中的活动 HTML、不受支持的 URI 协议、格式错误的 `oqb://` 引用、Obsidian Wiki 双链和包含活动内容的 SVG。外部链接只允许 `http:`、`https:`、`mailto:` 和 `tel:`；平台专用的 `obsidian:`、`vscode:`、`[[...]]` / `![[...]]` 及文件协议不能写入源题库，内部引用统一使用 `oqb://`。Markdown 链接目标和正文中的 HTTP(S) 自动链接不得包含 URL 用户名 / 密码或常见凭据查询 / 片段参数，避免导出时泄露访问凭据。正文可使用 `br`、`hr`、`sub`、`sup`、`kbd`、`mark`、`details`、`summary` 这些安全标签；代码块中的脚本示例不会触发安全诊断。质量检查会拒绝只含空白字符的必填文本，并对完全重复的题干发出警告；内容准确性、难度和干扰项质量仍需人工审核。

## CLI 命令

```text
oqb init [目录]
oqb validate [目录] [--mode draft|strict|release]
oqb build [目录] [--format json|github-markdown|obsidian|notion] [--out <目录>] [--mode draft|strict|release] [--seed <随机种子>]
oqb stats [目录] [--mode draft|strict|release]
oqb doctor [目录] [--mode draft|strict|release]
oqb export [目录] [--format json|github-markdown|obsidian|notion] [--out <目录>] [--mode draft|strict|release]
oqb export <格式> [目录] [--out <目录>] [--mode draft|strict|release]
```

- `init` 从仓库模板创建题库。省略目录时使用当前目录；目标目录必须不存在或为空。
- `validate` 打印错误、警告、文件位置和修复建议。错误或致命错误使命令以退出码 `1` 结束。
- `build` 校验后构建所选格式；题库包含规则组卷模板时，必须使用 `--seed` 生成实际试卷。结果只写入构建输出，不改写题库源文件。
- `stats` 按指定模式统计考点、知识、题目、题组和试卷；统计的是校验器保留的结构有效实体。
- `doctor` 检查 Node.js 版本、`bank.yaml` 加载结果和题库校验状态。
- `export` 先校验题库，再按所选格式生成数据包和 `manifest.json`。格式默认为 `json`，也可以选择 `github-markdown`、`obsidian` 或 `notion`。输出目录默认为命令运行目录下的 `dist`；也可以使用 `--out` 指定路径。`--mode release` 只导出通过发布筛选和最终引用校验的数据。
- 对已有导出目录再次导出时，工具会根据上一份 OpenQuestionBank 清单移除本次不再生成且内容未被修改的旧文件；用户修改过的旧文件和清单未登记的文件会保留。
- `export` 也支持 `pnpm oqb export github <目录>`、`pnpm oqb export obsidian <目录>`、`pnpm oqb export notion <目录>` 和 `pnpm oqb export json <目录>`。其中 `github` 是 `github-markdown` 的简写。格式位置参数与 `--format` 不能同时使用；如果题库目录名恰好是 `github`、`obsidian`、`notion` 或 `json`，请将目录写成 `./名称` 或改用 `--format`。
- 未知命令、参数错误或执行错误使用退出码 `2`；通过使用退出码 `0`。警告不会单独导致校验失败。

所有命令支持 `--help`，目录参数默认为当前目录。CLI 不要求交互输入，可用于本地脚本或 CI。

需要在自己的程序中按标准答案评估作答时，可调用 Core 的 `evaluateQuestionAnswer` API。客观题采用全对计分，简答题交由人工审核；接口示例和数值容差规则见 [Core 使用说明](docs/core.md#答案评分)。CLI 当前负责题库校验、构建和导出，不提供交互式刷题。

### 构建规则组卷并导出

`build` 会先校验题库，再生成所选格式的导入包。题库中的规则组卷模板会在构建副本中替换为实际试卷结果；源目录中的 YAML 文件不会修改。若题库包含规则模板，必须提供 `--seed`，生成结果会记录随机种子、题库版本和算法版本。同一份题库、模板和种子会生成相同的题目及顺序。若规则候选重叠，算法会回溯尝试其他组合；最多检查 100,000 个候选组合，超过上限会报告搜索未完成。

```sh
pnpm oqb build ./my-question-bank --seed practice-001 --format obsidian --out ./dist/practice-001
pnpm oqb build ./my-question-bank --seed practice-001 --format notion --out ./dist/notion-practice-001
```

`--format` 默认为 `json`，也可选择 `github-markdown`、`obsidian` 或 `notion`。没有规则组卷模板时，`--seed` 可省略。规则之间不会重复抽取题目；题组作为整体抽取，并按模板分值为每道子题设置分数。若候选重叠，组卷器会回溯搜索可行组合；搜索超过 100,000 个候选组合时会返回 `SEARCH_LIMIT_REACHED`，此时需要收窄筛选条件或拆分试卷模板。

### 导出标准 JSON

例如，将独立题库校验后输出到单独的构建目录：

```sh
pnpm oqb export ../my-question-bank --format json --out ./dist/my-question-bank
```

导出包包含完整的 Bank、Topic、Knowledge、Question、QuestionGroup 和 Exam 数据，并保留 Markdown 正文、稳定 ID、资源相对路径及实体引用；题库引用到的资源文件也会按原路径复制。实体集合按 ID 稳定排序，导出的 `manifest.json` 提供题库版本、实体统计、JSON 和资源文件的大小及 SHA-256，便于自动化检查和后续导入。校验失败时不会生成文件；警告会显示，但不会单独阻止导出。重复导出会更新当前仍生成的文件；本次不再生成且与上一份清单校验值一致的旧文件会移除，用户修改过的旧文件和清单未登记文件会保留。导出中途失败时会保留上一版清单；修复目标路径问题后重新运行导出，可继续清理旧页面并生成完整的新清单。

导出格式字段、目录结构和可复现规则见 [标准 JSON 导出说明](docs/export-json.md)。

### 导出 GitHub Markdown 阅读包

将题库渲染为适合放进 GitHub 仓库浏览的 Markdown 页面：

```sh
pnpm oqb export ../my-question-bank --format github-markdown --out ./dist/my-question-bank-github
```

导出目录包含题库总览 `README.md`、考点 / 知识 / 题目 / 题组 / 试卷分类索引，以及每个实体的独立页面。题目页展示题干、选项、答案和解析；知识页保留 Markdown 正文；实体关系和正文中的 `oqb://` 引用会转为相对页面链接，资源链接会按新页面位置改写，引用资源会复制到导出目录。`manifest.json` 记录导出格式、题库版本、实体统计，以及每个 Markdown 和资源文件的大小与 SHA-256。

导出的相对链接可随整个目录一起移动；如果要发布到 GitHub Pages，仍需按实际站点配置检查 Pages 的访问路径和 GitHub 对 Markdown / HTML 的渲染策略。格式、页面映射和可复现约定见 [GitHub Markdown 导出说明](docs/export-github-markdown.md)。

### 导出 Obsidian Vault

将题库生成可由 Obsidian 直接打开的 Vault：

```sh
pnpm oqb export ../my-question-bank --format obsidian --out ./dist/my-question-bank-obsidian
```

输出包含题库总览、考点 / 知识 / 题目 / 题组 / 试卷索引、实体独立页面、引用的资源文件和 `manifest.json`。页面文件名使用考点名、知识标题、题干或试卷名；稳定 ID 保存在 Obsidian 属性中，实体关系及内联 `oqb://` 正文引用转换为 Wiki 链接；引用式 Markdown 链接保留原有写法，并改写为 Vault 内的相对路径。题目页不在选项上标记正确答案，答案和解析默认折叠，并按稳定 ID 顺序提供上一题 / 下一题导航。内联图片资源以嵌入链接呈现，其他内联资源以 Wiki 链接呈现；引用式资源链接保留引用写法并更新目标路径。导出目录可以直接在 Obsidian 中作为 Vault 打开，也可以随目录移动。

`--mode release` 会沿用发布筛选，仅导出审核和授权条件通过且引用关系完整的数据。清单记录题库版本、实体统计，以及每个 Markdown 和资源文件的大小及 SHA-256。使用方法、路径映射和清单格式见 [Obsidian Vault 导出说明](docs/export-obsidian-vault.md)。

### 导出 Notion 导入包

生成适合手动导入 Notion 的 CSV 数据库和 Markdown 页面：

```sh
pnpm oqb export ../my-question-bank --format notion --out ./dist/my-question-bank-notion
```

`databases/` 包含题库、考点、知识、题目、答案与解析、题组和试卷七份 CSV。题目表首列是可读题干标题，选项不标正确答案；答案和解析单独放在 `answers.csv`，练习时可以先不导入。Markdown 题目页也不包含答案正文，并提供上一题 / 下一题导航；知识正文、试卷内容和引用资源会一并导出。`relations.csv` 按稳定 ID 列出实体关联，CSV 中的 `Json` 列保留数组等复杂结构，`manifest.json` 记录 CSV、Markdown 和资源的大小及 SHA-256。

在 Notion 中分别导入 CSV 可创建对应数据库。建议先导入题目表用于练习，完成后再导入答案表；题目表中的 `typeLabel` 是中文题型名，`type` 保留 Schema 使用的机器值。`relations.csv` 是供人工核对和建立 Relation 属性的映射表，导出器不会自动创建 Notion 原生双向关系，也不会自动连接记录；具体导入步骤、字段说明和关系表格式见 [Notion 导入说明](docs/export-notion-import.md)。

## 建议的维护流程

1. 使用 `oqb init` 创建独立题库仓库，修改 `bank.yaml` 中的题库 ID、名称、维护者、版本和许可证。
2. 按稳定 ID 添加考点、知识笔记和题目；录入时将审核状态保持为 `draft`。
3. 每次修改后运行 `oqb validate <目录>`，根据文件位置和建议修复诊断。
4. 审阅题目内容及来源授权后更新审核状态，再运行 `--mode strict`。
5. 发布前运行 `--mode release`，检查被筛除内容和引用问题，再运行 `oqb export <目录> --mode release --out ./dist` 生成数据包。
6. 检查 `manifest.json` 中的统计和 SHA-256，再使用 Git 提交题库文件的变更，保留可追踪的审核记录。

如果修改了已审核内容的题干、答案、解析、知识正文、共享材料、来源授权或关键引用，应先把审核状态改为 `pending`，并清除旧版本的 `reviewer`、`reviewedAt`；完成新一轮人工审核后再设为 `approved`。Core 只检查当前审核字段，不会比较内容与上次审核时的版本，因此需要在 Git 变更审阅中执行这一步。

## 常见问题

### 为什么 `strict` 模式失败，而 `draft` 通过？

`strict` 要求每条 Knowledge、Question 和 QuestionGroup 的 `review.status` 为 `approved`。它也要求题库许可证明确；非原创来源还需要填写有效的 `source.license` 和 `source.attribution`。待确认占位值（例如 `TBD`、`unknown` 或 `TBD - not for publication`）不会被视为授权信息。请确认审核和实际授权后再补齐字段，不要仅为消除诊断而填写。

### 为什么实体 ID 不跟文件名走？

文件可移动或重命名，稳定 ID 用于维护题目、知识和考点之间的关系。实体关系不会因目录调整而改变。

### 为什么题库能通过 Schema 检查，仍然报告引用错误？

Schema 检查单个实体的字段结构；重复 ID、引用目标是否存在、关系是否形成环以及材料题完整性，需要 Core 在读取整份题库后检查。

### `release` 通过是否代表内容可以合法发布？

不代表。Core 只按保守规则检查审核状态和授权字段是否完整，不会判断内容权利归属、许可条款效力或许可兼容性。发布者仍需确认自己拥有发布权限。

### 是否可以导出到 Obsidian 或 Notion？

当前版本可以导出标准 JSON 数据包、GitHub Markdown 阅读包、Obsidian Vault 和 Notion CSV / Markdown 导入包。Notion 导入包提供独立 CSV 数据库与稳定 ID 关系映射；用户需要在 Notion 中自行建立 Relation 属性并连接记录。标准源数据仍不包含平台专属链接。

## 当前能力边界

已实现：Schema 1.0、YAML / Markdown 读取、结构和语义校验、资源检查、题库索引、审核授权模式、初始化模板、确定性规则组卷、CLI 构建 / 校验 / 统计 / 诊断、标准 JSON 导出、GitHub Markdown 阅读包、Obsidian Vault、Notion CSV / Markdown 导入包和发布清单。

尚未实现：简答题自动语义评分，以及自动判断题干是否清晰、答案和解析是否符合来源等需要语义判断的内容审核；这些内容仍应由人工审核或按 [AI 构建指南](AI_GUIDE.md) 使用外部 AI 助手核对。项目也不提供在线刷题、账号、数据库和学习记录。项目架构和职责边界见 [架构说明](docs/architecture.md)。

## 许可证

本项目框架代码及随项目分发的文档采用 [MIT License](LICENSE)。题库内容和来源资料的使用、修改与再发布权限由各题库自己的 `bank.yaml` 及来源授权信息决定，不由框架许可证自动授予。

## 开发与贡献

安装依赖并运行与代码贡献相关的检查：

```sh
pnpm install
pnpm test
pnpm check
pnpm format:check
```

`pnpm test` 会先构建 workspace 包，再运行 Vitest；`pnpm check` 会执行类型检查、ESLint、构建和测试。CI 会在 Linux、Windows、macOS 上执行这些检查。提交方式、代码约定和版本规则见[贡献指南](CONTRIBUTING.md)；模块依赖方向为 `schema → core → cli`，导出器可以依赖 `schema` 和 `core`。数据模型版本策略见 [Schema 版本策略](docs/schema-versioning.md)。
