const store = require("../../utils/store");

Page({
  data: {
    customer: null,
    rentals: [],
    stats: {},
    _error: false,
  },

  onLoad(options) {
    this.customerId = options.id;
    this.name = decodeURIComponent(options.name || "");
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ _error: false });
    try {
      // 获取客户信息（从全量列表中匹配）
      const customers = await store.getCustomers();
      const customer = customers.find((item) => item._id === this.customerId) || {
        _id: this.customerId,
        name: this.name,
        phone: "",
        company: "",
        wechat: "",
      };
      // 获取该客户的所有租赁单
      const rentals = await store.getCustomerRentals(this.customerId);
      // 累计统计（基于实时租赁数据）
      const activeStatuses = ["rented", "partReturned", "reserved"];
      const stats = {
        totalCount: rentals.length,
        totalAmount: rentals.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0),
        activeCount: rentals.filter((item) => activeStatuses.includes(item.status)).length,
        overdueCount: rentals.filter((item) => item.displayStatus === "overdue").length,
      };
      this.setData({ customer, rentals, stats });
    } catch (e) {
      this.setData({ _error: true });
      console.error("客户详情加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  openRental(e) {
    wx.navigateTo({ url: `/pages/rentalDetail/index?id=${e.currentTarget.dataset.id}` });
  },
});
