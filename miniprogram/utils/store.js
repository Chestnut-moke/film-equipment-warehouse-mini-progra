// Replace this placeholder with your own WeChat CloudBase environment ID.
const ENV_ID = "YOUR_CLOUD_ENV_ID";
const FUNCTION_NAME = "warehouse";
const CURRENT_WAREHOUSE_KEY = `film_store_current_warehouse_${ENV_ID}`;
const LEGACY_KEYS = {
  devices: "film_store_devices",
  customers: "film_store_customers",
  rentals: "film_store_rentals",
  logs: "film_store_logs",
};

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

function parseDateTime(value) {
  if (!value) return null;
  const d = new Date(`${value}`.replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function addDaysFrom(date, days) {
  const d = new Date(`${date}`.slice(0, 10).replace(/-/g, "/"));
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function buildDays(count, startDate) {
  const base = startDate ? new Date(`${startDate}`.slice(0, 10).replace(/-/g, "/")) : new Date();
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

function buildHourOptions() {
  return Array.from({ length: 24 }).map((_, hour) => `${pad(hour)}:00`);
}

function combineDateHour(date, hour) {
  return `${date} ${hour || "00:00"}`;
}

function splitDateTime(value) {
  const text = value || formatDateTime(new Date());
  return {
    date: text.slice(0, 10),
    hour: text.slice(11, 16) || "00:00",
  };
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

async function call(action, payload) {
  const resp = await wx.cloud.callFunction({
    name: FUNCTION_NAME,
    data: {
      action,
      payload: payload || {},
    },
  });
  const result = resp.result || {};
  if (!result.success) {
    throw new Error(result.errMsg || "云端操作失败");
  }
  return result.data;
}

function openExportFile(file) {
  const url = file && file.tempFileURL;
  if (!url) {
    return Promise.reject(new Error("导出文件地址为空"));
  }
  const fallbackSave = (filePath, resolve, reject) => {
    wx.saveFile({
      tempFilePath: filePath,
      success(saveRes) {
        wx.showModal({
          title: "文件已保存",
          content: "CSV 文件已保存，可在微信文件中查看或转存。",
          showCancel: false,
          success: () => resolve(saveRes),
        });
      },
      fail: reject,
    });
  };
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode !== 200) {
          reject(new Error("文件下载失败"));
          return;
        }
        wx.openDocument({
          filePath: res.tempFilePath,
          fileType: file.format === "csv" ? "csv" : "pdf",
          showMenu: true,
          success: resolve,
          fail() {
            fallbackSave(res.tempFilePath, resolve, reject);
          },
        });
      },
      fail: reject,
    });
  });
}

function uploadExportLogo(tempFilePath) {
  const ext = `${tempFilePath || ""}`.split(".").pop() || "png";
  return wx.cloud.uploadFile({
    cloudPath: `export-logos/logo-${Date.now()}.${ext}`,
    filePath: tempFilePath,
  });
}

function initCloud() {
  if (!wx.cloud) {
    throw new Error("当前基础库不支持云开发");
  }
  wx.cloud.init({
    env: ENV_ID,
    traceUser: true,
  });
}

function getCurrentWarehouseId() {
  return wx.getStorageSync(CURRENT_WAREHOUSE_KEY) || "";
}

function setCurrentWarehouseId(id) {
  wx.setStorageSync(CURRENT_WAREHOUSE_KEY, id);
}

function withWarehouse(payload) {
  return {
    ...(payload || {}),
    warehouseId: (payload && payload.warehouseId) || getCurrentWarehouseId(),
  };
}

async function bootstrap() {
  const data = await call("getBootstrap");
  const current = getCurrentWarehouseId();
  const exists = data.warehouses.find((item) => item._id === current);
  if (!current || !exists) {
    setCurrentWarehouseId(data.currentWarehouse._id);
  }
  return {
    ...data,
    currentWarehouse: exists || data.currentWarehouse,
  };
}

