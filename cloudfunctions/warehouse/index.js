const cloud = require("wx-server-sdk");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  warehouses: "warehouse_warehouses",
  devices: "warehouse_devices",
  customers: "warehouse_customers",
  rentals: "warehouse_rentals",
  logs: "warehouse_logs",
  exports: "warehouse_exports",
  config: "warehouse_config",
};

const CONFIG_ID = "defaults";

const STATUS_TEXT = {
  available: "可租",
  reserved: "已预约",
  rented: "已借出",
  overdue: "逾期",
  repairing: "维修中",
  disabled: "停用",
  returned: "已归还",
  partReturned: "部分归还",
  cancelled: "已取消",
  free: "空",
};

const PAYMENT_TEXT = {
  unpaid: "未付款",
  partial: "部分付款",
  paid: "已付款",
};

const DEPOSIT_TEXT = {
  none: "无押金",
  notReceived: "未收",
  received: "已收",
  partialRefund: "部分退",
  refunded: "已退",
  deducted: "已扣除",
  credited: "信用免押",
};

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

function now() {
  return formatDateTime(new Date());
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function parseDateTime(value) {
  if (!value) return null;
  const normalized = `${value}`.replace(/-/g, "/");
  const text = normalized.length <= 10 ? `${normalized} 00:00` : normalized;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(`${value}`.slice(0, 10).replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function calculateDuration(startAt, expectedReturnAt) {
  const start = parseDateTime(startAt);
  const end = parseDateTime(expectedReturnAt);
  if (!start || !end || end <= start) {
    return { durationHours: 1, rentalDays: 1 };
  }
  const durationHours = Math.max(Math.ceil((end.getTime() - start.getTime()) / 3600000), 1);
  return {
    durationHours,
    rentalDays: Math.max(Math.ceil(durationHours / 24), 1),
  };
}

function buildDays(count, startDate) {
  const base = parseDateOnly(startDate) || new Date();
  return Array.from({ length: count }).map((_, index) => {
    const d = new Date(base);
    d.setDate(base.getDate() + index);
    const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return {
      key: formatDate(d),
      day: `${d.getMonth() + 1}/${d.getDate()}`,
      week,
      isToday: formatDate(d) === formatDate(new Date()),
    };
  });
}

function isDateBetween(key, startAt, endAt) {
  const start = `${startAt || ""}`.slice(0, 10);
  const end = `${endAt || startAt || ""}`.slice(0, 10);
  return start && end && key >= start && key <= end;
}

function isOverdueStatus(status, expectedReturnAt) {
  const end = parseDateTime(expectedReturnAt);
  return (status === "rented" || status === "partReturned") && end && end.getTime() < Date.now();
}

function withDeviceStatus(device) {
  const next = { ...device };
  next.displayStatus = next.status === "rented" && isOverdueStatus("rented", next.expectedReturnAt) ? "overdue" : next.status;
  next.statusText = STATUS_TEXT[next.displayStatus] || next.displayStatus;
  return next;
}

function withRentalStatus(rental) {
  const next = { ...rental };
  next.displayStatus = isOverdueStatus(next.status, next.expectedReturnAt) ? "overdue" : next.status;
  next.statusText = STATUS_TEXT[next.displayStatus] || next.displayStatus;
  next.paymentText = PAYMENT_TEXT[next.paymentStatus] || next.paymentStatus;
  next.depositText = DEPOSIT_TEXT[next.depositStatus] || next.depositStatus;
  return next;
}

function stripId(record) {
  const next = { ...record };
  delete next._id;
  return next;
}

async function ensureCollections() {
  for (const name of Object.values(COLLECTIONS)) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // Existing collections throw here; later operations will surface real errors.
    }
  }
}

async function getAll(name) {
  const BATCH = 1000;
  let allData = [];
  let offset = 0;
  while (true) {
    const result = await db.collection(name).skip(offset).limit(BATCH).get();
    const data = result.data || [];
    allData = allData.concat(data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }
  return allData;
}

async function getById(name, id) {
  if (!id) return null;
  try {
    const result = await db.collection(name).doc(id).get();
    return result.data || null;
  } catch (e) {
    return null;
  }
}

async function ensureDefaultWarehouse() {
  await ensureCollections();
  const warehouses = await getAll(COLLECTIONS.warehouses);
  let warehouse = warehouses.find((item) => item.isDefault) || warehouses[0];
  if (!warehouse) {
    const at = now();
    warehouse = {
      _id: uid("wh"),
      name: "默认仓库",
      city: "",
      address: "",
      manager: "",
      phone: "",
      remark: "",
      isDefault: true,
      createdAt: at,
      updatedAt: at,
    };
    await db.collection(COLLECTIONS.warehouses).add({ data: warehouse });
  }
  await backfillWarehouseId(warehouse._id);
  return warehouse;
}

async function backfillWarehouseId(warehouseId) {
  for (const name of [COLLECTIONS.devices, COLLECTIONS.rentals, COLLECTIONS.logs]) {
    const rows = await getAll(name);
    await Promise.all(rows.filter((item) => !item.warehouseId).map((item) => (
      db.collection(name).doc(item._id).update({ data: { warehouseId } })
    )));
  }
}

async function addLog(log) {
  await db.collection(COLLECTIONS.logs).add({
    data: {
      _id: uid("log"),
      occurredAt: now(),
      createdAt: now(),
      ...log,
    },
  });
}

function escapeCsv(value) {
  const text = value === undefined || value === null ? "" : `${value}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function getUnpaidAmount(rental) {
  return Math.max(Number(rental.totalAmount || 0) - Number(rental.paidAmount || 0), 0);
}

async function uploadExportFile(fileName, content, contentType) {
  const cloudPath = `exports/${formatDate(new Date()).replace(/-/g, "")}/${uid("file")}-${fileName}`;
  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.isBuffer(content) ? content : Buffer.from(content),
  });
  const fileID = upload.fileID;
  const temp = await cloud.getTempFileURL({ fileList: [fileID] });
  return {
    fileID,
    cloudPath,
    tempFileURL: temp.fileList && temp.fileList[0] ? temp.fileList[0].tempFileURL : "",
    contentType,
  };
}

async function saveExportRecord(record) {
  await db.collection(COLLECTIONS.exports).add({
    data: {
      _id: uid("exp"),
      createdAt: now(),
      ...record,
    },
  });
}

function buildHistoryRows(rentals, warehouses, deviceId = "") {
  const warehouseMap = {};
  warehouses.forEach((item) => {
    warehouseMap[item._id] = item.name;
  });
  const rows = [];
  rentals.forEach((rental) => {
    const customer = rental.customerSnapshot || {};
    (rental.devices || []).filter((device) => !deviceId || device.deviceId === deviceId).forEach((device) => {
      rows.push({
        rentalNo: rental.rentalNo || rental._id,
        warehouseName: warehouseMap[rental.warehouseId] || "",
        deviceNo: device.deviceNo || "",
        deviceName: device.name || "",
        brand: device.brand || "",
        model: device.model || "",
        customerName: customer.name || "",
        phone: customer.phone || "",
        company: customer.company || "",
        startAt: rental.startAt || "",
        expectedReturnAt: rental.expectedReturnAt || "",
        actualReturnAt: device.returnedAt || rental.actualReturnAt || "",
        durationHours: rental.durationHours || 0,
        rentalDays: rental.rentalDays || 0,
        rentAmount: rental.rentAmount || 0,
        depositAmount: rental.depositAmount || 0,
        paidAmount: rental.paidAmount || 0,
        unpaidAmount: getUnpaidAmount(rental),
        statusText: STATUS_TEXT[rental.displayStatus || rental.status] || rental.status || "",
        remark: rental.remark || "",
      });
    });
  });
  return rows;
}

function buildHistoryCsv(rows) {
  const headers = ["租赁单号", "仓库", "设备编号", "设备名称", "品牌", "型号", "租赁人", "电话", "剧组/公司", "开始时间", "预计归还", "实际归还", "小时", "计费天数", "租金", "押金", "已收", "未收", "状态", "备注"];
  const keys = ["rentalNo", "warehouseName", "deviceNo", "deviceName", "brand", "model", "customerName", "phone", "company", "startAt", "expectedReturnAt", "actualReturnAt", "durationHours", "rentalDays", "rentAmount", "depositAmount", "paidAmount", "unpaidAmount", "statusText", "remark"];
  const lines = [headers.map(escapeCsv).join(",")];
  rows.forEach((row) => {
    lines.push(keys.map((key) => escapeCsv(row[key])).join(","));
  });
  return `\uFEFF${lines.join("\r\n")}`;
}

function useChineseFont(doc) {
  doc.font("zh");
  return doc;
}

function createPdfDocument(title, options = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const fontCandidates = [
    path.join(__dirname, "assets", "chinese.otf"),
  ];
  const fontPath = fontCandidates.find((item) => fs.existsSync(item));
  if (!fontPath) throw new Error("缺少中文字体文件");
  doc.registerFont("zh", fontPath);
  useChineseFont(doc);
  if (options.includeHeader) {
    if (options.logoBuffer) {
      try {
        doc.image(options.logoBuffer, 42, 36, { width: 44, height: 44, fit: [44, 44] });
      } catch (e) {
        // Invalid logo files are ignored so the PDF can still be generated.
      }
    }
    useChineseFont(doc).fontSize(15).fillColor("#111111").text(options.companyName || "影视设备仓库", options.logoBuffer ? 98 : 42, 38);
    if (options.contactPhone) {
      useChineseFont(doc).fontSize(9).fillColor("#666666").text(`联系电话：${options.contactPhone}`, options.logoBuffer ? 98 : 42, 60);
    }
    doc.fillColor("#000000").moveDown(1.7);
  }
  doc.x = 42;
  useChineseFont(doc).fontSize(20).fillColor("#111111").text(title, { align: "center" });
  doc.moveDown(1);
  return { doc, chunks };
}

function finishPdf(doc, chunks) {
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

function drawKeyValue(doc, label, value, x, y, width) {
  useChineseFont(doc).fontSize(9).fillColor("#666666").text(label, x, y, { width });
  useChineseFont(doc).fontSize(11).fillColor("#111111").text(value || "-", x, y + 14, { width });
}

function drawTable(doc, options) {
  const headers = options.headers || [];
  const rows = options.rows || [];
  const widths = options.widths || [];
  const startX = options.x || 42;
  let y = options.y || doc.y;
  const headerHeight = options.headerHeight || 24;
  const rowHeight = options.rowHeight || 34;
  const pageBottom = options.pageBottom || 760;
  const padding = options.padding || 5;
  const tableWidth = widths.reduce((sum, item) => sum + item, 0);

  function drawRow(values, height, fill, color, fontSize) {
    let x = startX;
    if (fill) {
      doc.save().rect(startX, y, tableWidth, height).fill(fill).restore();
    }
    doc.lineWidth(0.6).strokeColor("#C7C7CC");
    doc.rect(startX, y, tableWidth, height).stroke();
    widths.reduce((currentX, width) => {
      doc.moveTo(currentX, y).lineTo(currentX, y + height).stroke();
      return currentX + width;
    }, startX);
    doc.moveTo(startX + tableWidth, y).lineTo(startX + tableWidth, y + height).stroke();
    useChineseFont(doc).fontSize(fontSize).fillColor(color);
    values.forEach((value, index) => {
      doc.text(value || "-", x + padding, y + padding, {
        width: widths[index] - padding * 2,
        height: height - padding * 2,
        lineGap: 1,
      });
      x += widths[index];
    });
    y += height;
  }

  drawRow(headers, headerHeight, "#F5F5F7", "#333333", 8.5);
  rows.forEach((values) => {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = 42;
      drawRow(headers, headerHeight, "#F5F5F7", "#333333", 8.5);
    }
    drawRow(values, rowHeight, "", "#111111", options.fontSize || 7.8);
  });
  doc.y = y + 10;
  return doc.y;
}

async function buildHistoryPdf(rows, options = {}) {
  const { doc, chunks } = createPdfDocument("历史记录导出", options);
  useChineseFont(doc).fontSize(9).fillColor("#666666").text(`时间范围：${options.startDate || "-"} 至 ${options.endDate || "-"}`);
  useChineseFont(doc).text(`导出范围：${options.scopeText || "-"}`);
  doc.moveDown(0.8);
  const headers = ["租赁单", "仓库", "设备", "租赁人", "租期", "金额", "状态"];
  const widths = [64, 62, 96, 72, 112, 54, 48];
  const tableRows = rows.map((row) => ([
      row.rentalNo,
      row.warehouseName,
      `${row.deviceNo}\n${row.deviceName}`,
      `${row.customerName}\n${row.phone}`,
      `${row.startAt}\n${row.expectedReturnAt}`,
      `￥${money(row.rentAmount)}`,
      row.statusText,
    ]));
  drawTable(doc, { headers, rows: tableRows, widths, y: doc.y, rowHeight: 42, fontSize: 7.5 });
  if (!rows.length) {
    useChineseFont(doc).fontSize(11).fillColor("#666666").text("当前条件没有可导出的历史记录。");
  }
  return finishPdf(doc, chunks);
}

async function getLogoBuffer(fileID) {
  if (!fileID) return null;
  try {
    const file = await cloud.downloadFile({ fileID });
    return file.fileContent || null;
  } catch (e) {
    return null;
  }
}

async function buildOutboundPdf(rental, warehouse, options = {}) {
  const logoBuffer = await getLogoBuffer(options.logoFileId);
  const { doc, chunks } = createPdfDocument("设备出库单", { ...options, logoBuffer });
  const customer = rental.customerSnapshot || {};
  const unpaidAmount = getUnpaidAmount(rental);
  const MARGIN = 42;
  const PAGE_W = 595.28;  // A4 宽度
  const LABEL_H = 18;     // 标签行高（灰底）
  const VALUE_H = 24;     // 值行高（白底）
  const GROUP_H = LABEL_H + VALUE_H;

  // 绘制一组 KV：标签行 + 值行（无框线，仅文字排版）
  function drawKVGroup(doc, columns, y) {
    let cx = 42;
    columns.forEach((col) => {
      // 标签
      useChineseFont(doc).fontSize(8.5).fillColor("#666666")
        .text(col.label, cx + 5, y + 3, { width: col.width - 10 });
      // 值
      useChineseFont(doc).fontSize(10).fillColor("#111111")
        .text(col.value || "-", cx + 5, y + LABEL_H + 4, { width: col.width - 10 });
      cx += col.width;
    });
    return y + GROUP_H;
  }

  // Group 1: 出库单号, 仓库, 出库时间
  doc.y = drawKVGroup(doc, [
    { width: 130, label: "出库单号", value: rental.orderNo || rental.rentalNo || rental._id },
    { width: 130, label: "仓库", value: warehouse ? warehouse.name : "-" },
    { width: 170, label: "出库时间", value: rental.startAt || rental.createdAt },
  ], doc.y);

  // Group 2: 租赁人, 联系电话, 剧组/公司
  doc.y = drawKVGroup(doc, [
    { width: 130, label: "租赁人", value: customer.name },
    { width: 130, label: "联系电话", value: customer.phone },
    { width: 170, label: "剧组/公司", value: customer.company },
  ], doc.y);

  // Group 3: 租期, 时长
  doc.y = drawKVGroup(doc, [
    { width: 260, label: "租期", value: `${rental.startAt || "-"} 至 ${rental.expectedReturnAt || "-"}` },
    { width: 170, label: "时长", value: `${rental.durationHours || 0} 小时 / ${rental.rentalDays || 0} 天` },
  ], doc.y);

  // 设备清单（重置 doc.x 以确保居中生效）
  doc.moveDown(0.5);
  doc.x = MARGIN;
  useChineseFont(doc).fontSize(13).fillColor("#111111").text("设备清单", { align: "center", width: PAGE_W - MARGIN * 2 });
  doc.moveDown(0.5);
  const headers = ["编号", "设备", "品牌型号", "日租金", "状态"];
  const widths = [82, 132, 150, 70, 70];
  const deviceRows = (rental.devices || []).map((device) => ([
    device.deviceNo,
    device.name,
    `${device.brand || ""} ${device.model || ""}`,
    `￥${money(device.dailyRent)}`,
    device.status === "returned" ? "已归还" : "借出",
  ]));
  drawTable(doc, { headers, rows: deviceRows, widths, y: doc.y, rowHeight: 30, fontSize: 8.5 });

  // 费用（重置 doc.x）
  doc.moveDown(0.5);
  doc.x = MARGIN;
  useChineseFont(doc).fontSize(13).fillColor("#111111").text("费用", { align: "center", width: PAGE_W - MARGIN * 2 });
  doc.moveDown(0.5);
  drawTable(doc, {
    headers: ["租金", "押金", "已收", "未收"],
    rows: [[
      `￥${money(rental.rentAmount)}`,
      `￥${money(rental.depositAmount)}`,
      `￥${money(rental.paidAmount)}`,
      `￥${money(unpaidAmount)}`,
    ]],
    widths: [100, 100, 100, 100],
    y: doc.y,
    rowHeight: 28,
    fontSize: 9,
  });

  // 备注
  doc.moveDown(0.6);
  const remarkY = doc.y;
  drawKeyValue(doc, "备注", rental.remark || "-", 42, remarkY, 500);
  doc.y = remarkY + 32;

  // 经办人
  const operatorY = doc.y;
  drawKeyValue(doc, "经办人", options.operatorName || rental.operatorName || "-", 42, operatorY, 160);
  doc.y = operatorY + 30;

  // 合同条款（选填）
  if (options.contractTerms) {
    doc.moveDown(0.5);
    useChineseFont(doc).fontSize(10).fillColor("#666666").text("合同条款", 42, doc.y);
    doc.moveDown(0.3);
    useChineseFont(doc).fontSize(9).fillColor("#555555")
      .text(options.contractTerms, 42, doc.y, { width: PAGE_W - MARGIN * 2, lineGap: 3 });
    doc.y += 12;
  }

  // 签字区
  const signY = doc.y;
  useChineseFont(doc).fontSize(11).fillColor("#111111").text("租赁人签字：__________________", 42, signY);
  useChineseFont(doc).text("经办人签字：__________________", 312, signY);
  return finishPdf(doc, chunks);
}

async function getBootstrap() {
  const warehouse = await ensureDefaultWarehouse();
  return {
    currentWarehouse: warehouse,
    warehouses: await getWarehouses(),
  };
}

function _buildStats(devices, rentals) {
  const activeRentals = rentals.filter((item) => item.status === "rented" || item.status === "partReturned");
  const month = formatDate(new Date()).slice(0, 7);
  const monthRentals = rentals.filter((item) => (item.createdAt || "").slice(0, 7) === month);
  const totalIncome = rentals.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  const monthIncome = monthRentals.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  const overdueCount = rentals.filter((item) => item.displayStatus === "overdue").length;
  const customerMap = {};
  rentals.forEach((rental) => {
    const snap = rental.customerSnapshot || {};
    const id = rental.customerId || snap.phone || "unknown";
    if (!customerMap[id]) {
      customerMap[id] = { _id: id, name: snap.name || "未知客户", phone: snap.phone || "", company: snap.company || "", rentalCount: 0, totalAmount: 0 };
    }
    customerMap[id].rentalCount += 1;
    customerMap[id].totalAmount += Number(rental.totalAmount || 0);
  });
  const hotCustomers = Object.values(customerMap).sort((a, b) => Number(b.rentalCount || 0) - Number(a.rentalCount || 0)).slice(0, 5);
  const today = formatDate(new Date());
  // 单次遍历统计设备状态
  let availableCount = 0, reservedCount = 0, rentedCount = 0, repairingCount = 0;
  devices.forEach((item) => {
    switch (item.displayStatus) {
      case "available": availableCount++; break;
      case "reserved": reservedCount++; break;
      case "rented": case "overdue": rentedCount++; break;
      case "repairing": repairingCount++; break;
    }
  });
  return {
    deviceCount: devices.length,
    availableCount,
    reservedCount,
    rentedCount,
    repairingCount,
    overdueCount,
    dueTodayCount: activeRentals.filter((item) => (item.expectedReturnAt || "").slice(0, 10) === today).length,
    monthRentalCount: monthRentals.length,
    monthIncome,
    totalIncome,
    customerCount: Object.keys(customerMap).length,
    hotDevices: [...devices].sort((a, b) => Number(b.rentalCount || 0) - Number(a.rentalCount || 0)).slice(0, 5),
    hotCustomers,
  };
}

async function getDashboard() {
  const warehouse = await ensureDefaultWarehouse();
  const warehouseId = warehouse._id;
  const [devicesRaw, rentalsRaw, warehouses, logsRaw] = await Promise.all([
    getAll(COLLECTIONS.devices),
    getAll(COLLECTIONS.rentals),
    getAll(COLLECTIONS.warehouses),
    getAll(COLLECTIONS.logs),
  ]);
  const devices = devicesRaw.filter((item) => !item.isDeleted && item.warehouseId === warehouseId).map(withDeviceStatus);
  const rentals = rentalsRaw.filter((item) => item.warehouseId === warehouseId).map(withRentalStatus);
  const stats = _buildStats(devices, rentals);
  // 进行中的租赁（Top 3）
  const statuses = ["rented", "partReturned", "overdue"];
  const dueRentals = rentals
    .filter((item) => statuses.includes(item.status) || statuses.includes(item.displayStatus))
    .sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`))
    .slice(0, 3);
  // 最近日志（Top 80）
  const logs = logsRaw
    .filter((item) => item.warehouseId === warehouseId)
    .sort((a, b) => `${b.occurredAt}`.localeCompare(`${a.occurredAt}`))
    .slice(0, 80);
  return {
    currentWarehouse: warehouse,
    currentWarehouseName: warehouse.name || "默认仓库",
    warehouses: warehouses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || `${b.createdAt}`.localeCompare(`${a.createdAt}`)),
    stats,
    dueRentals,
    logs,
  };
}

