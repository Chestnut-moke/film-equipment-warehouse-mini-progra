const store = require("../../utils/store");

const LOG_FILTERS = [
  { key: "all", text: "全部" },
  { key: "device", text: "设备" },
  { key: "rental", text: "租赁" },
  { key: "return", text: "归还" },
];

const DEVICE_TYPES = ["device_create", "device_update", "repair_start", "repair_end", "disable", "status_change"];
const RENTAL_TYPES = ["reserve", "rent_out", "cancel", "payment"];
const RETURN_TYPES = ["return", "partial_return"];

Page({
  data: {
    stats: {},
    logs: [],
    allLogs: [],
    logFilter: "all",
    logFilters: LOG_FILTERS,
    exportVisible: false,
    _loading: true,
    _error: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ _loading: true, _error: false });
    try {
      const data = await store.getDashboard();
      const allLogs = data.logs || [];
      this.setData({
        stats: data.stats,
        allLogs,
        logs: this._filterLogs(allLogs, this.data.logFilter),
        logFilters: this.data.logFilters.map((item) => ({
          ...item,
          active: item.key === this.data.logFilter ? "active" : "",
        })),
        _loading: false,
      });
    } catch (e) {
      if (!this.data.stats.totalIncome) {
        this.setData({ _loading: false, _error: true });
      } else {
        this.setData({ _loading: false });
      }
      console.error("统计页加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  _filterLogs(allLogs, filter) {
    if (filter === "all") return allLogs;
    const types = filter === "device" ? DEVICE_TYPES : filter === "rental" ? RENTAL_TYPES : RETURN_TYPES;
    return allLogs.filter((item) => types.includes(item.type));
  },

  onLogFilter(e) {
    const key = e.currentTarget.dataset.key;
    const filters = this.data.logFilters.map((item) => ({ ...item, active: item.key === key ? "active" : "" }));
    this.setData({
      logFilter: key,
      logFilters: filters,
      logs: this._filterLogs(this.data.allLogs, key),
    });
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
      const file = await store.exportHistory(form);
      wx.hideLoading();
      this.setData({ exportVisible: false });
      await store.openExportFile(file);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "导出失败", icon: "none" });
    }
  },
});
