# Doperationtool

Doperationtool 是一款基于 Go + Wails 的本地安全运营桌面工具，面向漏洞模板整理、Nuclei/POC 批处理、dddd 指纹治理与外部能力接入等日常工作流。

它把常见的文件整理、模板校验、去重、转换、指纹审计和 POC 归类放进一个本地桌面应用里，尽量减少在脚本、编辑器和文件管理器之间反复切换。

## 功能概览

### YAML 与 POC 处理

- 批量加载、预览、编辑和保存 YAML / YML 文件。
- 对 Nuclei 模板进行校验、去重、分类、收集和自动修复。
- 将外部 POC 转换为项目可用的 YAML 输出。
- 支持源目录、缓冲区、目标目录三段式处理，便于先预览再落盘。

### dddd 指纹治理

- 审计 `common/config/finger.yaml`、`workflow.yaml` 和 `common/config/pocs` 的关联关系。
- 识别有指纹无 POC、有 POC 无指纹、workflow 不可调用、虚空 POC、残缺 POC 等问题。
- 对审计问题按风险优先级展示，并支持定位文件、复制对象名等辅助操作。

### 外部能力接入

- 扫描外部指纹目录，生成 dddd 指纹导入预览。
- 扫描外部 POC 目录，按 dddd 指纹进行归类，保留并标记重复项。
- 将审核后的 `日期_finger` / `日期_poc` 目录与目标 dddd 项目做严格对比。
- 一键接入新增能力，写入 `finger.yaml`、`workflow.yaml` 和 `common/config/pocs`，写入前会生成备份并避免覆盖同名 POC。

## 技术栈

- Go
- Wails
- Vite
- 原生 JavaScript / CSS

## 开发

```bash
wails dev
```

Wails 会启动桌面窗口，并提供本地调试入口。修改前端代码后可由 Vite 热更新，修改 Go 绑定后需要重新生成/重启对应流程。

## 构建

```bash
wails build
```

常见跨平台示例：

```bash
wails build -platform windows/amd64
wails build -platform darwin/amd64,darwin/arm64
wails build -platform linux/amd64
```

构建产物位于 `build/bin/`。

## 测试

```bash
go test ./...
```

前端生产构建校验：

```bash
cd frontend
npm.cmd run build
```

在非 Windows shell 中也可以使用：

```bash
npm run build
```

## 目录结构

```text
Doperationtool/
├── main.go                         # Wails 入口
├── app.go                          # 后端 App 结构与基础绑定
├── external_capability.go          # 外部指纹/POC 审核结果接入 dddd
├── external_poc_catalog.go         # 外部 POC 按 dddd 指纹归类
├── fingerprint_audit.go            # dddd 指纹、workflow、POC 关联审计
├── fingerprint_import.go           # 外部指纹导入预览与应用
├── nuclei*.go                      # Nuclei 模板校验、去重、分类、收集、修复
├── pocconvert.go                   # POC 转换
├── frontend/
│   ├── src/main.js                 # 前端 UI、模块路由与事件绑定
│   ├── src/style.css               # 应用样式
│   └── wailsjs/                    # Wails 自动生成的前端绑定
├── build/                          # 构建配置与输出目录
└── wails.json                      # Wails 项目配置
```

## 使用建议

- 对目标 dddd 项目执行写入类操作前，先完成预览和人工审核。
- 能力接入会自动备份被修改的 `finger.yaml` 和 `workflow.yaml`。
- 外部 POC 写入 `common/config/pocs` 时会避开已有同名文件，避免覆盖现有能力。

## 仓库

GitHub: [AJings3c/Doperationtool](https://github.com/AJings3c/Doperationtool)
