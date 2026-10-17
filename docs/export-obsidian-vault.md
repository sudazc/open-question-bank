# Obsidian Vault 导出 2.0

`oqb export --format obsidian` 会先按选定模式校验题库，再生成可直接在 Obsidian 中打开的 Vault。源题库仍使用平台无关的 YAML 和 Markdown；导出的实体关系使用 Obsidian Wiki 链接。

## 使用方法

```sh
oqb export ./my-question-bank --format obsidian --out ./dist/my-question-bank-obsidian
```

- 题库目录默认为当前目录。
- `--format obsidian` 选择 Obsidian Vault；省略 `--format` 时仍使用标准 JSON。
- `--out` 默认为运行命令时当前目录下的 `dist`。
- `--mode` 可使用 `draft`、`strict` 或 `release`，默认是 `draft`。`release` 只导出通过发布筛选和最终引用校验的数据。
- 有错误或致命诊断时命令返回退出码 `1`，不会开始导出；警告不会单独阻止导出。
- 输出目录不能与题库根目录相同，不能位于题库配置的实体或资源目录内，也不能与题库源文件集合发生路径冲突。

例如，只生成通过发布资格检查的内容：

```sh
oqb export ./my-question-bank --format obsidian --mode release --out ./dist/release-vault
```

导出后，在 Obsidian 中使用“打开本地仓库”选择输出目录即可浏览。把整个输出目录移动到另一位置后，Vault 内链接仍然有效。

## 文件结构

```text
dist/my-question-bank-obsidian/
├── 题库首页.md
├── manifest.json
├── 考点/
│   ├── 索引.md
│   └── 基础知识.md
├── 知识笔记/
│   ├── 索引.md
│   └── 认识基础概念.md
├── 题目/
│   ├── 索引.md
│   └── 水的化学式是什么.md
├── 材料题组/
│   ├── 索引.md
│   └── 三角形材料题.md
├── 试卷/
│   ├── 索引.md
│   └── 基础练习.md
└── assets/                 # 存在引用资源时生成
    └── diagram.svg
```

根目录的“题库首页”提供浏览入口，各分类目录中的“索引”列出该类实体。目录名、页面文件名和一级标题采用中文可读名称：

- `考点/` 使用考点名称。
- `知识笔记/` 使用知识标题。
- `题目/` 使用题干纯文本，过长时截取前 55 个字符并加省略号。
- `材料题组/` 和 `试卷/` 使用各自的标题。

文件名会移除 Windows 和 Obsidian 不支持的字符，并限制长度；同一分类内重名时会追加序号，例如 `均值题`、`均值题 (2)`。每个页面通过 Obsidian 属性保存 `题库ID` 和 `实体类型`，稳定 ID 不依赖文件路径。改名源文件或题目内容不会改变实体间的稳定 ID 关系，但修改标题会相应改变下一次导出的文件名。

题目索引和上一题 / 下一题导航均按稳定 ID 排序。首题没有上一题，末题没有下一题；两端会显示“无”。

题目选项不标记正确答案。答案和解析放在 Obsidian 折叠 callout 中，首次打开页面时默认收起。答案仍保留在生成的 Markdown 源文件中，展开“显示答案与解析”后可以查看。

## Wiki 链接和资源

- 题库首页和分类索引之间使用 Obsidian Wiki 链接。
- 实体字段中的 ID 关系和正文中的 `oqb://topic/{id}`、`oqb://knowledge/{id}`、`oqb://question/{id}`、`oqb://exam/{id}` 引用会转成 `[[页面路径|显示名称]]`。
- 如果导出数据缺少引用目标或目标类型不匹配，导出会失败；发布筛选会在最终导出前移除不可发布内容及依赖它们的引用。
- 实体声明的资源文件会保留题库根目录相对路径并复制到 Vault。Markdown 图片链接转换为 `![[assets/图片路径]]`，普通资源链接转换为 `[[assets/资源路径|显示文本]]`。
- 外部 HTTP(S) 链接保持原样。行内代码及代码围栏中的示例文本不会被转换。
- 知识正文继续保留 Markdown 格式，包括表格、公式和代码块。

## 发布清单

`manifest.json` 示例：

```json
{
  "format": "openquestionbank-obsidian-vault",
  "formatVersion": "2.0.0",
  "schemaVersion": "1.0.0",
  "bank": { "id": "my-question-bank", "name": "我的题库", "version": "1.0.0" },
  "statistics": {
    "entities": {
      "bank": 1,
      "topics": 1,
      "knowledge": 1,
      "questions": 1,
      "groups": 0,
      "exams": 0
    },
    "totalEntities": 4
  },
  "files": [{ "path": "题库首页.md", "sizeBytes": 120, "sha256": "..." }]
}
```

`files` 列出生成的 Markdown 和复制的资源，并记录 UTF-8 字节数及 SHA-256。清单不包含自身的校验值。题库内容和校验模式不变时，每个生成文件的内容和清单都保持一致；不会写入构建时间。

重复导出会更新本次生成的文件和当前引用资源，其他文件会保留。建议使用专用输出目录，避免与手工维护的文件重名。

## 版本兼容

`formatVersion` 描述 Obsidian Vault 导出包约定，`schemaVersion` 描述题库实体约定。读取工具应检查 `format` 和 `formatVersion`。2.0.0 将实体页面路径从稳定 ID 改为可读标题，并调整题目答案的显示方式；读取工具应从页面属性读取稳定 ID，不能再从文件名推断 ID。后续改变必需页面、清单字段或字段含义时，应提升格式版本并同步更新此文档和集成测试。
