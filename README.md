# 🎬 影视设备管理系统

> 基于微信云开发的小程序——专为影视器材租赁团队打造的「设备库存 + 租赁追踪 + 出库单据 + 数据统计」一站式管理工具。

[![WeChat](https://img.shields.io/badge/小程序-微信-green?logo=wechat)](https://developers.weixin.qq.com/miniprogram/dev/framework/)
[![CloudBase](https://img.shields.io/badge/云开发-CloudBase-blue?logo=tencentcloud)](https://cloud.weixin.qq.com/)
[![Node](https://img.shields.io/badge/Node-16.13-brightgreen?logo=nodedotjs)](https://nodejs.org/)

---

## 📖 目录

- [为什么需要它？](#-为什么需要它)
- [核心功能](#-核心功能)
- [技术架构](#-技术架构)
- [项目结构](#-项目结构)
- [快速开始](#-快速开始)
- [数据库设计](#-数据库设计)
- [云函数 API](#-云函数-api)
- [功能亮点](#-功能亮点)
- [路线图](#-路线图)
- [License](#-license)

---

## 🤔 为什么需要它？

影视剧组、器材租赁公司的日常运营中，设备从入库、预约、出库到归还涉及大量繁琐的纸质登记和微信沟通。一旦设备多了，就容易出现——

- ❌ 不知道某台设备目前在哪里、谁在用
- ❌ 忘记租金收取，账目一团乱
- ❌ 归还时设备损坏无处追溯
- ❌ 出库单手写费时费力
- ❌ 多个仓库的设备难以统一管理

**这个系统就是为了解决以上痛点而生的**，它跑在微信小程序里，无需安装，扫码就能用，数据存在云端，团队成员随时随地协同工作。

---

## ✨ 核心功能

### 📋 设备管理
- 设备入库 / 编辑 / 停用 / 软删除，支持品牌、型号、序列号、租金、押金等信息
- 多仓库归属隔离，设备在不同仓库间互不干扰
- 设备编号自动去重
- 实时状态流转：`可租 → 预约 → 租出 → 已还` / `维修` / `停用`

### 🔍 扫码即用
- **扫码借设备**：租赁表单中扫码快速添加设备到清单
- **扫码还设备**：租赁详情中扫码自动勾选待归还设备
- **扫码查设备**：工作台扫码直达设备详情页
- 支持 **Code128B 条形码**（Canvas 2D 实时绘制，标准扫码枪可识别）和 **二维码**（云函数自动生成）

### 📦 租赁全流程
- 创建租赁单（预约 / 直接借出），自动计算租金
- 预约转借出一键确认
- 设备归还（支持部分归还 + 损坏标记 + 损坏费追加）
- 取消租赁，自动释放设备
- 收款追加 + 押金处理（未收 / 已收 / 已退 / 抵扣 / 信用免押）

### 🧾 出库单 PDF
- 一键生成 A4 版面的设备出库单，包含：
  - 公司抬头 / Logo / 电话
  - 设备清单表格（编号、设备名、品牌型号、日租金）
  - 费用明细（租金、押金、已收、未收）
  - 自定义合同条款（云端存储、可编辑）
  - 租赁人 + 经办人签字区

### 📊 数据统计
- 工作台仪表盘：设备总数 / 租出 / 预约 / 逾期 / 今日到期
- 统计看板 + 操作日志 + 历史导出（支持 PDF / CSV，多条件筛选）
- 按客户查看租赁历史和累计消费

### 🗓 日程甘特图
- 7 / 30 / 90 天视图切换
- 按设备 + 日期展示占用状态，颜色区分预约 / 租出 / 逾期
- 关键词搜索（300ms 防抖）

### 👥 客户管理
- 客户列表 + 搜索防抖
- 客户详情页：历史租赁单 + 累计统计（租次 / 金额）
- 创建租赁时自动创建或更新客户信息

### 🏬 多仓库支持
- 多仓库 CRUD，默认仓库切换
- 设备 / 租赁 / 日志按仓库隔离
- 仓库删除含设备归属检查

### 💾 数据备份与恢复
- 一键备份全部 6 个数据库集合为 JSON，支持分享文件或复制文本
- 从 JSON 文件恢复数据（upsert 合并模式），支持选文件或粘贴内容

### ✨ 合同条款管理
- 出库单合同条款云端存储，全局默认 + 单次自定义
- 生成出库单时可选择「使用默认」「清空」「编辑」

---

## 🏗 技术架构

```
┌─────────────────────────────────────────┐
│             微信小程序前端                 │
│  ┌───────┐ ┌──────┐ ┌──────────┐       │
│  │ 12 页面 │ │ WXS │ │ <export-  │       │
│  │ 4 Tab │ │   金额  │ │  modal>  │       │
│  └───┬───┘ └──────┘ └──────────┘       │
│      │  store.js（数据层 + 10s 缓存）     │
└──────┼──────────────────────────────────┘
       │  wx.cloud.callFunction("warehouse")
       ▼
┌──────────────────────────────────────────┐
│         云函数 warehouse                  │
│  ┌────────────────────────────────┐     │
│  │  26 个 Action 路由分发          │     │
│  │  • 设备 CRUD   • 租赁 CRUD      │     │
│  │  • 客户查询    • 日程甘特图       │     │
│  │  • 统计聚合    • PDF 生成 (PDFKit)│     │
│  │  • QR 码生成   • 数据备份/恢复    │     │
│  │  • 合同条款    • 初始化/引导      │     │
│  └────────┬───────────────────────┘     │
└───────────┼─────────────────────────────┘
            ▼
┌──────────────────────────────────────────┐
│           微信云数据库（6 个集合）          │
│  warehouse_warehouses  │  仓库           │
│  warehouse_devices     │  设备           │
│  warehouse_customers   │  客户           │
│  warehouse_rentals     │  租赁单          │
│  warehouse_logs        │  操作日志        │
│  warehouse_config      │  全局配置        │
└──────────────────────────────────────────┘
```

| 层级 | 技术 |
|------|------|
| 前端框架 | 微信小程序原生（基础库 ≥ 2.20.1） |
| 云服务 | 微信云开发 CloudBase（数据库 + 云存储 + 云函数） |
| 云函数运行时 | Node.js 16.13 |
| 核心依赖 | `wx-server-sdk ~2.4.0` · `pdfkit ^0.15.0` · `qrcode ^1.5.3` |
| 条形码 | 前端 Canvas 2D Code128B |
| 金额格式化 | 自定义 WXS 模块（千分位 + 保留两位小数） |
| 性能优化 | 10s 内存缓存 · Promise.all 并行 · 300ms 防抖 · 分页机制 |

---

## 📁 项目结构

```
miniprogram-1/
├── cloudfunctions/warehouse/        # 云函数
│   ├── index.js                     # 主入口（26 个 action 路由）
│   ├── package.json                 # pdfkit + qrcode + wx-server-sdk
│   └── assets/chinese.otf           # PDF 中文字体（Noto Sans SC）
│
├── miniprogram/
│   ├── app.js                       # 应用入口 · 云环境初始化
│   ├── app.json                     # 路由 · 窗口 · TabBar 配置
│   ├── app.wxss                     # 全局样式
│   ├── utils/
│   │   └── store.js                 # 数据层封装 · 缓存 · 常量
│   ├── components/
│   │   └── export-modal/            # 导出弹窗公共组件
│   ├── pages/
│   │   ├── index/                   # 🏠 工作台（仪表盘）
│   │   ├── devices/                 # 📋 设备列表
│   │   ├── deviceDetail/            # 🔍 设备详情 + 条形码
│   │   ├── deviceForm/              # ✏️ 新增/编辑设备
│   │   ├── rentals/                 # 📦 租赁列表
│   │   ├── rentalForm/              # 🛒 创建租赁/预约
│   │   ├── rentalDetail/            # 📄 租赁详情 · 归还 · 出库单
│   │   ├── customers/               # 👥 客户列表
│   │   ├── customerDetail/          # 👤 客户详情
│   │   ├── schedule/                # 🗓 日程甘特图
│   │   ├── history/                 # 📊 统计看板 · 日志 · 导出
│   │   └── warehouses/              # 🏬 仓库管理
│   ├── images/                      # 图标资源
│   └── wxs/
│       └── money.wxs                # 金额千分位格式化
│
├── cloudbaserc.json                 # 云开发部署配置
├── project.config.json              # 微信开发者工具配置
├── OPEN_SOURCE_CHECKLIST.md         # 公开发布前检查清单
└── README.md                        # 本文档
```

---

## 🚀 快速开始

### 前置条件

1. [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) 最新版
2. 一个已注册的微信小程序 AppID
3. 开通 [微信云开发](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html) 能力

### 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-org/miniprogram-1.git
cd miniprogram-1

# 2. 修改 project.config.json 中的 appid 为你自己的 AppID

# 3. 用微信开发者工具打开项目根目录

# 4. 在开发者工具中点击「云开发」开通环境
#    将 cloudbaserc.json 中的 envId 替换为你的云环境 ID

# 5. 右键 cloudfunctions/warehouse → 「上传并部署：云端安装依赖」
#    （云函数依赖 pdfkit / qrcode 会自动安装）

# 6. 在云开发控制台创建以下 6 个数据库集合：
#    warehouse_warehouses
#    warehouse_devices
#    warehouse_customers
#    warehouse_rentals
#    warehouse_logs
#    warehouse_config

# 7. 编译运行，首次进入会自动插入种子数据引导使用
```

> **注意**：PDF 中文字体文件 `assets/chinese.otf` 位于 `cloudfunctions/warehouse/` 目录下，部署云函数时会一并上传。字体授权信息见同目录的 `OFL.txt`。

---

## 🗄 数据库设计

### `warehouse_warehouses` — 仓库
| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 仓库名称 |
| `city` | string | 所在城市 |
| `address` | string | 详细地址 |
| `manager` | string | 负责人 |
| `phone` | string | 联系电话 |
| `isDefault` | boolean | 是否默认仓库 |

### `warehouse_devices` — 设备
| 字段 | 类型 | 说明 |
|------|------|------|
| `warehouseId` | string | 归属仓库 ID |
| `deviceNo` | string | 设备编号（唯一） |
| `name` | string | 设备名称 |
| `category` | string | 类别（摄影机/镜头/灯光/音频/稳定器/配件/其他） |
| `brand` | string | 品牌 |
| `model` | string | 型号 |
| `serialNo` | string | 序列号 |
| `status` | string | 状态：available / reserved / rented / returned / repairing / disabled |
| `dailyRent` | number | 日租金 |
| `weeklyRent` | number | 周租金 |
| `monthlyRent` | number | 月租金 |
| `depositAmount` | number | 押金金额 |
| `currentRentalId` | string | 当前关联租赁单 ID |
| `qrImageFileId` | string | 二维码云存储 fileID |

### `warehouse_rentals` — 租赁单
| 字段 | 类型 | 说明 |
|------|------|------|
| `warehouseId` | string | 仓库 ID |
| `rentalNo` | string | 租赁单号（R 开头） |
| `customerId` | string | 客户 ID |
| `customerSnapshot` | object | 客户快照 |
| `devices[]` | array | 租用设备列表（含借用详情） |
| `status` | string | reserved / rented / partReturned / returned / cancelled |
| `startAt` / `expectedReturnAt` | datetime | 租赁起止时间 |
| `rentAmount` / `depositAmount` / `paidAmount` | number | 租金 / 押金 / 已收 |
| `totalAmount` / `discountAmount` / `damageFee` | number | 合计 / 优惠 / 损坏费 |
| `paymentStatus` | string | unpaid / partial / paid |
| `depositStatus` | string | notReceived / received / refunded / partialRefund / deducted / credited |
| `operatorName` | string | 操作员 |
| `outboundPrintCount` | number | 出库单打印次数 |

### `warehouse_logs` — 操作日志
| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 日志分类：device / rental / return |
| `deviceId` / `rentalId` / `customerId` | string | 关联 ID |
| `title` / `content` | string | 标题 / 内容 |
| `occurredAt` | datetime | 发生时间 |

### `warehouse_config` — 全局配置
| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | string | 固定 `"defaults"` |
| `contractTerms` | string | 出库单默认合同条款 |

---

## ☁️ 云函数 API

云函数 `warehouse` 通过 `action` 参数路由，共 **26 个接口**：

### 初始化 & 引导
| action | 说明 |
|--------|------|
| `getBootstrap` | 获取当前仓库 + 仓库列表 |
| `ensureSeedData` | 首次使用自动插入种子设备 |

### 仓库
| action | 说明 |
|--------|------|
| `getWarehouses` | 获取全部仓库 |
| `upsertWarehouse` | 新增 / 编辑仓库 |
| `deleteWarehouse` | 删除仓库 |
| `setDefaultWarehouse` | 设置默认仓库 |

### 设备
| action | 说明 |
|--------|------|
| `getDevices` | 获取设备列表 |
| `getDevice` | 获取单台设备详情 |
| `upsertDevice` | 新增 / 编辑设备 |
| `setDeviceStatus` | 变更设备状态 |

### 租赁
| action | 说明 |
|--------|------|
| `getRentals` | 获取租赁列表（支持筛选） |
| `getRental` | 获取租赁详情 |
| `createRental` | 创建租赁单 |
| `confirmRental` | 预约 → 借出 |
| `cancelRental` | 取消租赁 |
| `updateRentalPayment` | 追加收款 / 更新押金 |
| `returnRentalDevices` | 归还设备 |

### 客户 & 日程 & 统计
| action | 说明 |
|--------|------|
| `getCustomers` | 获取全部客户 |
| `getScheduleRows` | 生成日程甘特图数据 |
| `getDashboard` | 工作台聚合接口 |
| `getStats` | 纯统计数字 |
| `getLogs` | 操作日志查询 |

### 导出 & 备份
| action | 说明 |
|--------|------|
| `exportHistory` | 导出 PDF/CSV |
| `exportOutboundOrder` | 生成出库单 PDF |
| `backupAllData` | 备份全部数据 → JSON |
| `restoreAllData` | 从 JSON 恢复数据 |

### 二维码 & 配置
| action | 说明 |
|--------|------|
| `generateDeviceQR` | 生成设备二维码 |
| `getDeviceQR` | 获取 / 自动生成二维码 |
| `getDefaultTerms` | 获取默认合同条款 |
| `setDefaultTerms` | 保存默认合同条款 |

---

## 🌟 功能亮点

| 特性 | 实现方式 |
|------|----------|
| 🔢 **设备编号唯一性** | 云函数 upsert 时自动查重，重复编号拒绝入库 |
| ⚡ **10 秒智能缓存** | `cachedCall()` 避免 Tab 切换重复请求，Dashboard 接口聚合减少调用 |
| 📱 **全页面三态** | 6 个核心页面均实现 loading → 数据 / error → 重试 的完整状态覆盖 |
| 🧹 **保旧数据降级** | TabBar 页面在有旧数据时静默刷新，失败不覆盖已有内容 |
| 🔄 **并行加载** | 设备详情页使用 `Promise.all` 同时拉取日志和日程 |
| 🎯 **300ms 防抖** | 客户搜索、日程关键词搜索均有防抖处理 |
| 💰 **金额千分位** | 自定义 WXS 模块，6 个页面 19 处金额统一格式化 |
| 📄 **出库单 PDF** | PDFKit + 中文字体嵌入，标准 A4 版面带签字区 |
| 🔄 **数据备份** | 6 个集合一键导出 JSON，支持文件分享 / 剪贴板；upsert 合并恢复 |
| 🏬 **多仓库隔离** | 设备 / 租赁 / 日志按仓库归属，支持默认仓库切换 |
| 🛡️ **微信登录适配** | 已适配新版 `<input type="nickname">` 组件 |

---

## 🗺 路线图

- [ ] 周租 / 月租阶梯定价策略（按天数自动选择最优计费）
- [ ] 工作台「今日到期」醒目提示
- [ ] 日程甘特图「包含已归还」筛选开关
- [ ] 租赁附件上传（合同照片 / 交接单）
- [ ] 统计图表（月度收入 / 租赁量趋势）
- [ ] 暗黑模式适配

公开发布前请完成 [`OPEN_SOURCE_CHECKLIST.md`](./OPEN_SOURCE_CHECKLIST.md) 中的仓库级授权、资源版权和最终密钥扫描。

---

## 📄 License

本项目采用 [GNU General Public License v3.0 only](./LICENSE)（SPDX：`GPL-3.0-only`）。字体资源使用其目录内单独列出的 SIL Open Font License。使用本项目时仍需遵守微信小程序与云开发平台的服务条款。

---

<p align="center">
  <sub>Made with ❤️ for film crew equipment management</sub>
</p>
