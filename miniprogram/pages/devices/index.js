const store = require("../../utils/store");

Page({
  data: {
    keyword: "",
    status: "all",
    statuses: [
      { key: "all", text: "全部" },
      { key: "available", text: "可租" },
      { key: "rented", text: "借出" },
      { key: "reserved", text: "预约" },
      { key: "repairing", text: "维修" },
    ],
    categoryFilter: "all",
    categories: [],
    devices: [],
    _loading: true,
    _error: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ _loading: true, _error: false });
    try {
      const keyword = this.data.keyword.trim().toLowerCase();
      const status = this.data.status;
      const category = this.data.categoryFilter;
      const allDevices = await store.getDevices();
      const availableCats = new Set(allDevices.map((item) => item.category || "其他"));
      const statuses = this.data.statuses.map((item) => ({
        ...item,
        active: item.key === status ? "active" : "",
      }));
      const categories = store.DEVICE_CATEGORIES.map((name) => ({
        key: name,
        text: name,
        active: category === name ? "active" : "",
        empty: !availableCats.has(name),
      }));
      categories.unshift({ key: "all", text: "全部", active: category === "all" ? "active" : "", empty: false });
      const devices = allDevices.filter((item) => {
        const matchStatus = status === "all" || item.displayStatus === status;
        const matchCategory = category === "all" || (item.category || "其他") === category;
        const text = `${item.deviceNo} ${item.name} ${item.brand} ${item.model} ${item.category}`.toLowerCase();
        return matchStatus && matchCategory && (!keyword || text.includes(keyword));
      });
      this.setData({ devices, statuses, categories, _loading: false });
    } catch (e) {
      // 有旧数据时静默刷新失败，不遮内容
      if (!this.data.devices.length) {
        this.setData({ _loading: false, _error: true });
      } else {
        this.setData({ _loading: false });
      }
      console.error("设备列表加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value }, () => this.load());
  },

  setStatus(e) {
    this.setData({ status: e.currentTarget.dataset.status }, () => this.load());
  },

  onCategoryFilter(e) {
    const key = e.currentTarget.dataset.key;
    const cat = this.data.categories.find((item) => item.key === key);
    if (cat && cat.empty) return;
    this.setData({ categoryFilter: key }, () => this.load());
  },

  addDevice() {
    wx.navigateTo({ url: "/pages/deviceForm/index" });
  },

  openDevice(e) {
    wx.navigateTo({ url: `/pages/deviceDetail/index?id=${e.currentTarget.dataset.id}` });
  },
});
