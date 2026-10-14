# 贡献指南

感谢你为 OpenQuestionBank 改进代码、文档和示例。项目使用 pnpm Workspace 与 TypeScript，题库框架代码和具体题库内容分开维护。

## 环境准备

- Node.js `>=22.13.0`
- pnpm `11.25.0`

在仓库根目录安装锁定依赖并运行检查：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
```

`pnpm check` 会执行 TypeScript 类型检查、ESLint、Workspace 构建和 Vitest。单独运行 `pnpm test` 时也会先构建 Workspace 包，以确保 CLI 集成测试使用当前源码构建结果。

## 代码与数据约定

- 保持依赖方向为 `schema → core → cli`；`exporters` 可以依赖 `schema` 和 `core`。
- 数据 Schema 只描述单个实体，跨实体引用、内容审核和发布资格由 Core 处理。
- 实体关系使用稳定 ID，不以文件名或路径作为引用。
- Schema 或导出文件合同变更时，先检查兼容性，再更新版本、文档、样例和相关测试。详细规则见 [Schema 版本策略](docs/schema-versioning.md)。
- 用户可见说明默认使用简体中文；代码标识符沿用项目现有英文命名。
- 不加入 Web、数据库、账号、在线服务或商业服务依赖，也不提前实现未排期功能。

## 提交 Pull Request

提交前请确认：

1. 修改解决的问题和影响范围清楚，未混入无关重构。
2. 文档、示例和 Schema 变化与实现保持一致。
3. `pnpm check` 与 `pnpm format:check` 通过；若环境限制导致某项无法运行，请在说明中写明。
4. Pull Request 描述包含行为变化、验证命令和需要维护者注意的兼容性影响。

题库内容贡献应放在独立题库仓库，不要把某个考试或课程的专用内容和规则写进通用框架。

## 版本与发布

根目录和所有 Workspace 包使用相同的软件版本。版本标签格式为 `v<版本>`，例如 `v0.1.0`；推送标签会触发 GitHub Actions 校验、打包和 Release。Workspace 包当前不发布到 npm。Schema 与导出格式拥有独立版本，不能仅因软件版本升级而自动改号。
