# 纸间 Paperleaf

**把论文收好，把读到的东西留下来。**

一款中文文献管理与阅读笔记工具。用「待读 / 在读 / 已读」代替反复改文件名，用摘录、页码和标签找回读过的内容。

[下载 Windows 免安装版](https://github.com/jhChen2002/paperleaf/releases/latest) · [反馈问题](https://github.com/jhChen2002/paperleaf/issues)

## 三步开始

1. 下载 Releases 中的 `Paperleaf-1.0.0-Windows-x64.zip`，**完整解压**到普通文件夹。
2. 进入解压后的 `portable` 文件夹，双击 `Start-Paperleaf.cmd`，浏览器会自动打开纸间。无需安装 Node.js、注册账号或联网。
3. 拖入 PDF 或导入整个文件夹，开始分类、阅读和记笔记。使用后运行 `Stop-Paperleaf.cmd` 关闭后台服务。

支持 Windows 10/11 x64 和现代浏览器。每位使用者都有自己的本地文献库。界面运行在浏览器中，PDF 和笔记保存在软件目录下的 `data/`，不会上传。关闭浏览器后后台仍在运行，退出请使用停止脚本。

## 能做什么

| 工作 | 纸间的做法 |
| --- | --- |
| 收集 | 批量导入 PDF、导入文件夹、文件去重；分块传输、逐文件进度、暂停与继续 |
| 整理 | 文件夹、标签、星标、阅读状态、书目信息编辑 |
| 阅读 | 鼠标滚轮连续阅读、输入页码跳转、缩放、单篇全文查找、记住阅读页码 |
| 摘录 | 选中文字直接记录，保存高亮位置、页码、颜色、标签和自己的想法 |
| 回看 | 跨文献笔记库，搜索题名、作者、标签、摘录和笔记，点击来源回到原文 |
| 导出 | Markdown 笔记、BibTeX、JSON 资料备份及恢复 |

## 导入与阅读

导入保留原文件名，单篇 PDF 上限为 **40 MiB（41,943,040 字节，界面显示为 40 MB）**。文件按 5 MiB 分块传输，最后一块可以更小；短暂的网络错误会自动重试，界面显示每个文件的进度和失败原因。需要中断时点击「暂停上传」，保留当前网页，再点击「继续未完成的文件」；已完成的分块可继续使用。刷新或关闭网页后需要重新选择文件，不能跨网页会话续传。请等到文件显示导入完成后再关闭页面。

双击文献进入阅读器，用鼠标滚轮从上往下连续阅读。工具栏可直接输入页码并点击「跳转」，也可用前后页按钮定位。阅读器按需加载文件内容，只绘制阅读位置附近的页面；同一网页会临时缓存最近使用的 PDF。实际打开和上传速度仍取决于文件内容、设备和网络。

选中文字后点击「摘录并记录」，即可一起保存原文、页码与自己的想法。需要回看时，在文献库或笔记库搜索关键词，点击笔记的来源页码返回对应原文。扫描版 PDF 没有可选择文字时，可以手动添加页码笔记。

## 备份、更新和分享

- **完整备份**：先运行停止脚本，再复制整个 `data/` 文件夹。里面同时包含数据库和 PDF。更新软件或换电脑时，先备份，再把 `data/` 复制到新解压的软件目录。
- **JSON 导出不包含 PDF**：它用于备份书目信息、分类、摘录与笔记。恢复会合并缺失记录，不覆盖已有修改；需要重新附加原 PDF。
- **分享给同门**：发送 Releases 下载的原始 ZIP，或直接发项目链接。不要发送自己使用后的 `data/`。
- `SHA256SUMS.txt` 提供发布文件校验值。

## 本地与多设备使用

本仓库包含两种运行方式。Windows 包使用本机 SQLite 与文件目录，适合个人离线使用。云端模式使用 Sites 身份认证、D1 和 R2；部署自己的站点后，在不同设备用同一账号访问同一网址，可以同步文献、笔记和阅读进度。

**本地版和云端版是独立的文献库，不会自动互相同步。** 云端模式需要单独部署和联网；本仓库不包含站点凭据或任何人的文献。云端页面在重新获得焦点及每 30 秒刷新；并发编辑检测到冲突时会提示核对，不会静默覆盖。

## 当前边界

- 单篇 PDF 最大 40 MiB。扫描 PDF 没有文字层时可手动添加页码笔记；目前没有 OCR。
- 全库搜索覆盖书目信息和笔记；PDF 全文查找限定当前打开的一篇论文。
- 尚未提供 DOI 自动补全、Word 引用插件。BibTeX 以用户填写的信息生成，使用前请核对。
- 高亮与笔记由应用保存，不会写入原 PDF。
- 本地服务只监听 `127.0.0.1:43127`，只适合自己的电脑。原生 macOS/Linux 下载包暂未提供。

## 从源码运行

需要 **Node.js 24+、pnpm 11.25**。

```sh
pnpm install
pnpm build:local
pnpm start:local
```

打开 `http://127.0.0.1:43127`。数据在 `release/portable/data/`，可通过 `PAPERLEAF_DATA_DIR` 指定目录。`PAPERLEAF_PORT` 可以调整直接启动服务的端口。Windows 启动脚本固定使用默认端口。

```sh
# 类型检查
pnpm exec tsc --noEmit
# 在 Windows x64 上构建含 Node.js 运行环境的 ZIP
pnpm package:windows
```

打包脚本联网读取对应 Node 版本的许可证。默认输出 `release/Paperleaf-1.0.0-Windows-x64.zip`。打包目录存在 `data/` 时会拒绝打包，以免误带个人资料。

云端入口是 `app/page.tsx`；`pnpm dev` / `pnpm build` 对应 Sites 开发与生产构建。部署时注册自己的 Site，并在 `.openai/hosting.json` 配置自己的项目标识及 `DB` / `BUCKET` 绑定。数据库定义在 `db/schema.ts`，迁移在 `drizzle/`。正式发布由 Sites 工具处理；不要把本地模拟身份用于公网服务。

## 验证

- TypeScript、云端生产构建、本地生产构建。
- `qa/backend-http.mjs`：云端 API 的身份隔离、并发冲突、PDF、备份和级联删除验证（需要本地预览及隔离测试数据）。
- `qa/portable-http.mjs`：在独立测试库验证本地接口，默认地址 `http://127.0.0.1:43128`，可由 `PAPERLEAF_TEST_URL` 改写。测试会创建和清理自己的记录，请勿指向个人库。
- `qa/multipart-http.mjs`：约 21.6 MB、20 页 PDF 的分块上传、完整性校验、重复请求、去重和 Range 读取；已在本地服务与云端开发运行环境验证。
- `qa/upload-retry.mjs`：模拟分块已送达但响应丢失、暂停正在上传的分块、保留已完成分块后继续，以及避免重复创建文献。
- `qa/portable-lifecycle.mjs`：使用独立测试目录检查 Windows 包启动、停止、重复启动，以及重启后保留 PDF、笔记和阅读进度。
- 浏览器流程已检查大文件导入、滚轮连续阅读、页码跳转、选区摘录、笔记搜索、原文回跳及窄屏布局。这些检查不是公网传输速度承诺。

## 开源与参考

项目原创代码采用 MIT License。第三方组件继续适用各自许可证；分发包 `licenses/` 包含 React、Lucide、PDF.js、Zod、Node.js 等的许可证。PDF.js 的 worker、CMaps、字体和 WASM 随包分发。

交互设计参考 [Zotero 分类与标签](https://www.zotero.org/support/collections_and_tags)、[Zotero PDF 阅读器](https://www.zotero.org/support/pdf_reader) 和 [Mendeley 阅读与批注](https://static.mendeley.com/md-stitch/releases/live/04-reading-and-annotating-documents.2402ba08.html)。

欢迎提 Issue 和 PR。如果纸间帮你少花了一点整理文献的时间，也欢迎点一颗 Star。
