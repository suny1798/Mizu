# 维护与发版

## 本地检查和打包

需要 Python 3.9+ 和 Node.js（用于 JavaScript 语法检查），无额外依赖。

```sh
python3 scripts/package.py --check
python3 scripts/package.py
```

产物位于 `dist/`，包含可解压加载的 `mizu-start-v版本号.zip` 及 SHA-256 校验文件。ZIP 中仅包含运行文件、许可证和隐私 / 素材说明，不包含项目截图或开发资料。

## 首次连接 GitHub

在 GitHub 创建名为 `mizu-start` 的空仓库，不自动添加 README、许可证或 `.gitignore`。复制仓库的 SSH 或 HTTPS 地址。

确认 Git 提交身份、许可选择和待公开文件后，在项目根目录执行下列操作。将 `仓库地址` 替换为实际地址；提交和推送由维护者决定何时执行。

```sh
git add .
git commit -m "Initial open-source release"
git remote add origin 仓库地址
git push -u origin main
```

仓库允许 GitHub Actions 运行后，主分支的推送和 Pull Request 会执行检查。无需自行配置发布令牌，发布任务使用仓库自动提供的 `GITHUB_TOKEN`。

## 发布版本

1. 更新 `manifest.json` 的 `version`。
2. 新建 `release-notes/版本号.md`，写明功能变动和安装说明。
3. 本地检查并打包，解压 ZIP 后通过 Chrome 的“加载已解压的扩展程序”验证。
4. 提交改动并推送主分支，再推送与版本严格匹配的标签。例如首次发布：

```sh
git tag -a v0.2.15 -m "Mizu v0.2.15"
git push origin v0.2.15
```

推送 `v*` 标签会触发自动发布：检查源码、核对标签与扩展版本、打包，再创建 GitHub Release，附上 ZIP 和校验文件。普通分支推送与手动运行只检查，不发版。

首次开源可以沿用当前 `0.2.15` 版本，不必改为 `1.0.0`。版本说明取自 `release-notes/0.2.15.md`。

如果失败，在仓库 Actions 页面查看原因。未创建 Release 的运行可在修复问题后重试；如果版本已经发布，请为后续修改使用新的版本号和标签。
