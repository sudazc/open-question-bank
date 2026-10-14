# Core 使用说明

Core 从题库目录读取 `bank.yaml`，再根据 `Bank.paths` 发现实体文件。目录和关系引用都以稳定 ID 为准，不依赖实体文件名。

## 目录与文件

- `bank.yaml` 保存一个 `Bank` 实体
- 考点、题目、题组和试卷目录递归读取 `.yaml` 与 `.yml` 文件
- 知识目录递归读取 `.md` 文件，YAML Front Matter 保存 `Knowledge` 字段，分隔线之后的内容作为 `body`
- Core 不读取或执行资源文件内容；对实体引用到的资源检查路径边界、符号链接和文件存在性

每个文件只应保存一个实体。Core 按相对路径稳定排序后读取；实体文件名不需要与 ID 一致。

## API

```ts
import { validateQuestionBankDirectory } from '@openquestionbank/core';

const result = await validateQuestionBankDirectory('./my-bank');
if (!result.valid) {
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.file}: ${diagnostic.message}`);
  }
}

const release = await validateQuestionBankDirectory('./my-bank', { mode: 'release' });

const questions = result.index.questionsByKnowledge.get('knowledge-id') ?? [];
```

如果调用方需要分离文件读取和校验步骤，可以先使用 `loadQuestionBank(directory)`，再将结果传给 `validateQuestionBank(parsed)`。`ValidationResult.data` 只包含通过 Schema 结构校验的实体；`index` 对象提供按 ID 查询和双向关系查询。

## 校验职责

Core 当前执行以下检查：

- Draft 2020-12 Schema 结构，包括题型答案形状和各实体字段
- 同一实体类型内的重复 ID
- 考点、知识、题目、题组、试卷及 `oqb://` Markdown 引用目标
- 考点父子关系无环，知识前置依赖无环；普通相关知识关系允许成环
- 选择题答案选项 ID、嵌套选项 / 填空 / 评分项 ID 唯一性
- 题目最多属于一个题组，试卷题组项引用完整且正确的子题
- 固定试卷和生成结果中的题目、题组引用，以及规则组卷候选数量是否充足
- 文件 UTF-8 编码、文件大小、目录嵌套和题库根目录边界
- Knowledge、Question 和 QuestionGroup 的 `assets[]` 清单、Markdown 行内资源链接及文件存在性；资源路径必须位于 `Bank.paths.assets` 配置目录中，且各级路径不能包含符号链接

生成规则按精确难度标签筛选题目。按题组抽取时，考点筛选匹配题组；题型和难度筛选要求该题组的全部子题满足条件。Core 会报告不足的候选数，不会生成或裁剪试卷。

## 文件安全限制

默认单文件最大 2 MiB、实体文件最多 10,000 个、目录嵌套最多 32 层。YAML 最多展开 50 个别名，拒绝循环别名和超过 128 层的 YAML 结构。可通过 `LoadOptions` 调整文件大小和实体文件数量。Core 不执行 YAML 自定义代码、不跟随符号链接读取实体文件，也不允许配置目录解析到题库根目录之外。

资源校验会扫描知识正文、题干、解析和题组材料中的 Markdown 图片与链接目标，要求链接目标和实体 `assets[]` 清单一致，并确认文件存在。代码片段中的示例链接和外部 URL 不作为本地资源处理。

## 审核、授权与校验模式

`validateQuestionBank` 和 `validateQuestionBankDirectory` 支持 `draft`、`strict`、`release` 三种模式，默认使用 `draft`：

- `draft` 保持现有结构与语义校验行为，不因未审核或来源授权信息不足额外报错
- `strict` 保留全部结构有效实体；每个内容实体都必须为 `review.status: approved`，且满足下述授权信息要求，否则产生阻止校验通过的错误
- `release` 仅保留审核通过且满足授权信息要求的 `Knowledge`、`Question` 和 `QuestionGroup`；被筛除内容会产生 warning。依赖被筛除知识、题目或题组的实体及固定试卷 / 已生成试卷结果也会一并筛除，之后才校验最终引用图并构建 `data` 和 `index`

授权字段按保守规则检查：`original` 来源依赖 `Bank.license`；`official_public`、`licensed` 和 `adapted` 来源必须填写 `source.license` 与 `source.attribution`；`unknown` 来源不能进入 release。许可证字符串不按 SPDX 解析，也不会推断许可证兼容性或法律效力。公开可访问的官方资料不会自动获得发布资格。

`Topic` 与 `Exam` 没有审核或来源字段，因此不单独检查审核授权；模板试卷会在筛选后按剩余候选重新执行数量校验。Markdown 中指向被筛除内容的 `oqb://` 链接会在最终引用校验中产生错误，调用方应检查 `valid` 后再使用 release 数据。

## 诊断

每条诊断包含错误码、等级、消息和相对文件路径；可选字段包括实体 ID、字段路径、建议和行列位置。等级为 `fatal` 或 `error` 时 `ValidationResult.valid` 为 `false`；`warning` 和 `info` 不阻止校验通过。`release` 的 `data` 和 `index` 只包含最终筛选结果。
