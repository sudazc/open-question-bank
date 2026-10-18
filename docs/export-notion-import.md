# Notion CSV / Markdown 导入包 2.2

`oqb export --format notion` 会先按所选模式校验题库，再生成一组可手动导入 Notion 的 CSV 数据库、Markdown 页面、关系映射和资源文件。导出格式不调用 Notion API，也不需要 Notion 账号或网络连接。

## 使用方法

```sh
oqb export ./my-question-bank --format notion --out ./dist/my-question-bank-notion
```

- 题库目录默认为当前目录。
- `--format notion` 选择 Notion 导入包；省略时使用标准 JSON。
- `--out` 默认为运行命令时当前目录下的 `dist`。
- `--mode` 可使用 `draft`、`strict` 或 `release`，默认是 `draft`。`release` 只导出通过发布筛选和最终引用校验的数据。
- 有错误或致命诊断时命令返回退出码 `1`，不会开始导出；警告不会单独阻止导出。
- 输出目录不能与题库根目录相同，不能位于题库配置的实体或资源目录内，也不能与题库源文件集合发生路径冲突。

例如，只生成通过发布资格检查的内容：

```sh
oqb export ./my-question-bank --format notion --mode release --out ./dist/release-notion
```

## 文件结构

```text
dist/my-question-bank-notion/
├── README.md
├── manifest.json
├── relations.csv
├── databases/
│   ├── bank.csv
│   ├── topics.csv
│   ├── knowledge.csv
│   ├── questions.csv
│   ├── answers.csv
│   ├── groups.csv
│   └── exams.csv
├── topics/                 # Markdown 分类索引和考点页面
├── knowledge/              # Markdown 分类索引和知识正文
├── questions/              # Markdown 分类索引和题目页面
├── groups/                 # Markdown 分类索引和材料题组页面
├── exams/                  # Markdown 分类索引和试卷页面
└── assets/                 # 存在引用资源时生成
```

资源会保留题库根目录相对路径。为兼容 Windows、macOS 和 Linux，每个路径段不能包含 Windows 非法字符或控制字符，不能以点或空格结尾，不能是 `CON`、`NUL` 等保留设备名，UTF-8 长度不能超过 255 字节。导出会拒绝资源与页面路径之间大小写折叠或 Unicode 规范化后重名，以及文件与目录冲突；请重命名冲突资源后再导出。

每个 CSV 首行是属性名，每一行对应一个稳定 ID 实体。数据行按 ID 排序，关系数组保留原有顺序。CSV 使用 UTF-8、CRLF 行尾和 RFC 4180 转义；逗号、双引号或换行符会按 CSV 规则加引号。实体表把可读的 `name` 或 `title` 放在首列，导入 Notion 时可作为数据库的标题属性；稳定 ID 单独放在 `id` 列。

## CSV 数据库字段

