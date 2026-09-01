const store = require("../../utils/store");

Page({
  data: {
    daysCount: 7,
    startDate: "",
    deviceId: "",
    keyword: "",
    status: "all",
    category: "all",
    currentWarehouse: {},
    ranges: [
      { value: 7, text: "7天", active: "active" },
      { value: 30, text: "30天", active: "" },
      { value: 90, text: "90天", active: "" },
    ],
    statuses: [
      { key: "all", text: "全部", active: "active" },
      { key: "reserved", text: "预约", active: "" },
      { key: "rented", text: "借出", active: "" },
      { key: "overdue", text: "逾期", active: "" },
      { key: "repairing", text: "维修", active: "" },
    ],
    categories: [],
    days: [],
    rows: [],
    timelineWidth: 1000,
    showGlobalFilters: true,
  },

  async onLoad(options) {
    const bootstrap = await store.bootstrap();
    this.setData({
      deviceId: options.deviceId || "",
      startDate: options.startAt || store.formatDate(new Date()),
      currentWarehouse: bootstrap.currentWarehouse,
    });
  },

  onShow() {
    this.load();
  },

  async load() {
    const rows = await store.getScheduleRows({
      days: this.data.daysCount,
      startDate: this.data.startDate,
      deviceId: this.data.deviceId,
      keyword: this.data.keyword,
      status: this.data.status,
      category: this.data.category,
    });
    const days = store.buildDays(this.data.daysCount, this.data.startDate).map((item) => ({
      ...item,
      todayClass: item.isToday ? "today" : "",
    }));
    // 使用统一分类常量，筛选后仍然显示所有分类标签
    const categories = [
      { key: "all", text: "全部", active: this.data.category === "all" ? "active" : "" },
      ...store.DEVICE_CATEGORIES.map((name) => ({
        key: name,
        text: name,
        active: this.data.category === name ? "active" : "",
      })),
    ];
    this.setData({
      rows: rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          dimmedClass: cell.dimmed ? "dimmed" : "",
        })),
      })),
      days,
      timelineWidth: this.data.daysCount * 112 + 220,
      showGlobalFilters: !this.data.deviceId,
      categories,
      ranges: this.data.ranges.map((item) => ({
        ...item,
        active: Number(item.value) === Number(this.data.daysCount) ? "active" : "",
      })),
      statuses: this.data.statuses.map((item) => ({
        ...item,
        active: item.key === this.data.status ? "active" : "",
      })),
    });
  },

  onStartDate(e) {
    this.setData({ startDate: e.detail.value }, () => this.load());
  },

  setRange(e) {
    this.setData({ daysCount: Number(e.currentTarget.dataset.value) }, () => this.load());
  },

  setStatus(e) {
    this.setData({ status: e.currentTarget.dataset.status }, () => this.load());
  },

  setCategory(e) {
    this.setData({ category: e.currentTarget.dataset.category }, () => this.load());
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
    if (this._keywordTimer) clearTimeout(this._keywordTimer);
    this._keywordTimer = setTimeout(() => this.load(), 300);
  },

  openDevice(e) {
    wx.navigateTo({ url: `/pages/deviceDetail/index?id=${e.currentTarget.dataset.id}` });
  },

  openCell(e) {
    const rentalId = e.currentTarget.dataset.rental;
    const deviceId = e.currentTarget.dataset.device;
    const day = e.currentTarget.dataset.day;
    const status = e.currentTarget.dataset.status;
    if (rentalId) {
      wx.navigateTo({ url: `/pages/rentalDetail/index?id=${rentalId}` });
      return;
    }
    if (status === "repairing") {
      wx.navigateTo({ url: `/pages/deviceDetail/index?id=${deviceId}` });
      return;
    }
    if (deviceId) {
      wx.navigateTo({ url: `/pages/rentalForm/index?deviceId=${deviceId}&startAt=${day}` });
    }
  },
});