async function getWarehouses() {
  await ensureDefaultWarehouse();
  const rows = await getAll(COLLECTIONS.warehouses);
  return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || `${b.createdAt}`.localeCompare(`${a.createdAt}`));
}

async function upsertWarehouse(payload) {
  const form = payload.form || {};
  const at = now();
  const id = form._id || uid("wh");
  const warehouse = {
    _id: id,
    name: form.name || "未命名仓库",
    city: form.city || "",
    address: form.address || "",
    manager: form.manager || "",
    phone: form.phone || "",
    remark: form.remark || "",
    isDefault: !!form.isDefault,
    createdAt: form.createdAt || at,
    updatedAt: at,
  };
  if (warehouse.isDefault) {
    const rows = await getAll(COLLECTIONS.warehouses);
    await Promise.all(rows.filter((item) => item._id !== id && item.isDefault).map((item) => (
      db.collection(COLLECTIONS.warehouses).doc(item._id).update({ data: { isDefault: false, updatedAt: at } })
    )));
  }
  const exists = await getById(COLLECTIONS.warehouses, id);
  if (exists) {
    await db.collection(COLLECTIONS.warehouses).doc(id).update({ data: stripId(warehouse) });
  } else {
    await db.collection(COLLECTIONS.warehouses).add({ data: warehouse });
  }
  return warehouse;
}

