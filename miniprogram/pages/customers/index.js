const store = require("../../utils/store");

Page({
  data: {
    customers: [],
    keyword: "",
  },

  onShow() {
    this._keyword = "";
    this.load();
  },

  async load() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const customers = (await store.getCustomers()).filter((item) => {
      const text = `${item.name} ${item.phone} ${item.company} ${item.wechat}`.toLowerCase();
      return !keyword || text.includes(keyword);
    });
    this.setData({ customers });
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
    if (this._keywordTimer) clearTimeout(this._keywordTimer);
    this._keywordTimer = setTimeout(() => this.load(), 300);
  },

  openDetail(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/customerDetail/index?id=${id}&name=${encodeURIComponent(name)}` });
  },
});
