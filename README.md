# Doperationtool

渗透测试辅助工具集 — 基于 Go + Wails 的本地桌面应用. 当前已实现:

## 模块

### 🛠 辅助模块
- **文件名提取** — 在 Finder 中选中多个文件 `⌘C`, 切到本工具左侧输入区 `⌘V`,
  即可批量得到文件名 (一行一个, 保留原顺序). 也支持直接拖入文件, 或粘贴一段路径文本
  (会自动按 `/` 分割取最后一段).

### 🔄 转换模块
- **YAML 转换** — 三栏工作流:
  1. **源目录** — 打开本地文件 / 文件夹 (默认仅列 `.yaml` `.yml`), 直接修改文件名和
     内容, 点 `保存` 写回磁盘.
  2. **缓冲区** — 一键从源同步, 在内存中改名 / 改内容, **不影响磁盘原文件**.
  3. **目标目录** — 选择一个输出目录, 把缓冲区当前的所有文件 (用其当前文件名) 写入
     该目录, 用于批量转换 / 派发场景.

> 实现要点: 浏览器 webview 在 `paste`/`drop` 事件的 `clipboardData.files` /
> `dataTransfer.files` 中, 把文件以 `File` 对象暴露给 JS, `file.name` 就是
> 不含目录前缀的纯文件名 (macOS 出于沙盒限制不允许 web 拿到完整路径, 这正好
> 是我们想要的). 后端 Go 提供 `App.ExtractBaseNames(string) []string` 作为
> 纯文本场景的备用接口, 当前未被前端调用.

## 开发

```bash
# 实时热重载 (打开桌面窗口, 改前端文件即时生效)
wails dev

# 同时也起 http://localhost:34115 浏览器调试入口, 可直接调 Go binding.
```

## 编译

```bash
# 当前平台
wails build

# 跨平台 (示例)
wails build -platform darwin/amd64,darwin/arm64
wails build -platform windows/amd64
wails build -platform linux/amd64
```

产物位于 `build/bin/`.

## 目录结构

```
Doperationtool/
├── main.go                     # Wails 入口 (窗口选项)
├── app.go                      # 后端 App struct + 暴露给前端的方法
├── wails.json                  # Wails 工程配置
├── frontend/
│   ├── index.html              # HTML 入口
│   ├── package.json            # 前端 npm 依赖 (Vite)
│   ├── src/
│   │   ├── main.js             # 全部 UI 渲染 + 事件绑定 + 模块路由
│   │   ├── style.css           # 暗色主题
│   │   └── app.css             # (空) 模板遗留, 不再使用
│   └── wailsjs/                # Wails 自动生成的 JS binding (build 时刷新)
└── build/                      # 编译输出目录
```

## 后续扩展

要新增子工具, 在 `frontend/src/main.js` 的 `submenu` 中加一项, 配套增加路由切换
即可. 复杂逻辑 (如本机文件遍历) 走 Go binding, 在 `app.go` 加方法, 由 Wails
自动生成 JS 调用桩.
