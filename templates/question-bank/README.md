# 我的题库

这是由 OpenQuestionBank 模板生成的独立题库。题目使用 YAML，知识笔记使用带 YAML Front Matter 的 Markdown。请先修改 `bank.yaml` 中的题库信息和许可证，再替换或删除示例内容。

## 目录

- `topics/`：考点定义，使用稳定 ID 建立父子关系
- `knowledge/`：知识笔记，Front Matter 保存元数据，分隔线后的内容为正文
- `questions/`：每个 YAML 文件保存一道题
- `groups/`：材料题组
- `exams/`：固定试卷或规则组卷模板
- `assets/`：图片等本地资源

每个实体的 `id` 是关系标识，不依赖文件名。题目使用 `topicIds` 和 `knowledgeIds` 引用考点及知识笔记。

## 校验

在 OpenQuestionBank 框架仓库根目录运行：

```sh
pnpm oqb validate ./my-question-bank
pnpm oqb stats ./my-question-bank
```

编辑时默认使用 `draft` 模式。发布审核前可以运行：

```sh
pnpm oqb validate ./my-question-bank --mode strict
pnpm oqb validate ./my-question-bank --mode release
```

`strict` 检查审核状态和授权信息；`release` 只保留满足发布条件的内容。填写来源、许可证和署名信息时，请以你实际拥有的授权为准。
