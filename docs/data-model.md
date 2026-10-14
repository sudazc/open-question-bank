# 数据模型 1.0

规范由 `packages/schema/src/schema/1.0.0/oqb.schema.json` 定义，使用 JSON Schema Draft 2020-12。Schema 文档本身是一个统一入口，以 `$defs` 复用公共约束，并通过 `oneOf` 接受六类核心实体。

## 实体

| 实体            | 主要内容                                                    |
| --------------- | ----------------------------------------------------------- |
| `Bank`          | Schema 版本、题库版本、语言、许可证、维护者和各类数据目录   |
| `Topic`         | 考点名称、可选父级、排序、描述和别名                        |
| `Knowledge`     | Front Matter 元数据和解析后的 Markdown 正文、考点及知识关系 |
| `Question`      | 公共题目元数据和由 `type` 判别的题型答案结构                |
| `QuestionGroup` | 公共材料及其子题 ID；它不是可作答题型                       |
| `Exam`          | 固定试卷、规则组卷模板或已生成的规则组卷结果                |

Markdown 知识文件的 YAML Front Matter 存放 `Knowledge` 元数据，正文不重复放入 Front Matter。解析后，`core` 将元数据与 Markdown 正文合并为带 `body` 的 `Knowledge` 对象；Schema 校验这个标准化对象。

## 公共约定

- ID 为 1–128 个 ASCII 字符，以字母或数字开头，之后只能使用字母、数字、点、下划线、冒号和连字符。ID 不含路径，实体关系按实体类型和 ID 定位。
- `Bank.version` 使用完整 SemVer；`schemaVersion` 对应数据合同版本，目前固定为 `1.0.0`。
- 每个 `Question` 和 `Knowledge` 都要求 `source` 与 `review`。`QuestionGroup` 也要求这两个字段。来源和审核状态使用 Schema 中列出的枚举。
- `official_public` 只描述来源类型，不表示取得转载或再发布许可。授权判断属于发布校验。
- `Bank.license` 和 `source.license` 当前只要求非空字符串；P0 未规定 SPDX 标识符还是 SPDX 表达式，Schema 1.0 和 Core 都不解析许可证语法。Core 的 release 模式检查许可证和署名信息是否明确填写，但不判断许可证兼容性或实际授权效力。
- `extensions` 为对象，用于命名空间扩展；不得覆盖或重新解释标准字段。
- `topicIds`、`knowledgeIds` 等 ID 数组禁止完全重复项。实体是否存在以及 ID 是否与目标类型对应，由 `core` 检查。
- 内容正文、题干、解析、材料和答案说明可使用 Markdown 文本。允许的 HTML、脚本和 SVG 安全策略不能由结构 Schema 保证。
- 资源路径使用题库根目录下的正斜杠相对路径。Schema 拒绝常见绝对路径、反斜杠和 `.` / `..` 路径段；规范化后的真实路径及符号链接必须由 `core` 再校验。
- Markdown 图片和其他资源链接使用题库根目录相对路径，并应与实体的 `assets` 清单一致；源文件解析位置、真实文件存在性及发布过滤后是否仍可用由 `core` 检查。

## 题型答案

- `single_choice`：至少两个 `{id, text}` 选项，答案为 `{choiceId}`。
- `multiple_choice`：至少两个选项，答案为非空且无重复 ID 的 `{choiceIds}`；正确集合匹配策略在评分实现中执行。
- `true_false`：答案为 JSON 布尔值。
- `fill_blank`：答案包含一个或多个空，每空包含允许答案列表。`caseSensitive` 缺省按 `false` 解释，`whitespace` 缺省按 `trim` 解释；Schema 的 `default` 只是注解，后续标准化器必须显式应用默认值。`collapse` 表示折叠连续空白。
- `numeric`：答案及绝对/相对容差使用十进制字符串。容差字段缺省按零解释。`unitRule` 可要求、可选或忽略单位，并可列出等价单位别名。V1 数据模型不声明单位换算系数；需要换算时必须先扩展并版本化该模型。
- `short_answer`：包含参考答案和可选评分要点；不承诺自动语义评分。

题目 `difficulty` 是题库自定义的非空标签。P0 未确定全局难度刻度，所以 Schema 不把它锁定为数值或固定枚举；规则组卷只能按精确标签匹配。

`review.reviewedAt` 当前只约束为字符串，P0 未规定时间格式；建议在后续版本统一为 ISO 8601 日期时间并通过格式校验。

## 材料题组和试卷

题组只保存一次共享材料和 `questionIds`。试卷中的 `kind: "group"` 项通过 `groupId` 引用题组，并逐题保存子题及分值；普通题目使用 `kind: "question"`。`core` 需要确认题组引用、子题归属、每题至多属于一个题组和选题是否完整，不复制公共材料。

试卷有两种 `mode`：

- `fixed`：显式保存有序题目/题组项及每题分值。
- `generated`：通过 `kind: "template"` 表示规则模板，通过 `kind: "result"` 表示已生成结果。结果必须保存实际项及顺序、随机种子、题库版本和抽题算法版本。

规则模板通过 `unit` 选择题目或题组，按考点、题型和单个难度标签筛选，并声明抽取数量和每道子题分值。数量不足和跨实体关联由 `core` 明确报错，Schema 不会静默裁剪。

## 引用与索引

实体间关联只使用 ID。Markdown 可以写 `oqb://knowledge/{id}`、`oqb://question/{id}`、`oqb://topic/{id}` 和 `oqb://exam/{id}`。引用解析、类型检查、索引构建和导出时的链接重写由 `core` 与具体导出器负责。