async function deleteWarehouse(payload) {
  const id = payload.id;
  const warehouse = await getById(COLLECTIONS.warehouses, id);
  if (!warehouse) throw new Error("仓库不存在");
  if (warehouse.isDefault) throw new Error("不能删除默认仓库，请先设置其他仓库为默认");
  const devices = await getAll(COLLECTIONS.devices);
  const deviceCount = devices.filter((item) => item.warehouseId === id && !item.isDeleted).length;
  if (deviceCount > 0) throw new Error(`该仓库下仍有 ${deviceCount} 台设备，请先转移或删除设备`);
  await db.collection(COLLECTIONS.warehouses).doc(id).remove();
  return { deleted: true };
}

async function getDevices(payload = {}) {
  const warehouse = payload.warehouseId ? null : await ensureDefaultWarehouse();
  const warehouseId = payload.warehouseId || warehouse._id;
  const devices = await getAll(COLLECTIONS.devices);
  return devices.filter((item) => !item.isDeleted && item.warehouseId === warehouseId).map(withDeviceStatus);
}

async function getDevice(payload) {
  const id = payload.id;
  if (!id) return null;
  // 优先按 _id 直接读取（单条 doc 查询，极低成本）
  try {
    const result = await db.collection(COLLECTIONS.devices).doc(id).get();
    const doc = result.data;
    if (doc && !doc.isDeleted) return withDeviceStatus(doc);
  } catch (_) {
    // _id 查不到时回退全量扫描（支持 deviceNo / qrCode）
  }
  const rows = await getAll(COLLECTIONS.devices);
  const device = rows.find((item) => item.deviceNo === id || item.qrCode === id);
  return device ? withDeviceStatus(device) : null;
}

