# Core 使用说明

Core 从题库目录读取 `bank.yaml`，再根据 `Bank.paths` 发现实体文件。目录和关系引用都以稳定 ID 为准，不依赖实体文件名。

## 目录与文件

- `bank.yaml` 保存一个 `Bank` 实体
- 考点、题目、题组和试卷目录递归读取 `.yaml` 与 `.yml` 文件
- 知识目录递归读取 `.md` 文件，YAML Front Matter 保存 `Knowledge` 字段，分隔线之后的内容作为 `body`
- `Bank.paths` 中配置的考点、知识、题目、题组、试卷和资源目录不能相同或互相嵌套；冲突时 Core 在读取实体前报告 `OQB-FILE-021`
- Core 不执行资源文件；对实体引用到的资源检查路径边界、符号链接和文件存在性，并扫描 SVG 活动内容

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

## 答案评分

`evaluateQuestionAnswer(question, response)` 按题目保存的答案规则评分。传入的题目应来自通过校验的 `QuestionBankData`；作答使用独立于题库实体的联合类型，不会写入题库文件。

```ts
import { evaluateQuestionAnswer, validateQuestionBankDirectory } from '@openquestionbank/core';

const validated = await validateQuestionBankDirectory('./my-bank');
if (!validated.valid) {
  throw new Error('题库校验未通过');
}

const question = validated.data.questions.find((item) => item.id === 'question-001');
if (!question) {
  throw new Error('题目不存在');
}

const result = evaluateQuestionAnswer(question, {
  type: 'single_choice',
  choiceId: 'choice-a',
});
if (result.status === 'graded') {
  console.log(result.earnedScore, result.maxScore, result.isCorrect);
}
```

单选、多选、判断、填空和数值题会返回 `status: 'graded'`、是否正确、得分和题目总分。V1 采用整题全对得分的策略，不提供多选或多空的部分得分。多选按正确选项集合完全匹配，选项顺序不影响结果，重复选项会判错。填空题要求所有空都正确；题干使用 `{{blank-id}}` 标记每个空，Core 校验每个答案空项都有且只有一个对应占位符，并忽略 Markdown 代码中的示例。`caseSensitive` 缺省为 `false`，`whitespace` 缺省为 `trim`，`collapse` 会折叠连续空白，`exact` 保留空白原样。简答题返回 `status: 'manual_review'` 和待评总分，不尝试自动理解文本。

数值答案和作答都使用十进制字符串，不接受指数写法，评分通过整数系数和 `BigInt` 比较，不使用浮点数。容差缺省为零；当数值误差不大于绝对容差或不大于 `abs(标准答案) × 相对容差` 时判为正确。无效的用户数值格式判错。`unitRule` 为 `required` 时必须提交标准单位或 `acceptedUnits` 中的单位；`optional` 允许省略单位，但提交时仍须匹配；`ignored` 不检查单位。未设置 `unitRule` 时，已有标准单位必须精确匹配，标准答案没有单位时作答也不能附带单位。

## 校验职责

Core 当前执行以下检查：

- Draft 2020-12 Schema 结构，包括题型答案形状和各实体字段
- 同一实体类型内的重复 ID
- 考点、知识、题目、题组、试卷及 `oqb://` Markdown 引用目标
- 考点父子关系无环，知识前置依赖无环；普通相关知识关系允许成环
- 选择题答案选项 ID、嵌套选项 / 填空 / 评分项 ID 唯一性，以及填空题题干占位符与答案空项的一一对应关系
- 题目最多属于一个题组，试卷题组项引用完整且正确的子题
- 固定试卷和生成结果中的题目、题组引用，以及规则组卷候选数量是否充足；已生成结果记录的题库版本与当前题库版本不一致时发出非阻断警告
- 题库名称、许可证、维护者名称、考点和知识标题、知识正文、题干、难度、选项、填空允许答案、简答参考答案与评分要点、题组和试卷必填文本是否只含空白字符；题库、考点、知识、题目和试卷的可选说明字段只含空白时发出 warning；题目未关联任何考点或知识笔记、题干重复、选项重复和按评分规则规范化后的填空允许答案重复时发出 warning
- Markdown 中的活动 HTML、脚本协议链接和 SVG 中的脚本、事件或外部资源
- 文件 UTF-8 编码、文件大小、目录嵌套和题库根目录边界
- Knowledge、Question 和 QuestionGroup 的 `assets[]` 清单、Markdown 行内资源链接及文件存在性；资源路径必须位于 `Bank.paths.assets` 配置目录中，且各级路径不能包含符号链接

