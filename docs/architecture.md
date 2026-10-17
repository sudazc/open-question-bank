# 架构

## 分层

```text
schema → core → cli
   ↘       ↘    ↘
      exporters
```

- `schema` 定义与展示平台无关的数据合同、JSON Schema 和 TypeScript 类型，不负责读文件或扫描题库。
- `core` 负责 `bank.yaml` 和实体文件发现、YAML 与 Markdown Front Matter 解析、结构及语义校验、实体关联、索引、资源完整性、审核授权校验、确定性规则组卷和按标准答案评估客观题作答。
- `cli` 负责 `oqb` 命令、参数解析、题库初始化、校验、统计、诊断、构建、JSON / GitHub Markdown / Obsidian / Notion 导出和终端反馈。
- `exporters` 从 `core` 的统一内部数据模型生成标准 JSON 数据包、GitHub Markdown 阅读包、Obsidian Vault 和 Notion CSV / Markdown 导入包。

`core` 不依赖 CLI 或具体导出器；各包只通过公开接口协作，避免反向依赖和循环依赖。AI 协作流程由仓库根目录的 `AI_GUIDE.md` 描述：外部 AI 助手负责询问需求、检索或读取资料、生成题库文件；OpenQuestionBank 负责格式约束、校验和导出。题库内容由使用者维护，不与框架仓库绑定。

## 校验边界

JSON Schema 负责单实体结构：必填字段、字段类型、题型判别、枚举和可在单个文档内检查的基本限制。下面的检查需要 `core` 汇总并建立实体图后完成：

- ID 唯一性、引用目标存在及目标类型匹配。
- 考点父级有效且无环；知识前置关系无环；相关知识关系可成环。
- 题目选项 ID、填空 ID、题组子题和组卷引用之间的关联正确。
- `oqb://` 引用有效，发布过滤后没有悬空链接。
- 资源真实存在、路径解析后仍位于题库根目录内，并处理符号链接。
- 非原创来源建议提供 `source.url`；已填写的来源链接需为 HTTP / HTTPS URL。Core 不联网检查链接可访问性，也不验证链接页面内容。
- 空白必填文本、重复题干等基础内容质量问题，以及 Markdown 活动 HTML 和 SVG 活动内容；许可证兼容性仍需人工判断，审核状态和授权信息按 Core 发布模式执行保守校验。
- 规则组卷数量充足、跨规则不重复、抽样可复现以及算法版本符合要求。

JSON Schema 不执行题库内容中的代码。Core 将实体文件限制为 UTF-8，默认单文件上限为 2 MiB、实体文件上限为 10,000 个、目录嵌套上限为 32 层，并检查题库目录路径和符号链接的根目录边界。Markdown 原始 HTML 使用安全标签白名单，脚本协议链接和带活动内容的 SVG 会被拒绝；被引用 SVG 的安全扫描上限为 2 MiB。内容质量规则只覆盖空白必填文本和完全重复题干，不代替人工内容审核。许可证兼容性不自动判定。

## 当前交付边界

当前阶段包含 Workspace 配置、工程规范、Schema 1.0、TypeScript 类型、Core 读取 / 校验 / 规则组卷 / 客观题评分 API、CLI 初始化 / 校验 / 统计 / 诊断 / 构建、JSON / GitHub Markdown / Obsidian / Notion 导出命令、中文使用指南、跨平台 GitHub Actions CI 和按版本标签生成的 GitHub Release 构建包。完整内容质量规则、简答题自动语义评分及在线学习仍待后续实现。

JSON、GitHub Markdown、Obsidian Vault 与 Notion 导入包的文件合同、版本、清单和可复现规则分别见 [标准 JSON 导出说明](export-json.md)、[GitHub Markdown 导出说明](export-github-markdown.md)、[Obsidian Vault 导出说明](export-obsidian-vault.md) 和 [Notion 导入说明](export-notion-import.md)。