async function getCustomers() {
  return await getAll(COLLECTIONS.customers);
}

async function getRentals(payload = {}) {
  const warehouse = payload.warehouseId ? null : await ensureDefaultWarehouse();
  const warehouseId = payload.warehouseId || warehouse._id;
  const rentals = await getAll(COLLECTIONS.rentals);
  const statuses = (payload.status || "").split(",").filter(Boolean);
  let result = rentals
    .filter((item) => item.warehouseId === warehouseId)
    .map(withRentalStatus);
  if (payload.customerId) {
    result = result.filter((item) => item.customerId === payload.customerId);
  }
  if (statuses.length) {
    result = result.filter((item) => statuses.includes(item.status) || statuses.includes(item.displayStatus));
  }
  result.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`) || `${b._id}`.localeCompare(`${a._id}`));
  if (payload.limit > 0) result = result.slice(0, Number(payload.limit));
  return result;
}

async function getRental(payload) {
  const rental = await getById(COLLECTIONS.rentals, payload.id);
  return rental ? withRentalStatus(rental) : null;
}

async function getLogs(payload = {}) {
  const logs = await getAll(COLLECTIONS.logs);
  let result = logs;
  if (payload.allWarehouses) {
    // 不按仓库过滤（设备详情跨仓库查日志）
  } else if (payload.warehouseId) {
    result = result.filter((item) => item.warehouseId === payload.warehouseId);
  } else {
    const warehouse = await ensureDefaultWarehouse();
    result = result.filter((item) => item.warehouseId === warehouse._id);
  }
  if (payload.deviceId) {
    // 精准查询关联该设备的所有租赁单 ID（避免全量读取）
    const linkedRentalIds = new Set();
    try {
      const related = await db.collection(COLLECTIONS.rentals).where({ "devices.deviceId": payload.deviceId }).get();
      related.data.forEach((r) => linkedRentalIds.add(r._id));
    } catch (_) { /* .where 查询不支持时回退 */ }
    if (!linkedRentalIds.size) {
      // where 查询不支持时的回退方案
      const allRentals = await getAll(COLLECTIONS.rentals);
      allRentals.forEach((r) => {
        if (r.devices && r.devices.some((d) => d.deviceId === payload.deviceId || (payload.deviceNo && d.deviceNo === payload.deviceNo))) {
          linkedRentalIds.add(r._id);
        }
      });
    }
    result = result.filter((item) =>
      item.deviceId === payload.deviceId ||
      item.deviceNo === payload.deviceId ||
      (payload.deviceNo && item.deviceNo === payload.deviceNo) ||
      (payload.deviceNo && item.deviceNos && item.deviceNos.includes(payload.deviceNo)) ||
      (item.deviceIds && item.deviceIds.includes(payload.deviceId)) ||
      (item.rentalId && linkedRentalIds.has(item.rentalId))
    );
  }
  result.sort((a, b) => `${b.occurredAt}`.localeCompare(`${a.occurredAt}`));
  if (payload.limit > 0) result = result.slice(0, Number(payload.limit));
  return result;
}

async function upsertDevice(payload) {
  const form = payload.form || {};
  const defaultWarehouse = await ensureDefaultWarehouse();
  const warehouseId = form.warehouseId || payload.warehouseId || defaultWarehouse._id;
  const at = now();
  const id = form._id || uid("dev");
  const current = form._id ? await getById(COLLECTIONS.devices, form._id) : null;
  if (current && current.status !== "available" && current.status !== "repairing" && current.status !== "disabled" && current.warehouseId !== warehouseId) {
    throw new Error("已预约或已借出的设备不能修改所属仓库");
  }
  // 检查设备编号是否重复
  const allDevices = await getAll(COLLECTIONS.devices);
  const dup = allDevices.find((item) => item.deviceNo === form.deviceNo && item._id !== (current ? current._id : "") && !item.isDeleted);
  if (dup) throw new Error(`设备编号 ${form.deviceNo} 已被「${dup.name}」使用`);
  const device = {
    _id: id,
    warehouseId,
    deviceNo: form.deviceNo,
    qrCode: form.qrCode || form.deviceNo,
    name: form.name,
    category: form.category || "其他",
    brand: form.brand || "",
    model: form.model || "",
    serialNo: form.serialNo || "",
    status: form.status || "available",
    location: form.location || "",
    purchaseDate: form.purchaseDate || "",
    purchasePrice: Number(form.purchasePrice || 0),
    dailyRent: Number(form.dailyRent || 0),
    weeklyRent: Number(form.weeklyRent || 0),
    monthlyRent: Number(form.monthlyRent || 0),
    depositAmount: Number(form.depositAmount || 0),
    accessoriesText: form.accessoriesText || "",
    rentalCount: Number(form.rentalCount || 0),
    totalRentalDays: Number(form.totalRentalDays || 0),
    totalIncome: Number(form.totalIncome || 0),
    currentRentalId: form.currentRentalId || "",
    currentCustomerId: form.currentCustomerId || "",
    expectedReturnAt: form.expectedReturnAt || "",
    lastRentedAt: form.lastRentedAt || "",
    lastReturnedAt: form.lastReturnedAt || "",
    remark: form.remark || "",
    isDeleted: false,
    createdAt: form.createdAt || at,
    updatedAt: at,
  };
  const exists = await getById(COLLECTIONS.devices, id);
  if (exists) {
    await db.collection(COLLECTIONS.devices).doc(id).update({ data: stripId(device) });
    await addLog({ warehouseId, type: "device_update", deviceId: id, deviceNo: device.deviceNo, title: "编辑设备", content: `${device.deviceNo} ${device.name}` });
  } else {
    await db.collection(COLLECTIONS.devices).add({ data: device });
    await addLog({ warehouseId, type: "device_create", deviceId: id, deviceNo: device.deviceNo, title: "新增设备", content: `${device.deviceNo} ${device.name}` });
  }
  return withDeviceStatus(device);
}

async function setDeviceStatus(payload) {
  const device = await getById(COLLECTIONS.devices, payload.id);
  if (!device) return null;
  const status = payload.status;
  const beforeStatus = device.status;
  const clearOccupied = status === "available" || status === "repairing" || status === "disabled";
  const next = {
    status,
    currentRentalId: clearOccupied ? "" : device.currentRentalId,
    currentCustomerId: clearOccupied ? "" : device.currentCustomerId,
    expectedReturnAt: clearOccupied ? "" : device.expectedReturnAt,
    updatedAt: now(),
  };
  await db.collection(COLLECTIONS.devices).doc(device._id).update({ data: next });
  const typeMap = { repairing: "repair_start", available: "repair_end", disabled: "disable", };
  const titleMap = { repairing: "设为维修", available: "恢复可租", disabled: "停用设备", };
  await addLog({
    warehouseId: device.warehouseId,
    type: typeMap[status] || "status_change",
    deviceId: device._id,
    deviceNo: device.deviceNo,
    beforeStatus,
    afterStatus: status,
    title: titleMap[status] || "状态变更",
    content: `${device.deviceNo} ${STATUS_TEXT[beforeStatus]} -> ${STATUS_TEXT[status]}`,
    remark: payload.remark || "",
  });
  return withDeviceStatus({ ...device, ...next });
}

async function findOrCreateCustomer(form) {
  const phone = (form.phone || "").trim();
  const existingResult = phone ? await db.collection(COLLECTIONS.customers).where({ phone }).limit(1).get() : { data: [] };
  const at = now();
  if (existingResult.data && existingResult.data.length) {
    const customer = existingResult.data[0];
    const next = {
      name: form.name || customer.name,
      company: form.company || customer.company || "",
      wechat: form.wechat || customer.wechat || "",
      idCard: form.idCard || customer.idCard || "",
      address: form.address || customer.address || "",
      remark: form.customerRemark || customer.remark || "",
      updatedAt: at,
    };
    await db.collection(COLLECTIONS.customers).doc(customer._id).update({ data: next });
    return { ...customer, ...next };
  }
  const customer = {
    _id: uid("cus"),
    name: form.name,
    phone,
    company: form.company || "",
    wechat: form.wechat || "",
    idCard: form.idCard || "",
    address: form.address || "",
    remark: form.customerRemark || "",
    rentalCount: 0,
    totalAmount: 0,
    currentRentalCount: 0,
    createdAt: at,
    updatedAt: at,
  };
  await db.collection(COLLECTIONS.customers).add({ data: customer });
  return customer;
}

async function createRental(payload) {
  const defaultWarehouse = await ensureDefaultWarehouse();
  const warehouseId = payload.warehouseId || defaultWarehouse._id;
  const customer = await findOrCreateCustomer(payload.customer || {});
  const selectedIds = payload.deviceIds || [];
  const devices = await getDevices({ warehouseId });
  const selected = devices.filter((item) => selectedIds.includes(item._id));
  const invalid = selected.find((item) => item.status !== "available");
  if (invalid) throw new Error(`${invalid.deviceNo} 当前不是可租状态`);
  if (selected.length !== selectedIds.length) throw new Error("只能选择当前仓库内的可租设备");

  const status = payload.status || "rented";
  const at = now();
  const duration = calculateDuration(payload.startAt, payload.expectedReturnAt);
  const rentAmount = selected.reduce((sum, item) => sum + Number(item.dailyRent || 0) * duration.rentalDays, 0);
  const depositAmount = selected.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0);
  const paidAmount = Number(payload.paidAmount || 0);
  const rental = {
    _id: uid("rent"),
    warehouseId,
    rentalNo: (() => { const d = new Date(Date.now() + 288e5); return `R_${pad(d.getUTCFullYear())}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}_${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`; })(),
    customerId: customer._id,
    customerSnapshot: {
      name: customer.name,
      phone: customer.phone,
      company: customer.company,
      wechat: customer.wechat,
    },
    devices: selected.map((device) => ({
      deviceId: device._id,
      deviceNo: device.deviceNo,
      name: device.name,
      brand: device.brand,
      model: device.model,
      dailyRent: Number(device.dailyRent || 0),
      depositAmount: Number(device.depositAmount || 0),
      status,
      returnedAt: "",
      returnStatus: "",
    })),
    status,
    startAt: payload.startAt,
    expectedReturnAt: payload.expectedReturnAt,
    actualReturnAt: "",
    durationHours: duration.durationHours,
    rentalDays: duration.rentalDays,
    rentAmount,
    depositAmount,
    damageFee: 0,
    discountAmount: Number(payload.discountAmount || 0),
    totalAmount: rentAmount - Number(payload.discountAmount || 0),
    paidAmount,
    unpaidAmount: Math.max(rentAmount - Number(payload.discountAmount || 0) - paidAmount, 0),
    paymentStatus: rentAmount <= 0 ? "paid" : paidAmount >= rentAmount ? "paid" : paidAmount > 0 ? "partial" : "unpaid",
    depositStatus: payload.depositStatus || "notReceived",
    remark: payload.remark || "",
    attachments: [],
    createdAt: at,
    updatedAt: at,
  };
  await db.collection(COLLECTIONS.rentals).add({ data: rental });
  await Promise.all(selected.map((device) => db.collection(COLLECTIONS.devices).doc(device._id).update({
    data: {
      status,
      currentRentalId: rental._id,
      currentCustomerId: customer._id,
      expectedReturnAt: payload.expectedReturnAt,
      lastRentedAt: status === "rented" ? at : device.lastRentedAt,
      rentalCount: Number(device.rentalCount || 0) + (status === "rented" ? 1 : 0),
      totalIncome: Number(device.totalIncome || 0) + (status === "rented" ? Number(device.dailyRent || 0) * duration.rentalDays : 0),
      updatedAt: at,
    },
  })));
  await db.collection(COLLECTIONS.customers).doc(customer._id).update({
    data: {
      rentalCount: Number(customer.rentalCount || 0) + (status === "rented" ? 1 : 0),
      currentRentalCount: Number(customer.currentRentalCount || 0) + 1,
      totalAmount: Number(customer.totalAmount || 0) + (status === "rented" ? Number(rental.totalAmount || 0) : 0),
      updatedAt: at,
    },
  });
  await addLog({
    warehouseId,
    type: status === "reserved" ? "reserve" : "rent_out",
    rentalId: rental._id,
    customerId: customer._id,
    customerName: customer.name,
    deviceIds: selected.map((item) => item._id),
    deviceNos: selected.map((item) => item.deviceNo),
    title: status === "reserved" ? "新增预约" : "设备借出",
    content: `${customer.name} ${status === "reserved" ? "预约" : "借出"} ${selected.length} 台设备`,
    amount: rental.totalAmount,
  });
  return withRentalStatus(rental);
}

async function confirmRental(payload) {
  const rental = await getById(COLLECTIONS.rentals, payload.rentalId);
  if (!rental || rental.status !== "reserved") return rental ? withRentalStatus(rental) : null;
  const at = now();
  await db.collection(COLLECTIONS.rentals).doc(rental._id).update({
    data: {
      status: "rented",
      devices: rental.devices.map((item) => ({ ...item, status: "rented" })),
      updatedAt: at,
    },
  });
  await Promise.all(rental.devices.map(async (item) => {
    const device = await getById(COLLECTIONS.devices, item.deviceId);
    if (!device) return;
    await db.collection(COLLECTIONS.devices).doc(device._id).update({
      data: {
        status: "rented",
        lastRentedAt: at,
        rentalCount: Number(device.rentalCount || 0) + 1,
        totalIncome: Number(device.totalIncome || 0) + Number(device.dailyRent || 0) * Number(rental.rentalDays || 1),
        updatedAt: at,
      },
    });
  }));
  const customer = await getById(COLLECTIONS.customers, rental.customerId);
  if (customer) {
    await db.collection(COLLECTIONS.customers).doc(customer._id).update({
      data: {
        rentalCount: Number(customer.rentalCount || 0) + 1,
        totalAmount: Number(customer.totalAmount || 0) + Number(rental.totalAmount || 0),
        updatedAt: at,
      },
    });
  }
  await addLog({
    warehouseId: rental.warehouseId,
    type: "rent_out",
    rentalId: rental._id,
    customerId: rental.customerId,
    customerName: rental.customerSnapshot.name,
    deviceIds: rental.devices.map((item) => item.deviceId),
    deviceNos: rental.devices.map((item) => item.deviceNo),
    title: "预约转借出",
    content: `${rental.customerSnapshot.name} 借出 ${rental.devices.length} 台设备`,
    amount: rental.totalAmount,
  });
  return await getRental({ id: rental._id });
}

async function cancelRental(payload) {
  const rental = await getById(COLLECTIONS.rentals, payload.rentalId);
  if (!rental) throw new Error("租赁单不存在");
  if (rental.status !== "reserved" && rental.status !== "rented") {
    throw new Error("当前状态不可取消");
  }
  const at = now();
  // 更新租赁单状态
  const cancelledDevices = rental.devices.map((item) => ({
    ...item,
    status: item.returnedAt ? item.status : "available",
  }));
  await db.collection(COLLECTIONS.rentals).doc(rental._id).update({
    data: {
      status: "cancelled",
      devices: cancelledDevices,
      updatedAt: at,
    },
  });
  // 重置未归还设备的占用状态
  const unreturned = rental.devices.filter((item) => !item.returnedAt);
  await Promise.all(unreturned.map(async (item) => {
    const device = await getById(COLLECTIONS.devices, item.deviceId);
    if (!device) return;
    await db.collection(COLLECTIONS.devices).doc(device._id).update({
      data: {
        status: "available",
        currentRentalId: "",
        currentCustomerId: "",
        expectedReturnAt: "",
        updatedAt: at,
      },
    });
  }));
  // 更新客户统计
  const customer = await getById(COLLECTIONS.customers, rental.customerId);
  if (customer) {
    await db.collection(COLLECTIONS.customers).doc(customer._id).update({
      data: {
        currentRentalCount: Math.max(Number(customer.currentRentalCount || 0) - 1, 0),
        updatedAt: at,
      },
    });
  }
  await addLog({
    warehouseId: rental.warehouseId,
    type: "cancel",
    rentalId: rental._id,
    customerId: rental.customerId,
    customerName: rental.customerSnapshot.name,
    deviceIds: rental.devices.map((item) => item.deviceId),
    deviceNos: rental.devices.map((item) => item.deviceNo),
    title: rental.status === "reserved" ? "取消预约" : "取消租赁",
    content: `取消 ${rental.customerSnapshot.name} 的${rental.status === "reserved" ? "预约" : "租赁"}单，释放 ${unreturned.length} 台设备`,
  });
  return await getRental({ id: rental._id });
}

async function updateRentalPayment(payload) {
  const rental = await getById(COLLECTIONS.rentals, payload.rentalId);
  if (!rental) throw new Error("租赁单不存在");
  if (rental.status === "cancelled") throw new Error("已取消的租赁单不能更新");
  const at = now();
  const updateData = { updatedAt: at };

  // 追加收款
  if (payload.addPaidAmount !== undefined && payload.addPaidAmount !== null) {
    const addAmount = Number(payload.addPaidAmount || 0);
    if (addAmount < 0) throw new Error("追加金额不能为负数");
    const paidAmount = Number(rental.paidAmount || 0) + addAmount;
    const totalAmount = Number(rental.totalAmount || 0);
    updateData.paidAmount = paidAmount;
    updateData.unpaidAmount = Math.max(totalAmount - paidAmount, 0);
    if (totalAmount === 0) {
      updateData.paymentStatus = "paid";
    } else if (paidAmount >= totalAmount) {
      updateData.paymentStatus = "paid";
    } else if (paidAmount > 0) {
      updateData.paymentStatus = "partial";
    } else {
      updateData.paymentStatus = "unpaid";
    }
  }

  // 更新押金状态
  if (payload.depositStatus) {
    updateData.depositStatus = payload.depositStatus;
    // 信用免押时清零押金金额
    if (payload.depositStatus === "credited") {
      updateData.depositAmount = 0;
    }
  }

  await db.collection(COLLECTIONS.rentals).doc(rental._id).update({ data: updateData });

  const logParts = [];
  if (updateData.paidAmount !== undefined) logParts.push(`追加收款 ¥${Number(payload.addPaidAmount || 0)}，已收 ¥${updateData.paidAmount}`);
  if (updateData.depositStatus) logParts.push(`押金状态 → ${DEPOSIT_TEXT[updateData.depositStatus]}`);
  await addLog({
    warehouseId: rental.warehouseId,
    type: "payment",
    rentalId: rental._id,
    customerId: rental.customerId,
    customerName: rental.customerSnapshot.name,
    deviceIds: rental.devices.map((item) => item.deviceId),
    deviceNos: rental.devices.map((item) => item.deviceNo),
    title: "更新付款/押金",
    content: logParts.join("；") || "更新",
    remark: payload.remark || "",
  });

  return await getRental({ id: rental._id });
}

async function returnRentalDevices(payload) {
  const rental = await getById(COLLECTIONS.rentals, payload.rentalId);
  if (!rental) return null;
  const at = now();
  const returning = payload.deviceIds || [];
  const options = payload.options || {};
  const damagedIds = options.damagedIds || [];
  const damageFee = Number(options.damageFee || 0);
  const nextRentalDevices = rental.devices.map((item) => {
    if (!returning.includes(item.deviceId) || item.returnedAt) return item;
    return {
      ...item,
      status: damagedIds.includes(item.deviceId) ? "repairing" : "returned",
      returnedAt: at,
      returnStatus: damagedIds.includes(item.deviceId) ? "damaged" : "normal",
    };
  });
  const allReturned = nextRentalDevices.every((item) => item.returnedAt);
  const anyReturned = nextRentalDevices.some((item) => item.returnedAt);
  const nextStatus = allReturned ? "returned" : anyReturned ? "partReturned" : rental.status;
  await db.collection(COLLECTIONS.rentals).doc(rental._id).update({
    data: {
      devices: nextRentalDevices,
      status: nextStatus,
      actualReturnAt: allReturned ? at : rental.actualReturnAt,
      damageFee: Number(rental.damageFee || 0) + damageFee,
      totalAmount: Number(rental.totalAmount || 0) + damageFee,
      unpaidAmount: Math.max(Number(rental.unpaidAmount || 0) + damageFee, 0),
      updatedAt: at,
    },
  });
  await Promise.all(returning.map(async (deviceId) => {
    const device = await getById(COLLECTIONS.devices, deviceId);
    if (!device) return;
    const isDamaged = damagedIds.includes(deviceId);
    await db.collection(COLLECTIONS.devices).doc(deviceId).update({
      data: {
        status: isDamaged ? "repairing" : "available",
        currentRentalId: "",
        currentCustomerId: "",
        expectedReturnAt: "",
        lastReturnedAt: at,
        totalRentalDays: Number(device.totalRentalDays || 0) + Number(rental.rentalDays || 1),
        updatedAt: at,
      },
    });
  }));
  if (allReturned) {
    const customer = await getById(COLLECTIONS.customers, rental.customerId);
    if (customer) {
      await db.collection(COLLECTIONS.customers).doc(customer._id).update({
        data: {
          currentRentalCount: Math.max(Number(customer.currentRentalCount || 0) - 1, 0),
          updatedAt: at,
        },
      });
    }
  }
  await addLog({
    warehouseId: rental.warehouseId,
    type: allReturned ? "return" : "partial_return",
    rentalId: rental._id,
    customerId: rental.customerId,
    customerName: rental.customerSnapshot.name,
    deviceIds: rental.devices.map((item) => item.deviceId),
    deviceNos: rental.devices.map((item) => item.deviceNo),
    title: allReturned ? "整单归还" : "部分归还",
    content: `${rental.customerSnapshot.name} 归还 ${returning.length} 台设备`,
    amount: damageFee,
    remark: options.remark || "",
  });
  return await getRental({ id: rental._id });
}

async function getStats(payload = {}) {
  const warehouse = payload.warehouseId ? null : await ensureDefaultWarehouse();
  const warehouseId = payload.warehouseId || warehouse._id;
  const devices = await getDevices({ warehouseId });
  const rentals = await getRentals({ warehouseId });
  return _buildStats(devices, rentals);
}

async function getScheduleRows(payload = {}) {
  const warehouse = payload.warehouseId ? null : await ensureDefaultWarehouse();
  const warehouseId = payload.warehouseId || warehouse._id;
  const days = buildDays(Number(payload.days || 7), payload.startDate);
  const devices = (await getDevices({ warehouseId })).filter((device) => !payload.deviceId || device._id === payload.deviceId);
  const rentals = (await getRentals({ warehouseId })).filter((rental) => {
    if (payload.includeReturned) return rental.status !== "cancelled";
    return rental.status !== "returned" && rental.status !== "cancelled";
  });
  const statusFilter = payload.status || "all";
  const keyword = (payload.keyword || "").trim().toLowerCase();
  const category = payload.category || "all";
  return devices
    .filter((device) => {
      const text = `${device.deviceNo} ${device.name} ${device.brand} ${device.model} ${device.category}`.toLowerCase();
      return (!keyword || text.includes(keyword)) && (category === "all" || device.category === category);
    })
    .map((device) => {
      const cells = days.map((day) => {
        let cell = {
          key: day.key,
          day: day.day,
          week: day.week,
          status: "free",
          statusText: "空",
          label: "",
          displayText: "空",
          rentalId: "",
          rentalNo: "",
          customerName: "",
          className: "cell-free",
          clickable: false,
        };
        const matchedRental = rentals.find((rental) => {
          const deviceLine = rental.devices.find((item) => item.deviceId === device._id);
          if (!deviceLine || deviceLine.returnedAt) return false;
          return isDateBetween(day.key, rental.startAt, rental.expectedReturnAt);
        });
        if (matchedRental) {
          const displayStatus = matchedRental.displayStatus || matchedRental.status;
          cell = {
            ...cell,
            status: displayStatus,
            statusText: STATUS_TEXT[displayStatus] || displayStatus,
            label: matchedRental.customerSnapshot.name,
            displayText: matchedRental.customerSnapshot.name,
            rentalId: matchedRental._id,
            rentalNo: matchedRental.rentalNo,
            customerName: matchedRental.customerSnapshot.name,
            className: `cell-${displayStatus}`,
            clickable: true,
          };
        } else if (device.displayStatus === "repairing") {
          cell = { ...cell, status: "repairing", statusText: "维修", label: "维修", displayText: "维修", className: "cell-repairing" };
        }
        if (statusFilter !== "all" && cell.status !== statusFilter) return { ...cell, dimmed: true };
        return cell;
      });
      return {
        deviceId: device._id,
        deviceNo: device.deviceNo,
        name: device.name,
        model: device.model,
        category: device.category,
        statusText: device.statusText,
        displayStatus: device.displayStatus,
        busyCount: cells.filter((cell) => cell.status !== "free" && !cell.dimmed).length,
        cells,
      };
    });
}

async function ensureSeedData() {
  const warehouse = await ensureDefaultWarehouse();
  const devices = await getDevices({ warehouseId: warehouse._id });
  if (devices.length) return { seeded: false, warehouse };
  const seedDevices = [
    { deviceNo: "CAM-A7S3-001", name: "Sony A7S III", category: "摄影机", brand: "Sony", model: "A7S III", serialNo: "SN-A7S3-001", status: "available", location: "A区-摄影机柜", purchaseDate: "2025-08-01", purchasePrice: 23000, dailyRent: 300, weeklyRent: 1800, monthlyRent: 6000, depositAmount: 5000, accessoriesText: "电池 x2，充电器 x1，机身盖 x1", remark: "主力机身" },
    { deviceNo: "LEN-GM24-001", name: "Sony FE 24-70mm F2.8 GM", category: "镜头", brand: "Sony", model: "FE 24-70mm F2.8 GM", serialNo: "SN-GM24-001", status: "available", location: "B区-镜头柜", purchaseDate: "2025-09-12", purchasePrice: 13500, dailyRent: 180, weeklyRent: 1000, monthlyRent: 3600, depositAmount: 3000, accessoriesText: "前后盖，遮光罩，保护镜" },
    { deviceNo: "LGT-600D-001", name: "Aputure LS 600d Pro", category: "灯光", brand: "Aputure", model: "LS 600d Pro", serialNo: "SN-600D-001", status: "available", location: "C区-灯光架", purchaseDate: "2025-11-20", purchasePrice: 9800, dailyRent: 220, weeklyRent: 1300, monthlyRent: 4600, depositAmount: 2500, accessoriesText: "控制盒，电源线，标准罩" },
  ];
  for (const form of seedDevices) {
    await upsertDevice({ form: { ...form, warehouseId: warehouse._id } });
  }
  return { seeded: true, warehouse };
}

async function upsertRaw(name, record, warehouseId) {
  if (!record || !record._id) return false;
  const next = { ...record };
  if ([COLLECTIONS.devices, COLLECTIONS.rentals, COLLECTIONS.logs].includes(name) && !next.warehouseId) {
    next.warehouseId = warehouseId;
  }
  const exists = await getById(name, next._id);
  if (exists) {
    await db.collection(name).doc(next._id).update({ data: stripId(next) });
  } else {
    await db.collection(name).add({ data: next });
  }
  return true;
}

async function importLocalData(payload) {
  const warehouse = await ensureDefaultWarehouse();
  const devices = payload.devices || [];
  const customers = payload.customers || [];
  const rentals = payload.rentals || [];
  const logs = payload.logs || [];
  let count = 0;
  for (const item of devices) if (await upsertRaw(COLLECTIONS.devices, item, warehouse._id)) count += 1;
  for (const item of customers) if (await upsertRaw(COLLECTIONS.customers, item, warehouse._id)) count += 1;
  for (const item of rentals) if (await upsertRaw(COLLECTIONS.rentals, item, warehouse._id)) count += 1;
  for (const item of logs) if (await upsertRaw(COLLECTIONS.logs, item, warehouse._id)) count += 1;
  return { imported: count, warehouse };
}

async function collectHistoryRentals(payload = {}) {
  const scope = payload.scope || "current_warehouse";
  const startDate = payload.startDate || "";
  const endDate = payload.endDate || "";
  const startKey = startDate ? `${startDate} 00:00` : "";
  const endKey = endDate ? `${endDate} 23:59` : "";
  const defaultWarehouse = await ensureDefaultWarehouse();
  const allRentals = (await getAll(COLLECTIONS.rentals)).map(withRentalStatus);
  let rentals = allRentals;
  if (scope === "device") {
    rentals = rentals.filter((rental) => (rental.devices || []).some((device) => device.deviceId === payload.deviceId));
  } else if (scope !== "all_warehouses") {
    const warehouseId = payload.warehouseId || defaultWarehouse._id;
    rentals = rentals.filter((rental) => rental.warehouseId === warehouseId);
  }
  if (startKey) {
    rentals = rentals.filter((rental) => `${rental.startAt || rental.createdAt || ""}` >= startKey);
  }
  if (endKey) {
    rentals = rentals.filter((rental) => `${rental.startAt || rental.createdAt || ""}` <= endKey);
  }
  // 按租赁状态筛选
  if (payload.status && payload.status !== "all") {
    rentals = rentals.filter((rental) => rental.status === payload.status || rental.displayStatus === payload.status);
  }
  // 按设备类别筛选
  if (payload.category && payload.category !== "all") {
    rentals = rentals.filter((rental) => (rental.devices || []).some((device) => (device.category || "其他") === payload.category));
  }
  // 按租赁人关键词筛选
  const custKey = (payload.customerKeyword || "").trim();
  if (custKey) {
    const kw = custKey.toLowerCase();
    rentals = rentals.filter((rental) => {
      const snap = rental.customerSnapshot || {};
      return `${snap.name || ""} ${snap.phone || ""} ${snap.company || ""}`.toLowerCase().includes(kw);
    });
  }
  return rentals.sort((a, b) => `${b.startAt || b.createdAt}`.localeCompare(`${a.startAt || a.createdAt}`));
}

function getScopeText(payload = {}, warehouses = []) {
  if (payload.scope === "all_warehouses") return "全部仓库";
  if (payload.scope === "device") return "单设备";
  const found = warehouses.find((item) => item._id === payload.warehouseId);
  return found ? found.name : "当前仓库";
}

async function exportHistory(payload = {}) {
  const format = payload.format === "csv" ? "csv" : "pdf";
  const warehouses = await getWarehouses();
  const rentals = await collectHistoryRentals(payload);
  const rows = buildHistoryRows(rentals, warehouses, payload.scope === "device" ? payload.deviceId : "");
  const scopeText = getScopeText(payload, warehouses);
  const baseName = `history-${formatDate(new Date()).replace(/-/g, "")}.${format}`;
  let content;
  let contentType;
  if (format === "csv") {
    content = buildHistoryCsv(rows);
    contentType = "text/csv";
  } else {
    const logoBuffer = await getLogoBuffer(payload.logoFileId);
    content = await buildHistoryPdf(rows, {
      includeHeader: !!payload.includeHeader,
      companyName: payload.companyName || "",
      contactPhone: payload.contactPhone || "",
      logoBuffer,
      startDate: payload.startDate,
      endDate: payload.endDate,
      scopeText,
    });
    contentType = "application/pdf";
  }
  const file = await uploadExportFile(baseName, content, contentType);
  await saveExportRecord({
    type: "history",
    format,
    scope: payload.scope || "current_warehouse",
    warehouseId: payload.scope === "all_warehouses" ? "" : (payload.warehouseId || ""),
    deviceId: payload.deviceId || "",
    fileId: file.fileID,
    fileName: baseName,
    dateRange: { startDate: payload.startDate || "", endDate: payload.endDate || "" },
    options: {
      includeHeader: !!payload.includeHeader,
      companyName: payload.companyName || "",
      contactPhone: payload.contactPhone || "",
      logoFileId: payload.logoFileId || "",
    },
  });
  return { ...file, fileName: baseName, format, rowCount: rows.length };
}

async function exportOutboundOrder(payload = {}) {
  const rental = await getRental({ id: payload.rentalId });
  if (!rental) throw new Error("租赁单不存在");
  const warehouses = await getWarehouses();
  const warehouse = warehouses.find((item) => item._id === rental.warehouseId) || null;
  const orderNo = rental.orderNo || rental.rentalNo || rental._id;
  const fileName = `outbound-${orderNo}.pdf`;
  const content = await buildOutboundPdf(rental, warehouse, {
    includeHeader: !!payload.includeHeader,
    companyName: payload.companyName || "",
    contactPhone: payload.contactPhone || "",
    logoFileId: payload.logoFileId || "",
    operatorName: payload.operatorName || "",
    contractTerms: payload.contractTerms || "",
  });
  const file = await uploadExportFile(fileName, content, "application/pdf");
  const printCount = Number(rental.outboundPrintCount || 0) + 1;
  await db.collection(COLLECTIONS.rentals).doc(rental._id).update({
    data: {
      orderNo,
      operatorName: payload.operatorName || rental.operatorName || "",
      outboundPrintedAt: now(),
      outboundPrintCount: printCount,
      updatedAt: now(),
    },
  });
  await saveExportRecord({
    type: "outbound_order",
    format: "pdf",
    scope: "rental",
    warehouseId: rental.warehouseId || "",
    rentalId: rental._id,
    fileId: file.fileID,
    fileName,
    options: {
      includeHeader: !!payload.includeHeader,
      companyName: payload.companyName || "",
      contactPhone: payload.contactPhone || "",
      logoFileId: payload.logoFileId || "",
      operatorName: payload.operatorName || "",
    },
  });
  return { ...file, fileName, format: "pdf", printCount };
}

async function generateDeviceQR(payload = {}) {
  const device = await getDevice({ id: payload.deviceId });
  if (!device) throw new Error("设备不存在");
  const text = device.deviceNo || device._id;
  const QRCode = require("qrcode");
  const pngBuffer = await QRCode.toBuffer(text, { width: 300, margin: 1, color: { dark: "#000", light: "#fff" } });
  const cloudPath = `exports/qr-${device._id}.png`;
  const upload = await cloud.uploadFile({ cloudPath, fileContent: pngBuffer });
  // 将生成的文件 ID 存回设备记录
  await db.collection(COLLECTIONS.devices).doc(device._id).update({
    data: { qrImageFileId: upload.fileID, updatedAt: now() },
  });
  const temp = await cloud.getTempFileURL({ fileList: [upload.fileID] });
  return {
    fileID: upload.fileID,
    tempFileURL: temp.fileList && temp.fileList[0] ? temp.fileList[0].tempFileURL : "",
  };
}

async function getDeviceQR(payload = {}) {
  const device = await getDevice({ id: payload.deviceId });
  if (!device) throw new Error("设备不存在");
  // 如果已有缓存的二维码图片，直接返回
  if (device.qrImageFileId) {
    const temp = await cloud.getTempFileURL({ fileList: [device.qrImageFileId] });
    return {
      fileID: device.qrImageFileId,
      tempFileURL: temp.fileList && temp.fileList[0] ? temp.fileList[0].tempFileURL : "",
    };
  }
  // 否则自动生成
  return generateDeviceQR(payload);
}

async function backupAllData() {
  const names = Object.values(COLLECTIONS);
  const result = {};
  for (const name of names) {
    result[name] = await getAll(name);
  }
  return result;
}

async function restoreAllData(payload = {}) {
  const jsonStr = payload.json || "{}";
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error("JSON 格式无效，请检查备份内容");
  }
  const names = Object.values(COLLECTIONS);
  let count = 0;
  for (const name of names) {
    const records = data[name];
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (await upsertRaw(name, record)) count++;
    }
  }
  return { imported: count };
}

async function getDefaultTerms() {
  const doc = await getById(COLLECTIONS.config, CONFIG_ID);
  return { contractTerms: doc ? doc.contractTerms || "" : "" };
}

async function setDefaultTerms(payload = {}) {
  const terms = payload.contractTerms || "";
  const exists = await getById(COLLECTIONS.config, CONFIG_ID);
  if (exists) {
    await db.collection(COLLECTIONS.config).doc(CONFIG_ID).update({ data: { contractTerms: terms } });
  } else {
    await db.collection(COLLECTIONS.config).add({ data: { _id: CONFIG_ID, contractTerms: terms } });
  }
  return { saved: true };
}

const actions = {
  getBootstrap,
  getDashboard,
  getWarehouses,
  upsertWarehouse,
  deleteWarehouse,
  ensureSeedData,
  importLocalData,
  backupAllData,
  restoreAllData,
  getDevices,
  getDevice,
  upsertDevice,
  setDeviceStatus,
  getCustomers,
  getRentals,
  getRental,
  createRental,
  confirmRental,
  cancelRental,
  updateRentalPayment,
  returnRentalDevices,
  getLogs,
  getStats,
  getScheduleRows,
  exportHistory,
  exportOutboundOrder,
  getDefaultTerms,
  setDefaultTerms,
  generateDeviceQR,
  getDeviceQR,
};

exports.main = async (event) => {
  try {
    const action = actions[event.action];
    if (!action) throw new Error(`未知操作: ${event.action}`);
    const data = await action(event.payload || {});
    return { success: true, data };
  } catch (e) {
    return {
      success: false,
      errMsg: e.message || e.errMsg || String(e),
    };
  }
};