生成规则按精确难度标签筛选题目。按题组抽取时，考点筛选匹配题组；题型和难度筛选要求该题组的全部子题满足条件。校验器检查每条规则的候选数量；生成时还会按模板顺序排除已选题目和题组子题。如果多条规则各自候选充足但组合后不足，Core 会明确报错，不会减少题量。

## 规则组卷

`generateExam(data, templateId, randomSeed)` 接收已校验的题库数据、模板 ID 和 1 至 128 个非空字符的随机种子，返回 `GeneratedExamResult`。结果保留模板 ID 和说明字段，并写入题目实际顺序、随机种子、题库版本及抽题算法版本；原始模板不会被修改。

校验已生成结果时，Core 会将结果的 `bankVersion` 与当前 `Bank.version` 对照。两者不一致时发出非阻断警告；历史结果仍可保留，需要基于当前题库出卷时可按规则模板重新生成。

```ts
import { generateExam, validateQuestionBankDirectory } from '@openquestionbank/core';

const validated = await validateQuestionBankDirectory('./my-bank');
if (!validated.valid) {
  throw new Error('题库校验未通过');
}

const exam = generateExam(validated.data, 'exam-template', 'practice-001');
```

算法版本 `1.2.0` 按候选余量（候选数减需求数）从小到大处理规则，余量相同时按模板顺序处理；每条规则的候选按稳定 ID 排序后使用 SHA-256 种子流和 Fisher–Yates 洗牌。若一组选择导致后续规则候选不足，算法会回溯并尝试其他候选组合。最多检查 100,000 个候选组合；超过上限时抛出 `SEARCH_LIMIT_REACHED`，表示尚未确认规则组合是否可行。只有完成搜索后仍无可行组合时，才抛出 `INSUFFICIENT_CANDIDATES`，错误包含规则位置、所需数量和剩余数量。最终试卷仍按模板规则顺序输出；固定同一题库数据、模板和随机种子时，结果题目与顺序保持一致。

## 文件安全限制

默认单个实体文件最多读取 2 MiB，题库配置及实体文件累计读取上限为 64 MiB；检测超限时最多额外读取 1 字节。实体文件最多 10,000 个，实体目录最多扫描 50,000 个文件和子目录条目，目录嵌套最多 32 层。YAML 最多展开 50 个别名，拒绝循环别名和超过 128 层的 YAML 结构。被引用资源的累计大小默认最多为 256 MiB；只统计实体 `assets[]` 或 Markdown 链接中声明的资源，同一路径只计一次。被引用的 SVG 文件另有 2 MiB 单文件上限，并以 UTF-8 读取检查；超限、无法解码或包含活动内容时会阻止校验通过。可通过 `LoadOptions` 调整单文件、题库文本累计大小、引用资源累计大小、实体文件数量和目录扫描条目限制；各导出 API 也可通过 `maxTotalAssetBytes` 选项调整资源累计上限。Core 不执行 YAML 自定义代码、不跟随符号链接读取实体文件，也不允许配置目录解析到题库根目录之外。

复用 SVG 安全规则时，可使用 `maxSvgAssetBytes` 获取单文件上限，并用 `getSvgSecurityIssue(source)` 检查 SVG 文本；安全内容返回 `undefined`，否则返回问题说明。导出器会对实际复制的 SVG 内容再次执行同一检查。

Markdown 允许常用安全标签 `br`、`hr`、`sub`、`sup`、`kbd`、`mark`、`details` 和 `summary`。其他原始 HTML、文档实体声明及不受支持的 URI 协议会被拒绝；外部 Markdown 链接只允许 `http:`、`https:`、`mailto:` 和 `tel:`，内部引用必须符合 `oqb://{topic|knowledge|question|exam}/{id}` 格式并指向存在的实体。文件协议和应用专用协议（例如 `obsidian:`、`vscode:`）不允许进入题库正文；Obsidian Wiki 双链和嵌入（`[[...]]`、`![[...]]`）也不属于源格式，会产生 `OQB-REF-005` 错误。代码块、行内代码、转义文本，以及使用 `$...$`、`$$...$$`、`\(...\)` 或 `\[...\]` 界定的数学公式中的示例不参与相应引用检查。SVG 只允许静态图形，不允许脚本、事件处理器、样式、动画、外部引用或 XML 实体。该策略会拦截内容，不会把输入改写成经过净化的 HTML。

内容质量检查会拒绝仅含空白字符的题库名称、许可证、维护者名称、题目难度和答案要点等必填文本；在 strict / release 模式下，许可证空值由授权校验报告。它还会对完全重复的题干，以及经大小写、空白和 Unicode 兼容字符规范化后重复的选择题选项发出警告。警告不阻止草稿校验或导出；内容正确性、难度平衡、干扰项质量等仍需人工审核。

