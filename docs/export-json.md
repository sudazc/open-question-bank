# 标准 JSON 导出 1.0

CLI 的 `export` 命令会先按选定模式校验题库，再将有效数据写入构建目录。当前提供 `openquestionbank-json` 格式，便于备份、交换数据和供其他程序读取。

## 使用方法

```sh
oqb export ./my-question-bank --format json --out ./dist/my-question-bank
```

- `目录` 默认为当前目录。
- 本文描述 `--format json`。CLI 还支持 `github-markdown`，省略 `--format` 时默认使用 JSON；另一种格式见 [GitHub Markdown 导出说明](export-github-markdown.md)。
- `--out` 默认为运行命令时当前目录下的 `dist`。
- `--mode` 沿用 `draft`、`strict`、`release` 校验模式，默认是 `draft`。
- 校验存在错误或致命错误时，命令返回退出码 `1`，不会生成导出文件。警告不会单独阻止导出。
- 输出目录不能与题库根目录相同，也不能位于 `bank.yaml` 配置的实体或资源目录内，避免导出文件混入或覆盖源数据。

例如，只有通过发布资格检查的数据才会进入导出包：

```sh
oqb export ./my-question-bank --mode release --out ./dist/release
```

## 文件结构

导出目录包含两个 UTF-8 JSON 文件；如果题库引用资源，也会保留其原文件格式和相对路径：

```text
dist/my-question-bank/
├── question-bank.json
├── manifest.json
└── assets/                 # 存在被引用资源时生成
    └── image.png
```

`question-bank.json` 的顶层结构如下：

```json
{
  "format": "openquestionbank-json",
  "formatVersion": "1.0.0",
  "data": {
    "bank": {},
    "topics": [],
    "knowledge": [],
    "questions": [],
    "groups": [],
    "exams": []
  }
}
```

`data` 使用 Core 校验后的统一题库模型。`bank` 保存题库及 Schema 版本；其他字段分别保存考点、知识笔记、题目、材料题组和试卷。实体中的 Markdown 正文、资源相对路径、稳定 ID 和实体引用都会原样保留，导出器不会把源引用改写成某个平台的链接。题库引用到的资源文件会按原相对路径复制到导出目录；未被实体引用的资源不会复制。

`manifest.json` 记录格式版本、Schema 版本、题库 ID 和版本、各类实体数量、实体总数，以及每个导出数据文件（JSON 和资源文件）的字节数和 SHA-256。实体总数包含 Bank。清单不包含自身的校验值。

## 可复现性

相同的有效题库和校验模式会生成相同的文件内容。实体集合按稳定 ID 排序，对象键按字典顺序输出；实体内部数组（例如选择题选项和试卷题目顺序）保持源数据顺序。输出使用两空格缩进、UTF-8 和结尾换行，不写入构建时间等非确定性元数据。

再次导出到同一目录时会更新 JSON 文件和当前仍被引用的资源；其他文件会保留。请将专用目录作为导出目标，避免与手工维护的文件重名。

## 版本兼容

`formatVersion` 描述导出包外层合同，`schemaVersion` 描述题库实体合同。读取器应先检查 `format` 和 `formatVersion`，再按对应版本解释 `data`。后续若改变必需字段或字段含义，应提升导出格式版本并同步更新此文档和测试。