async function migrateLocalData() {
  const flagKey = `film_store_cloud_migrated_${ENV_ID}`;
  if (wx.getStorageSync(flagKey)) return { migrated: false };
  const data = {
    devices: wx.getStorageSync(LEGACY_KEYS.devices) || [],
    customers: wx.getStorageSync(LEGACY_KEYS.customers) || [],
    rentals: wx.getStorageSync(LEGACY_KEYS.rentals) || [],
    logs: wx.getStorageSync(LEGACY_KEYS.logs) || [],
  };
  const total = Object.keys(data).reduce((sum, key) => sum + data[key].length, 0);
  if (!total) {
    wx.setStorageSync(flagKey, true);
    return { migrated: false };
  }
  const result = await call("importLocalData", data);
  if (result.warehouse && result.warehouse._id) {
    setCurrentWarehouseId(result.warehouse._id);
  }
  wx.setStorageSync(flagKey, true);
  return result;
}

// ============ 轻量内存缓存 ============
const CACHE_TTL = 10000; // 10 秒，避免 Tab 切换重复调用
const cacheMap = new Map();

async function cachedCall(action, payload, ttl) {
  const key = `${action}_${JSON.stringify(payload || {})}`;
  const cached = cacheMap.get(key);
  if (cached && Date.now() - cached.time < (ttl || CACHE_TTL)) {
    return cached.data;
  }
  const data = await call(action, payload);
  cacheMap.set(key, { data, time: Date.now() });
  return data;
}

module.exports = {
  ENV_ID,
  STATUS_TEXT,
  PAYMENT_TEXT,
  DEPOSIT_TEXT,
  DEVICE_CATEGORIES: ["摄影机", "镜头", "灯光", "录音", "监视器", "稳定器", "脚架", "配件", "其他"],
  formatDate,
  formatDateTime,
  addDays,
  addDaysFrom,
  buildDays,
  buildHourOptions,
  combineDateHour,
  splitDateTime,
  calculateDuration,
  initCloud,
  bootstrap,
  getDashboard: () => cachedCall("getDashboard"),
  migrateLocalData,
  getCurrentWarehouseId,
  setCurrentWarehouseId,
  ensureSeedData: () => call("ensureSeedData"),
  getWarehouses: () => call("getWarehouses"),
  upsertWarehouse: (form) => call("upsertWarehouse", { form }),
  deleteWarehouse: (id) => call("deleteWarehouse", { id }),
  getDevices: (payload) => call("getDevices", withWarehouse(payload)),
  getDevice: (id) => call("getDevice", { id }),
  upsertDevice: (form) => call("upsertDevice", withWarehouse({ form: { ...form, warehouseId: form.warehouseId || getCurrentWarehouseId() } })),
  setDeviceStatus: (id, status, remark) => call("setDeviceStatus", { id, status, remark }),
  getCustomers: () => call("getCustomers"),
  getRentals: (payload) => call("getRentals", withWarehouse(payload)),
  getCustomerRentals: (customerId) => call("getRentals", withWarehouse({ customerId })),
  getRental: (id) => call("getRental", { id }),
  createRental: (payload) => call("createRental", withWarehouse(payload)),
  confirmRental: (rentalId) => call("confirmRental", { rentalId }),
  cancelRental: (rentalId) => call("cancelRental", { rentalId }),
  updateRentalPayment: (rentalId, addPaidAmount, depositStatus, remark) => call("updateRentalPayment", { rentalId, addPaidAmount, depositStatus, remark }),
  returnRentalDevices: (rentalId, deviceIds, options) => call("returnRentalDevices", { rentalId, deviceIds, options }),
  getLogs: (payload) => call("getLogs", withWarehouse(payload)),
  getDeviceLogs: (deviceId, deviceNo, limit) => call("getLogs", { deviceId, deviceNo, limit, allWarehouses: true }),
  getStats: (payload) => call("getStats", withWarehouse(payload)),
  getScheduleRows: (options) => call("getScheduleRows", withWarehouse(options)),
  exportHistory: (payload) => call("exportHistory", payload && payload.scope === "all_warehouses" ? payload : withWarehouse(payload)),
  exportOutboundOrder: (payload) => call("exportOutboundOrder", payload),
  backupAllData: () => call("backupAllData"),
  restoreAllData: (json) => call("restoreAllData", { json }),
  getDefaultTerms: () => call("getDefaultTerms"),
  setDefaultTerms: (contractTerms) => call("setDefaultTerms", { contractTerms }),
  getDeviceQR: (deviceId) => call("getDeviceQR", { deviceId }),
  openExportFile,
  uploadExportLogo,
};
