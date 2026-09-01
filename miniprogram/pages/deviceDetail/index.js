const store = require("../../utils/store");

// Code128B 编码表（value 0~106 → bar pattern bits string）
const C128 = [
  "11011001100","11001101100","11001100110","10010011000","10010001100","10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110","10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100","11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000","10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110","10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000","11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100","10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010","11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100","10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110","10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000","11010011100",
];

function code128b(text) {
  text = String(text || "");
  const bits = [];
  // Start B (104)
  bits.push(C128[104]);
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    if (v < 0 || v > 94) bits.push(C128[0]); else bits.push(C128[v]);
  }
  // Checksum
  let sum = 104;
  for (let i = 0; i < text.length; i++) {
    const v = Math.max(text.charCodeAt(i) - 32, 0);
    sum += (i + 1) * (v <= 94 ? v : 0);
  }
  bits.push(C128[sum % 103]);
  // Stop
  bits.push("1100011101011");
  return bits.join("");
}

Page({
  data: {
    device: null,
    logs: [],
    scheduleDays: [],
    scheduleCells: [],
    scheduleItems: [],
    exportVisible: false,
    _error: false,
  },

  onLoad(options) {
    this.id = options.id;
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ _error: false });
    try {
      // Step 1: 快速获取设备信息，立即渲染
      const device = await store.getDevice(this.id);
      if (!device) { this.setData({ _error: true }); return; }
      this.setData({ device });
      if (device) this.drawBarcode(device.deviceNo);

      // Step 2: 异步补位日志 + 日程（不阻塞页面渲染）
      try {
        const [logs, scheduleRows] = await Promise.all([
          store.getDeviceLogs(device._id, device.deviceNo, 20),
          store.getScheduleRows({ days: 14, deviceId: device._id }),
        ]);
        const scheduleDays = store.buildDays(14);
        const scheduleCells = scheduleRows[0] ? scheduleRows[0].cells : [];
        const scheduleItems = scheduleCells
          .filter((cell) => cell.rentalId)
          .reduce((items, cell) => {
            const exists = items.find((item) => item.rentalId === cell.rentalId);
            if (exists) {
              exists.endDate = cell.key;
              return items;
            }
            items.push({
              rentalId: cell.rentalId,
              rentalNo: cell.rentalNo,
              customerName: cell.customerName,
              status: cell.status,
              statusText: cell.statusText,
              className: cell.className,
              startDate: cell.key,
              endDate: cell.key,
            });
            return items;
          }, []);
        this.setData({ logs, scheduleDays, scheduleCells, scheduleItems });
      } catch (e) {
        console.error("设备日志/日程加载失败", e);
      }
    } catch (e) {
      this.setData({ _error: true });
      console.error("设备详情加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  drawBarcode(deviceNo) {
    const bits = code128b(deviceNo);
    const barW = 1.6;
    const contentW = bits.length * barW;
    const totalW = contentW + 28;
    const totalH = 120;
    const query = wx.createSelectorQuery();
    query.select("#barcodeCanvas").fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo().pixelRatio;
      canvas.width = totalW * dpr;
      canvas.height = totalH * dpr;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, totalW, totalH);
      ctx.fillStyle = "#000";
      let x = 14;
      for (let i = 0; i < bits.length; i++) {
        if (bits[i] === "1") ctx.fillRect(x, 12, barW, 96);
        x += barW;
      }
    });
  },

  edit() {
    wx.navigateTo({ url: `/pages/deviceForm/index?id=${this.data.device._id}` });
  },

  rent() {
    wx.navigateTo({ url: `/pages/rentalForm/index?deviceId=${this.data.device._id}` });
  },

  openRental() {
    if (!this.data.device.currentRentalId) return;
    wx.navigateTo({ url: `/pages/rentalDetail/index?id=${this.data.device.currentRentalId}` });
  },

  openSchedule() {
    wx.navigateTo({ url: `/pages/schedule/index?deviceId=${this.data.device._id}` });
  },

  openScheduleRental(e) {
    const rentalId = e.currentTarget.dataset.id;
    if (rentalId) {
      wx.navigateTo({ url: `/pages/rentalDetail/index?id=${rentalId}` });
    }
  },

  showExport() {
    this.setData({ exportVisible: true });
  },

  hideExport() {
    this.setData({ exportVisible: false });
  },

  async submitExport(e) {
    const form = e.detail;
    if (!form.startDate || !form.endDate) {
      wx.showToast({ title: "请选择时间范围", icon: "none" });
      return;
    }
    if (form.endDate < form.startDate) {
      wx.showToast({ title: "结束日期不能早于开始日期", icon: "none" });
      return;
    }
    wx.showLoading({ title: "生成文件中" });
    try {
      const file = await store.exportHistory({
        ...form,
        scope: "device",
        deviceId: this.data.device._id,
      });
      wx.hideLoading();
      this.setData({ exportVisible: false });
      await store.openExportFile(file);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "导出失败", icon: "none" });
    }
  },

  repair() {
    wx.showModal({
      title: "设为维修",
      content: "确认将该设备设为维修状态吗？",
      success: async (res) => {
        if (!res.confirm) return;
        await store.setDeviceStatus(this.data.device._id, "repairing");
        this.load();
        wx.showToast({ title: "已设为维修" });
      },
    });
  },

  available() {
    const isDisabled = this.data.device.displayStatus === "disabled";
    wx.showModal({
      title: isDisabled ? "恢复使用" : "恢复可租",
      content: isDisabled ? "确认将该设备从停用状态恢复吗？" : "确认将该设备恢复为可租状态吗？",
      success: async (res) => {
        if (!res.confirm) return;
        await store.setDeviceStatus(this.data.device._id, "available");
        this.load();
        wx.showToast({ title: isDisabled ? "已恢复使用" : "已恢复可租" });
      },
    });
  },

  disableDevice() {
    wx.showModal({
      title: "停用设备",
      content: "停用后该设备将不在租赁列表中显示，确认停用吗？",
      confirmText: "确认停用",
      confirmColor: "#FF3B30",
      success: async (res) => {
        if (!res.confirm) return;
        await store.setDeviceStatus(this.data.device._id, "disabled");
        this.load();
        wx.showToast({ title: "已停用" });
      },
    });
  },
});
