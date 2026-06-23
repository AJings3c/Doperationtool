# Doperationtool

Doperationtool 是一款面向 dddd 项目的本地能力库运维工具，用于维护 `finger.yaml`、`dir.yaml`、`workflow.yaml` 三文件识别链路，以及外部指纹、接口路径和 POC 能力接入流程。

它把 dddd 日常运维中的指纹审计、外部指纹导入、外部 POC 归类、能力差异对比、审核留痕、写入备份和回滚入口放进一个本地桌面应用里，尽量减少在脚本、编辑器和文件管理器之间反复切换。

YAML、Nuclei、POC 批处理能力是服务 dddd 运维流程的支撑工具，不是本项目的主定位。

## 功能概览

### dddd 能力库运维

- 审计 `common/config/finger.yaml`、`common/config/dir.yaml`、`workflow.yaml` 和 `common/config/pocs` 的关联关系。
- 识别入口按 `finger.yaml ∪ dir.yaml` 判断，workflow 只作为识别后的 POC 联动层。
- 识别识别入口无 workflow、workflow 无识别入口、POC 未被 workflow 调用、workflow 引用缺失 POC、残缺 POC 等问题。
- 对审计问题按风险优先级展示，并支持定位文件、复制对象名等辅助操作。
- 产出面向运维处理的修复建议，帮助判断是补指纹、补 workflow、补 POC，还是保留为资产识别类能力。

### 外部能力接入

- 将审核后的 `日期_finger` / `日期_dir` / `日期_poc` 目录与目标 dddd 项目做严格对比。
- 只展示相对目标 dddd 新增的指纹规则、接口路径和 POC，支持人工勾选接入范围。
- 一键接入新增能力，写入 `finger.yaml`、`dir.yaml`、`workflow.yaml`，并把 nuclei YAML / POC 写入 `common/config/pocs` 供 workflow 调用。
- 写入前自动备份，外部 POC 写入时避开已有同名文件，写入后执行关联审计，并提供本次接入的备份恢复入口。

### 外部指纹与 POC 审核

- 扫描外部指纹目录，生成 dddd 指纹导入预览。
- 支持 dddd 原生 `dir.yaml` 接口路径审核结果进入能力接入流程。
- 扫描外部 POC 目录，按 dddd `finger.yaml ∪ dir.yaml` 的可识别产品进行归类，保留并标记重复项。
- 支持人工移除/恢复候选项，保存可审计的 `日期_finger` / `日期_dir` / `日期_poc` 审核结果目录。
- 审核结果作为后续“能力接入”的输入，避免未确认内容直接写入 dddd 项目。

### 支撑工具

- 批量加载、预览、编辑和保存 YAML / YML 文件。
- 对 Nuclei 模板进行校验、去重、分类、收集和自动修复。
- 将外部 POC 转换为项目可用的 YAML 输出。
- 支持源目录、缓冲区、目标目录三段式处理，便于先预览再落盘。

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
├── fingerprint_audit.go            # dddd finger、dir、workflow、POC 关联审计
├── fingerprint_import.go           # 外部指纹导入预览与应用
├── external_poc_catalog.go         # 外部 POC 按 dddd 识别入口归类并保存审核结果
├── external_capability.go          # 外部指纹/接口路径/POC 审核结果对比并接入 dddd
├── nuclei*.go                      # 支撑 dddd 运维的 Nuclei 模板校验、去重、分类、收集、修复
├── pocconvert.go                   # 支撑 dddd 运维的 POC 转换
├── frontend/
│   ├── src/main.js                 # 前端 UI、模块路由与事件绑定
│   ├── src/style.css               # 应用样式
│   └── wailsjs/                    # Wails 自动生成的前端绑定
├── build/                          # 构建配置与输出目录
└── wails.json                      # Wails 项目配置
```

## 使用建议

- 对目标 dddd 项目执行写入类操作前，先完成预览和人工审核。
- 能力接入会自动备份被修改的 `finger.yaml`、`dir.yaml` 和 `workflow.yaml`。
- 外部 POC 写入 `common/config/pocs` 时会避开已有同名文件，避免覆盖现有能力。
- YAML、Nuclei、POC 批处理功能优先作为 dddd 能力库维护流程的辅助入口使用。

## 仓库

GitHub: [AJings3c/Doperationtool](https://github.com/AJings3c/Doperationtool)