资源校验会扫描知识正文、题干、解析和题组材料中的 Markdown 图片与链接目标，要求链接目标和实体 `assets[]` 清单一致，并确认文件存在。代码片段中的示例链接和外部 URL 不作为本地资源处理。

## 审核、授权与校验模式

`validateQuestionBank` 和 `validateQuestionBankDirectory` 支持 `draft`、`strict`、`release` 三种模式，默认使用 `draft`：

- `draft` 保持现有结构与语义校验行为，不因未审核或来源授权信息不足额外报错
- `strict` 保留全部结构有效实体；每个内容实体都必须为 `review.status: approved`，且满足下述授权信息要求，否则产生阻止校验通过的错误
- `release` 仅保留审核通过且满足授权信息要求的 `Knowledge`、`Question` 和 `QuestionGroup`；被筛除内容会产生 warning。依赖被筛除知识、题目或题组的实体及固定试卷 / 已生成试卷结果也会一并筛除，之后才校验最终引用图并构建 `data` 和 `index`

授权字段按保守规则检查：`original` 来源依赖 `Bank.license`；`official_public`、`licensed` 和 `adapted` 来源必须填写有效的 `source.license` 与 `source.attribution`；`unknown` 来源不能进入 release。strict / release 会拒绝空值和常见待确认占位值，例如 `TBD`、`unknown` 和 `TBD - not for publication`。许可证字符串不按 SPDX 解析，也不会推断许可证兼容性或法律效力。公开可访问的官方资料不会自动获得发布资格。

`Topic` 与 `Exam` 没有审核或来源字段，因此不单独检查审核授权；模板试卷会在筛选后按剩余候选重新执行数量校验。Markdown 中指向被筛除内容的 `oqb://` 链接会在最终引用校验中产生错误，调用方应检查 `valid` 后再使用 release 数据。

已填写的来源链接应为有效的 HTTP / HTTPS URL。URL authority 中可识别出用户名或密码，或查询 / 片段参数中包含常见访问凭据时，会产生阻止校验通过的 `OQB-SOURCE-003` 错误，即使该 URL 格式错误或使用其他协议也会阻止导出；诊断不会回显凭据。常见凭据参数包括 `token`、`access_token`、`refresh_token`、`api_key`、`key`、`password`、`signature`、`sig`、AWS / Google 云存储签名参数等，参数名大小写及连字符、下划线差异不敏感，空值不会触发诊断。`Bank.maintainers[].url` 使用相同的凭据检查规则，命中时产生 `OQB-SECURITY-004` 错误。普通查询参数（如 `q`、`page`）不受影响。Markdown 链接目标及正文中的 HTTP(S) 自动链接也会检查这些凭据，命中 authority 用户名 / 密码或常见凭据查询 / 片段参数时会产生 `OQB-SECURITY-003` 错误。公开 exporter API 会重复检查维护者链接、来源链接和 Markdown 链接，即使调用方直接使用 API 而未经过 CLI，也不会生成带已识别凭据的导出包。来源链接缺失或其他格式无效的情况仍以 warning 提示，Core 不联网检查链接可访问性。

Core 只检查当前 `review.status`，不记录或比较内容审核时的版本。实质修改已审核内容后，应由 Git 变更审阅流程将状态改为 `pending`、清除旧版本的审核人和审核时间，并在人工复审后重新批准。

## 诊断

每条诊断包含错误码、等级、消息和相对文件路径；可选字段包括实体 ID、字段路径、建议和行列位置。等级为 `fatal` 或 `error` 时 `ValidationResult.valid` 为 `false`；`warning` 和 `info` 不阻止校验通过。`release` 的 `data` 和 `index` 只包含最终筛选结果。

错误码格式为 `OQB-{类别}-{编号}`。`FILE`、`SCHEMA`、`QUESTION`、`SCORE`、`REF`、`GROUP`、`EXAM`、`ASSET`、`QUALITY`、`REVIEW`、`LICENSE` 和 `VERSION` 分别表示文件、结构、题目语义、评分规则、实体引用、材料题组、试卷、资源、内容质量、审核、授权和版本诊断；Core 也会使用 `SECURITY`、`SOURCE`、`TOPIC` 和 `KNOWLEDGE` 表示对应的细分诊断。`OQB-REF-005` 表示源 Markdown 使用了 Obsidian Wiki 双链或嵌入语法。数值题要求单位但缺少标准答案单位时产生 `OQB-SCORE-001`；`acceptedUnits` 未包含标准答案单位时产生 `OQB-SCORE-002`。已生成试卷记录的题库版本与当前版本不一致时产生非阻断警告 `OQB-VERSION-001`。
