const store = require("../../utils/store");

Page({
  data: {
    warehouses: [],
    currentWarehouseId: "",
    form: {
      _id: "",
      name: "",
      city: "",
      address: "",
      manager: "",
      phone: "",
      remark: "",
      isDefault: false,
    },
    formTitle: "新增仓库",
  },

  onShow() {
    this.load();
  },

  async load() {
    const data = await store.bootstrap();
    this.setData({
      warehouses: data.warehouses.map((item) => ({
        ...item,
        active: item._id === store.getCurrentWarehouseId() ? "active" : "",
        cityText: item.city || "未填写城市",
        managerText: item.manager || "未填写负责人",
        addressText: item.address || "未填写地址",
      })),
      currentWarehouseId: store.getCurrentWarehouseId(),
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onDefaultChange(e) {
    this.setData({ "form.isDefault": e.detail.value.length > 0 });
  },

  editWarehouse(e) {
    const item = this.data.warehouses.find((warehouse) => warehouse._id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({
      formTitle: "编辑仓库",
      form: {
        _id: item._id,
        name: item.name,
        city: item.city,
        address: item.address,
        manager: item.manager,
        phone: item.phone,
        remark: item.remark,
        isDefault: item.isDefault,
        createdAt: item.createdAt,
      },
    });
  },

  async saveWarehouse() {
    if (!this.data.form.name) {
      wx.showToast({ title: "请填写仓库名称", icon: "none" });
      return;
    }
    const warehouse = await store.upsertWarehouse(this.data.form);
    if (!this.data.currentWarehouseId) {
      store.setCurrentWarehouseId(warehouse._id);
    }
    wx.showToast({ title: "已保存" });
    this.resetForm();
    this.load();
  },

  resetForm() {
    this.setData({
      formTitle: "新增仓库",
      form: {
        _id: "",
        name: "",
        city: "",
        address: "",
        manager: "",
        phone: "",
        remark: "",
        isDefault: false,
      },
    });
  },

  switchWarehouse(e) {
    store.setCurrentWarehouseId(e.currentTarget.dataset.id);
    wx.showToast({ title: "已切换仓库" });
    this.load();
  },

  deleteWarehouse(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: "删除仓库",
      content: `确认删除「${name}」吗？删除前请确保仓库下无设备。`,
      confirmText: "确认删除",
      confirmColor: "#FF3B30",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await store.deleteWarehouse(id);
          wx.showToast({ title: "已删除" });
          // 如果删除的是当前仓库，清空选中
          if (store.getCurrentWarehouseId() === id) {
            store.setCurrentWarehouseId("");
          }
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || "删除失败", icon: "none" });
        }
      },
    });
  },
});
