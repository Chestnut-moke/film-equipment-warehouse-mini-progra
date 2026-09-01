const store = require("../../utils/store");

Page({
  data: {
    status: "all",
    statuses: [
      { key: "all", text: "全部" },
      { key: "rented", text: "借出" },
      { key: "reserved", text: "预约" },
      { key: "overdue", text: "逾期" },
      { key: "returned", text: "已归还" },
    ],
    rentals: [],
    _loading: true,
    _error: false,
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ _loading: true, _error: false });
    try {
      const statuses = this.data.statuses.map((item) => ({
        ...item,
        active: item.key === this.data.status ? "active" : "",
      }));
      const rentals = await store.getRentals({ status: this.data.status === "all" ? "" : this.data.status });
      this.setData({ rentals, statuses, _loading: false });
    } catch (e) {
      if (!this.data.rentals.length) {
        this.setData({ _loading: false, _error: true });
      } else {
        this.setData({ _loading: false });
      }
      console.error("租赁列表加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  setStatus(e) {
    this.setData({ status: e.currentTarget.dataset.status }, () => this.load());
  },

  addRental() {
    wx.navigateTo({ url: "/pages/rentalForm/index" });
  },

  openRental(e) {
    wx.navigateTo({ url: `/pages/rentalDetail/index?id=${e.currentTarget.dataset.id}` });
  },
});
