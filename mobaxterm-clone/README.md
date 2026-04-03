# MobaXterm Clone

<p align="center">
  <strong>🖥️ 一个基于 Wails + React 构建的现代化全能终端模拟器</strong>
</p>

<p align="center">
  <a href="#-核心功能">核心功能</a> •
  <a href="#-技术栈">技术栈</a> •
  <a href="#-项目架构">项目架构</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-贡献说明">贡献说明</a>
</p>

---

## 📖 项目简介

MobaXterm Clone 是一款面向 **系统管理员** 和 **网络工程师** 的跨平台终端工具。它提供了简洁直观的操作界面，集成了远程连接、文件传输、网络诊断、自动化运维等多种能力，帮助运维人员高效完成日常工作。

## ✨ 核心功能

### 🔌 多协议远程连接
- **SSH** — 支持密码认证和私钥认证，自动检测编码
- **Telnet** — 兼容各类网络设备（交换机、路由器等）
- **Serial (串口)** — 支持自定义波特率、数据位、校验位等参数

### 🔐 SSH 隧道 / 端口转发
- 支持 **本地转发 (Local)**、**远程转发 (Remote)**、**动态转发 (Dynamic / SOCKS5)**
- 可视化隧道管理面板，一键创建与销毁

### 🤖 Expect 自动化引擎
- 基于规则的自动交互式命令执行
- 支持自定义 prompt 匹配模式和超时配置
- 适用于批量设备配置、自动化巡检等场景

### 📁 内置 SFTP 客户端
- SSH 连接自动开启文件管理面板
- 支持上传、下载、删除、重命名、新建目录
- 拖拽式文件操作，支持目录浏览

### 📡 内置 TFTP 服务器 & 客户端
- 一键启动 TFTP 服务器，方便固件升级和配置备份
- 内置 TFTP 客户端，支持主动推送/拉取文件

### 🗂️ 会话管理
- 基于本地 **SQLite** 数据库持久化存储会话
- 支持分组管理、搜索筛选
- 密码 AES 加密存储，保障安全

### 📚 知识库 (Knowledge Base)
- 存储常用命令、操作手册和设备模板
- 全局快速搜索，一键将命令发送到终端
- 管理后台支持 CRUD 操作

### 🔄 宏管理器 (Macro Manager)
- 录制和回放终端操作序列
- 自定义宏命令，提升重复性工作效率

### 📋 命令审计 & 日志
- 自动记录终端操作命令流
- 支持历史日志查询和导出
- 方便复盘和排障

### 🎨 现代化 UI
- 暗黑主题，极简设计风格
- 多 Tab 终端，支持分屏显示
- 可折叠侧边栏，自适应布局
- Lucide 图标集，视觉统一

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | [Wails v2](https://wails.io/) (Go ↔ Web 桥接) |
| **后端语言** | Go 1.20+ |
| **前端框架** | React 18 + TypeScript |
| **构建工具** | Vite |
| **终端引擎** | xterm.js + xterm-addon-fit |
| **数据存储** | SQLite (go-sqlite) |
| **图标库** | Lucide React |
| **SSH 库** | golang.org/x/crypto/ssh |
| **串口库** | go.bug.st/serial |

## 🏗️ 项目架构

```
mobaxterm-clone/
├── app.go                          # Wails 应用主逻辑 (Go ↔ 前端桥接)
├── main.go                         # 程序入口
├── wails.json                      # Wails 配置
├── internal/                       # 后端核心模块
│   ├── config/settings.go          # 应用配置管理
│   ├── connection/                 # 连接管理
│   │   ├── manager.go              # 连接生命周期管理
│   │   ├── ssh.go                  # SSH 协议实现
│   │   ├── telnet.go               # Telnet 协议实现
│   │   ├── serial.go               # Serial 串口实现
│   │   ├── tunnel.go               # SSH 隧道/端口转发
│   │   └── expect.go               # Expect 自动化引擎
│   ├── db/database.go              # SQLite 数据库操作
│   └── tftp/                       # TFTP 模块
│       ├── server.go               # TFTP 服务器
│       └── client.go               # TFTP 客户端
├── frontend/                       # 前端工程
│   └── src/
│       ├── App.tsx                  # 主应用组件
│       ├── components/             # UI 组件
│       │   ├── Sidebar.tsx          # 侧边栏导航
│       │   ├── TerminalTabs.tsx     # 多 Tab 终端
│       │   ├── SessionModal.tsx     # 会话配置弹窗
│       │   ├── SFTPBrowser.tsx      # SFTP 文件管理器
│       │   ├── TFTPServer.tsx       # TFTP 管理面板
│       │   ├── KBSearch.tsx         # 知识库搜索
│       │   ├── KnowledgeAdmin.tsx   # 知识库管理
│       │   ├── MacroManager.tsx     # 宏管理器
│       │   └── HistoryLogs.tsx      # 历史日志
│       └── types/                   # TypeScript 类型定义
└── build/                          # 构建资源 (图标等)
```

## 📦 快速开始

### 依赖环境

- [Go](https://go.dev/dl/) 1.20+
- [Node.js](https://nodejs.org/) 16+ (需要 npm)
- [Wails CLI](https://wails.io/docs/gettingstarted/installation) v2

```bash
# 安装 Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 验证环境
wails doctor
```

### 开发模式

```bash
# 克隆项目
git clone https://github.com/253226531-lang/mobaxterm-clone-.git
cd mobaxterm-clone-/mobaxterm-clone

# 安装前端依赖
cd frontend && npm install && cd ..

# 运行开发服务器 (支持热重载)
wails dev
```

### 编译打包

```bash
# 编译生产版本 (Windows)
wails build

# 输出路径: build/bin/
```

## 🗺️ 路线图

- [x] SSH / Telnet / Serial 多协议连接
- [x] SFTP 文件传输
- [x] TFTP 服务器 & 客户端
- [x] 会话管理 & 加密存储
- [x] 知识库系统
- [x] 宏管理器
- [x] SSH 隧道 / 端口转发
- [x] Expect 自动化引擎
- [x] 命令审计日志
- [ ] RDP 远程桌面协议支持
- [ ] VNC 连接支持
- [ ] 多语言国际化 (i18n)
- [ ] 插件系统

## 🤝 贡献说明

欢迎贡献代码！请遵循以下流程：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交修改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

如果在使用过程中发现任何问题或有新的功能建议，欢迎提交 [Issue](https://github.com/253226531-lang/mobaxterm-clone-/issues)。

## 📄 开源协议

本项目基于 [MIT](LICENSE) 协议开源。
