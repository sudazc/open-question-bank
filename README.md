# OpenQuestionBank

OpenQuestionBank 是面向多种考试、培训和知识整理场景的开源题库框架。它以可版本控制的文件维护题库内容，使用稳定 ID 表达实体关系，并将标准数据与 Markdown、Obsidian、Notion 等展示平台分离。

当前仓库处于 V1.0 的 P1 阶段：已建立 pnpm Monorepo、JSON Schema Draft 2020-12 数据标准，并实现 Core 文件读取、结构和关系校验、资源完整性检查、实体索引以及审核和授权校验模式。CLI、组卷执行、内容质量校验、导出和初始化模板仍待后续阶段。

## 环境要求

- Node.js `>=22.13.0`（当前开发环境为 Node.js 24 LTS）
- pnpm `11.25.0`，版本由 `packageManager` 字段锁定

## 开发命令

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

`pnpm check` 会依次执行类型检查、ESLint、Vitest 和各包构建。

## 仓库结构

| 路径                      | 职责                                             |
| ------------------------- | ------------------------------------------------ |
| `packages/schema`         | 版本化 JSON Schema 与公共 TypeScript 数据类型    |
| `packages/core`           | YAML / Markdown 读取、结构与关系校验、索引和诊断 |
| `packages/cli`            | 后续承载命令行入口和用户交互                     |
| `packages/exporters`      | 后续承载平台无关的导出接口及具体导出器           |
| `templates/question-bank` | 后续供 `oqb init` 使用的题库模板                 |
| `examples`                | 独立阅读的通用题库示例                           |
| `tests`                   | Schema 合法、非法及边界数据和自动化测试          |
| `docs`                    | 架构、数据模型和版本策略                         |

各模块边界及当前未实现范围见 [架构说明](docs/architecture.md)。Schema 1.0 的实体和字段约定见 [数据模型](docs/data-model.md)。

Core 的题库目录格式、校验职责与 API 示例见 [Core 使用说明](docs/core.md)。
