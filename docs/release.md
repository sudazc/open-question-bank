# Release 下载与校验

当前仓库尚无已发布的 Release。创建并推送与软件版本一致的标签后，GitHub Release 工作流会提供适合本地运行的预构建 Workspace 包和 SHA-256 校验文件。GitHub 还会为每个版本标签自动生成源码 ZIP 和 tar.gz；源码快照需要按开发方式安装依赖并构建。

## 下载并运行预构建包

先安装 Node.js `>=22.13.0` 和 pnpm `11.25.0`，再从 [GitHub Releases](https://github.com/sudazc/open-question-bank/releases) 下载 `openquestionbank-v<版本>-prebuilt.tar.gz` 与 `SHA256SUMS`。下面以 `0.1.0` 为例，使用时将版本替换为实际下载版本：

```sh
tar -xzf openquestionbank-v0.1.0-prebuilt.tar.gz
cd openquestionbank-v0.1.0
pnpm install --prod --frozen-lockfile
pnpm oqb --help
pnpm oqb init ../my-question-bank
pnpm oqb validate ../my-question-bank
```

压缩包包含编译后的 `schema`、`core`、`exporters` 和 CLI 包、初始化模板、使用文档及锁文件。安装步骤只安装运行依赖，不会安装开发依赖。题库目录可以放在预构建包目录之外，之后可独立使用 Git 管理。

Windows PowerShell 也可以使用系统自带的 `tar` 解压，然后执行相同的 pnpm 命令：

```powershell
tar -xzf .\openquestionbank-v0.1.0-prebuilt.tar.gz
Set-Location .\openquestionbank-v0.1.0
pnpm install --prod --frozen-lockfile
pnpm oqb --help
pnpm oqb init ..\my-question-bank
pnpm oqb validate ..\my-question-bank
```

## 验证下载文件

将 `SHA256SUMS` 放在压缩包旁边。Linux 或 macOS 可在该目录运行：

```sh
sha256sum --check SHA256SUMS
```

Windows PowerShell 可以计算文件摘要，并与 `SHA256SUMS` 中同名文件对应的摘要逐字比较：

```powershell
(Get-FileHash .\openquestionbank-v0.1.0-prebuilt.tar.gz -Algorithm SHA256).Hash.ToLower()
Get-Content .\SHA256SUMS
```

摘要不一致时请重新下载。SHA-256 用于检查文件是否与该 Release 提供的校验值一致，不代表对题库内容授权或正确性的审核。

## 标签与自动发布

仓库的 Release 工作流由 `v*` Git 标签触发，并要求标签严格匹配根目录及全部 Workspace 包的 SemVer 版本，例如根目录版本为 `0.1.0` 时使用 `v0.1.0`。工作流会安装锁定依赖、运行检查、生成预构建包并核对 SHA-256，然后在隔离目录安装发布包的运行依赖，试跑 `oqb --help`、初始化与校验，并分别导出 Obsidian Vault 和 Notion 导入包，确认首页、清单及题目 / 答案 CSV 已生成。这样可以检查用户下载后的包能够完成从初始化到平台导出的主要流程。

Pull Request 和 `main` 分支提交会在 Linux、Windows、macOS 上运行 CI。各包不发布到 npm；当前 Release 产物仅通过 GitHub Releases 分发。