| 文件            | 用途                                                     | 复杂数据字段                                                                                        |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bank.csv`      | 题库名称、版本、语言、许可证和目录配置                   | `maintainersJson`、`pathsJson`、`extensionsJson`、`entityJson`                                      |
| `topics.csv`    | 考点名称、父考点、排序和别名                             | `aliasesJson`、`extensionsJson`、`entityJson`                                                       |
| `knowledge.csv` | 知识标题、摘要、正文、标签和来源审核信息                 | 各 `*IdsJson`、`tagsJson`、`assetsJson`、`sourceJson`、`reviewJson`、`extensionsJson`、`entityJson` |
| `questions.csv` | 可练习的题目标题、题型、题干、选项、分值、来源和审核信息 | `choicesJson`、关系 ID、标签、资源、来源审核和 `questionJson`（不含答案与解析）                     |
| `answers.csv`   | 与题目 ID 对应的答案和解析                               | `answerJson`、`explanationMarkdown`、完整题目 `entityJson`                                          |
| `groups.csv`    | 材料、子题、考点、标签、来源和审核信息                   | 关系 ID、标签、资源、来源审核和 `entityJson`                                                        |
| `exams.csv`     | 试卷类型、固定题目或组卷规则                             | `itemsJson`、`rulesJson`、`extensionsJson`、`entityJson`                                            |

`id` 是 OpenQuestionBank 的稳定实体 ID，不是 Notion 页面 ID。题目表中的 `type` 使用 Schema 机器值，`typeLabel` 提供“单选题”“多选题”等中文显示名称。`questionJson` 不含答案和解析；这两项只在 `answers.csv` 中提供。字段名以 `Json` 结尾的值是 JSON 编码文本，适合保留数组和嵌套对象；答案表的 `entityJson` 保存完整题目实体，供核对或恢复使用。可将这些复杂字段作为文本属性保留，也可以根据 Notion 的使用方式拆分。

题目表的上一题 / 下一题按稳定 ID 字典序排列；首题 `previousId` 为空，末题 `nextId` 为空。Markdown 题目页使用相同顺序生成文件链接。

## 手动导入流程

1. 在 Notion 的导入入口选择 CSV，先导入 `databases/questions.csv` 创建题目数据库。首列 `title` 会成为可读标题，`id` 保留为稳定标识；选项不显示正确答案标记。
2. 先使用题目数据库练习。完成后再导入 `databases/answers.csv` 查看答案与解析；两张表可以通过 `id` 对照。暂时不想看到答案时，不导入答案表即可。
3. 按需导入 `databases/` 中其余 CSV；每个文件会建立一个独立数据库。将 `id` 保留为文本；`order`、`score`、`durationMinutes` 等数字字段可按需要改成数字属性。以 `Json` 结尾的列通常保留为文本。
4. 需要阅读完整正文时，将 `topics/`、`knowledge/`、`questions/`、`groups/` 和 `exams/` 中的 Markdown 文件导入为页面。题目页不含答案正文，页面内容提供上一题 / 下一题链接；索引页可作为目录参考。
5. 如需 Notion 数据库关系，将 `relations.csv` 导入为普通映射表，再按 `sourceType` + `sourceId` 查找来源记录，按 `targetType` + `targetId` 查找目标记录，并在 Notion 数据库内手动创建 Relation 属性和连接记录。题目表中的 `previousId` / `nextId` 也记录了按稳定 ID 字典序排列的前后题关系。
6. 如果题库引用图片或文件，请根据 `assetsJson` 检查引用路径，再将对应 `assets/` 文件上传到 Notion 页面。

Notion 原生 Relation 属性必须在 Notion 内配置。`relations.csv` 只提供关系映射和顺序信息，不会自动创建属性、双向关系或连接数据库记录。Markdown 相对链接在导入后也不会自动变成 Notion Relation。

## `relations.csv` 格式

```csv
sourceType,sourceId,field,targetType,targetId,position
knowledge,knowledge-water,topicIds,topic,topic-chemistry,0
question,question-001,knowledgeIds,knowledge,knowledge-water,0
```

- `sourceType` / `sourceId` 定位源实体；`targetType` / `targetId` 定位目标实体。
- `field` 是源实体中的字段路径，例如 `topicIds`、`parentId` 或 `items[1].questions[0].questionId`。
- `position` 是数组中从 0 开始的位置；单值关系为空。试卷嵌套路径中的下标标明所属试卷项和子题位置。
- 关系表覆盖考点父级、知识的考点 / 前置 / 相关关系、题目的考点 / 知识关系、题组的子题 / 考点关系，以及试卷固定内容和组卷规则中的考点筛选。

Notion 的关系属性可以选择是否显示反向属性，以及使用何种属性名称。具体配置由用户按目标数据库和查询习惯决定。

## 清单与重复导出

`manifest.json` 包含 `openquestionbank-notion-import` 格式标识、格式版本、Schema 版本、题库版本、实体统计，以及每个生成的 CSV、Markdown 页面和资源的 UTF-8 字节数与 SHA-256。版本 2.0.0 将答案与解析移到单独的 `answers.csv`，并为题目增加可读标题、中文题型显示名和前后题导航。版本 2.1.0 为 Markdown 页面文件名增加大小写安全编码；2.2.0 将 Markdown 页面的来源类型和审核状态改为中文展示标签，CSV 中仍保留 Schema 机器值。清单不包含自身校验值，也不写入生成时间。

题库数据和校验模式不变时，导出文件和清单保持一致。重复导出会更新本次生成的文件及当前引用资源；本次不再生成且与上一份 OpenQuestionBank 清单校验值一致的旧文件会移除，用户修改过的旧文件和清单未登记文件会保留。写入失败时 `manifest.json` 保持上一版；修复输出路径后可重试导出，由旧清单继续管理过期文件。建议使用专用目录，避免和手工文件重名。格式字段、路径规则或关系行语义变化时，应更新 `formatVersion`、此文档和集成测试。
