# GitHub Markdown 导出 1.1

`oqb export --format github-markdown` 会先按选定模式校验题库，再生成一组可直接在 GitHub 仓库中浏览的 Markdown 页面。源数据仍使用平台无关的 YAML 和 Markdown；此导出格式只在生成目录中创建 GitHub 可用的相对链接。

## 使用方法

```sh
pnpm oqb export ./my-question-bank --format github-markdown --out ./dist/my-question-bank-github
```

- 题库目录默认为当前目录。
- `--format github-markdown` 选择此格式；省略时使用标准 JSON 格式。
- `--out` 默认为运行命令时当前目录下的 `dist`。
- `--mode` 可使用 `draft`、`strict` 或 `release`，默认是 `draft`。`release` 只导出发布筛选和最终引用校验保留的实体。
- 有错误或致命诊断时命令返回退出码 `1`，不会开始导出；警告不会单独阻止导出。
- 输出目录不能与题库根目录相同，不能位于题库配置的实体或资源目录内，也不能与题库源文件集合发生路径冲突。

例如，只生成通过发布资格检查的内容：

```sh
pnpm oqb export ./my-question-bank --format github-markdown --mode release --out ./dist/release
```

## 输出目录

```text
dist/my-question-bank-github/
├── README.md
├── manifest.json
├── topics/
│   ├── README.md
│   └── id-topic-foundations.md
├── knowledge/
│   ├── README.md
│   └── id-knowledge-foundations.md
├── questions/
│   ├── README.md
│   └── id-question-example.md
├── groups/
│   ├── README.md
│   └── id-group-example.md
├── exams/
│   ├── README.md
│   └── id-exam-practice.md
└── assets/                 # 存在引用资源时生成
    └── diagram.svg
```

根目录 `README.md` 是浏览入口，各分类 `README.md` 按稳定 ID 列出该类实体。实体文件使用 `id-<稳定 ID>.md` 命名；小写 ASCII 字母、数字、点、下划线和连字符保留原样，其他字符（包括大写字母）编码成 `~` 加 UTF-8 字节的大写十六进制值，避免大小写不敏感文件系统上的 ID 碰撞。编码后超过单段长度限制的 ID 会改用按 UTF-8 字节生成的紧凑 Base36 文件名；文件名保留字节长度以避免前导零歧义。`id-` 前缀也使 Windows 保留设备名可以安全导出。

## 页面内容和链接

- 考点页面展示名称、ID、排序、父考点和说明。
- 知识页面展示摘要、考点、前置 / 相关知识、标签、来源与审核信息，以及 Markdown 正文。
- 题目页面展示题干、题型、选项、答案、解析、考点 / 知识引用和来源信息。
- 材料题组页面展示共享材料、子题、考点和来源信息。
- 试卷页面展示固定题目顺序、组卷结果或生成规则。
- 源内容中的 `oqb://topic/{id}`、`oqb://knowledge/{id}`、`oqb://question/{id}` 和 `oqb://exam/{id}` 会改写为对应 Markdown 页面间的相对链接。若导出数据缺少目标实体或目标类型不匹配，导出器会报错。
- 被实体声明的资源文件会保留题库根目录相对路径并复制。Markdown 中匹配这些资源路径的链接会按页面所在目录重新计算，并保留查询参数和片段。
- 资源路径必须能在 Windows、macOS 和 Linux 上安全创建：每个路径段不能包含 Windows 非法字符（包括 `:`）或控制字符，不能以点或空格结尾，不能是 `CON`、`NUL` 等保留设备名，UTF-8 长度不能超过 255 字节。导出也会拒绝资源与页面路径之间大小写或 Unicode 规范化后重名，以及文件与目录冲突；请重命名冲突资源后再导出。
- Markdown 代码围栏和行内代码中的示例文本保持原样，不会被当成内部链接或资源链接处理。

## 发布清单

`manifest.json` 示例：

```json
{
  "format": "openquestionbank-github-markdown",
  "formatVersion": "1.1.0",
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
  "files": [{ "path": "README.md", "sizeBytes": 120, "sha256": "..." }]
}
```

`files` 列出生成的 Markdown 和复制的资源，并记录 UTF-8 字节数及 SHA-256。清单不包含自身的校验值。题库内容和校验模式不变时，每个生成文件的内容和清单都保持一致；不会写入构建时间。

重复导出会更新本次生成的文件和当前引用资源，其他文件会保留。建议为导出结果使用单独目录，避免与手工维护的文件重名。GitHub Markdown 阅读包可随目录移动；如果发布到 GitHub Pages，请结合仓库的 Pages 路径检查部署结果。

## 兼容策略

`formatVersion` 描述 GitHub Markdown 导出包约定，`schemaVersion` 描述题库实体约定。读取工具应检查 `format` 和 `formatVersion`。1.1.0 为文件名增加大小写安全编码，并将超长 ID 文件名改为 Base36；读取工具应从页面内容读取实体 ID，不要按文件名反推 ID。后续改变必需页面、清单字段、路径规则或字段含义时，应提升格式版本并同步更新文档和集成测试。
