# 微信云开发部署说明

## 当前云环境

小程序已配置云环境：

```text
YOUR_CLOUD_ENV_ID
```

前端配置位置：

```text
miniprogram/utils/store.js
```

云函数：

```text
cloudfunctions/warehouse
```

PDF 导出依赖 `pdfkit`，并优先使用 `cloudfunctions/warehouse/assets/chinese.otf` 显示中文。部署 `warehouse` 时必须选择“上传并部署：云端安装依赖”。

历史导出和出库单 PDF 会生成文件并上传云存储，`cloudfunctions/warehouse/config.json` 已把云函数超时时间设置为 30 秒。若仍看到 `Invoking task timed out after 3 seconds`，说明云端函数配置还没有更新成功，请到云开发控制台的 `warehouse` 函数配置里手动把超时时间改为 30 秒，或使用 CloudBase CLI 执行 `tcb config update fn warehouse --timeout 30 -e YOUR_CLOUD_ENV_ID --yes`。

云端集合：

```text
warehouse_devices
warehouse_customers
warehouse_rentals
warehouse_logs
warehouse_warehouses
warehouse_exports
```

## 必须部署的云函数

请在微信开发者工具里执行：

1. 打开项目根目录。
2. 左侧找到 `cloudfunctions/warehouse`。
3. 右键 `warehouse`。
4. 选择“上传并部署：云端安装依赖”。
5. 等待部署完成。
6. 重新编译小程序。

当前仓库管理功能使用的云函数名称是 `warehouse`。

## 首次启动会做什么

小程序启动后会调用云函数：

```text
warehouse.ensureSeedData
```

它会自动创建或使用这些集合：

```text
warehouse_devices
warehouse_customers
warehouse_rentals
warehouse_logs
warehouse_warehouses
warehouse_exports
```

如果云端没有设备数据，会初始化 3 台示例设备。

如果本地曾经用过旧版本地缓存，会先尝试导入旧数据。

## 如果提示数据库或云函数连接失败

优先检查：

1. 云函数 `warehouse` 是否已经上传部署。
2. 部署时是否选择了“云端安装依赖”。
3. 微信开发者工具右上角云开发环境是否是你自己的环境 ID。
4. 当前小程序 AppID 是否拥有这个云环境。
5. 云开发控制台里是否能看到 `warehouse` 云函数。
6. 云函数日志里是否有 `collection not exists`、`Environment not found`、`FunctionName parameter could not be found`。

## 数据库权限

当前前端不直接读写数据库，所有数据库操作都通过云函数完成。因此数据库集合权限不需要开放给所有用户。

推荐集合权限：

```text
仅创建者可读写
```

或保持默认安全权限即可。

## 快速验证

部署完成后：

1. 重新编译小程序。
2. 打开“工作台”，应看到设备数量。
3. 打开“设备”，应看到 3 台示例设备。
4. 新增一台设备。
5. 去云开发控制台查看 `warehouse_devices` 是否出现新设备。
6. 新建一张租赁单。
7. 查看 `warehouse_rentals`、`warehouse_customers`、`warehouse_logs` 是否有数据。

## 常见错误

### FunctionName parameter could not be found

说明 `warehouse` 云函数没有部署，或部署到了错误环境。

### Environment not found

说明 `miniprogram/utils/store.js` 里的环境 ID 与当前 AppID 不匹配，或开发者工具没有切到正确小程序账号。

### Cannot find module wx-server-sdk

说明部署时没有选择“云端安装依赖”。请重新上传并部署。

### collection not exists

说明云函数未能创建集合。可以在云开发控制台手动创建：

```text
warehouse_devices
warehouse_customers
warehouse_rentals
warehouse_logs
warehouse_warehouses
warehouse_exports
```

然后重新编译小程序。
