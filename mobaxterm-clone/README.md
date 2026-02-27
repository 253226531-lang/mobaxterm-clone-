# MobaXterm Clone

一个基于 **Wails** 和 **React** 构建的现代化全能终端模拟器。它旨在为系统管理员和网络工程师提供简单、直观且功能强大的连接管理体验。

## 🚀 核心功能

- **多协议连接**: 支持 SSH、Telnet 和 Serial (串口) 协议。
- **智能中文显示**: 
    - 针对中文乱码问题，支持在会话配置中手动切换 **UTF-8** 和 **GBK** 编码。
    - 完美支持 Windows CMD 和各类网络设备（交换机、路由器）的中文回显。
- **内置 SFTP 客户端**: 在建立 SSH 连接时自动开启文件管理面板，支持上传、下载、删除等操作。
- **内置 TFTP 服务器**: 便于网络设备固件升级和配置文件传输。
- **会话管理**:
    - 基于本地 SQLite 数据库存储会话。
    - 支持会话搜索、分类和密码加密存储。
- **知识库 (KB)**: 
    - 存储常用命令和操作规范。
    - 支持全局快速搜索和一键发送命令到终端。
- **命令审计**: 自动记录终端操作命令流，方便复盘和排障。
- **现代化 UI**: 采用 React + Lucide 图标集，极简暗黑风格，支持分屏显示。

## 🛠️ 技术栈

- **后端**: Go (Wails 框架)
- **前端**: React + TypeScript + Vite
- **终端引擎**: xterm.js
- **存储**: SQLite (go-sqlite)
- **图标**: Lucide React

## 📦 快速开始

### 依赖环境
- [Go](https://go.dev/dl/) (1.20+)
- [Wails CLI](https://wails.io/docs/gettingstarted/installation)
- [Node.js](https://nodejs.org/en/download/) (需要 npm)

### 开发模式
```bash
# 进入项目目录
cd mobaxterm-clone

# 运行开发服务器
wails dev
```

### 编译打包
```bash
# 编译生产版本 (Windows)
wails build
```

## 🤝 贡献说明
如果您在使用过程中发现任何问题或有新的功能建议，欢迎提交 Issue 或 Pull Request。

## 📄 开源协议
MIT
