const store = require("../../utils/store");

Page({
  data: {
    isEdit: false,
    pageTitle: "新增设备",
    form: {
      deviceNo: "",
      name: "",
      category: "摄影机",
      brand: "",
      model: "",
      serialNo: "",
      status: "available",
      warehouseId: "",
      location: "",
      purchaseDate: "",
      purchasePrice: "",
      dailyRent: "",
      weeklyRent: "",
      monthlyRent: "",
      depositAmount: "",
      accessoriesText: "",
      remark: "",
    },
    categories: store.DEVICE_CATEGORIES,
    warehouses: [],
    warehouseNames: [],
    warehouseIndex: 0,
    canChangeWarehouse: true,
  },

  async onLoad(options) {
    const bootstrap = await store.bootstrap();
    const warehouses = bootstrap.warehouses;
    const currentWarehouseId = store.getCurrentWarehouseId();
    let formWarehouseId = currentWarehouseId;
    let form = { ...this.data.form, warehouseId: currentWarehouseId };

    if (options.id) {
      const device = await store.getDevice(options.id);
      if (device) {
        form = { ...form, ...device };
        formWarehouseId = device.warehouseId || currentWarehouseId;
        this.setData({
          isEdit: true,
          pageTitle: "编辑设备",
          canChangeWarehouse: ["available", "repairing", "disabled"].includes(device.status),
        });
      }
    } else if (options.deviceNo) {
      form.deviceNo = options.deviceNo;
      form.qrCode = options.deviceNo;
    }

    const warehouseIndex = Math.max(warehouses.findIndex((item) => item._id === formWarehouseId), 0);
    const selectedWarehouse = warehouses[warehouseIndex] || {};
    this.setData({
      form: { ...form, warehouseId: selectedWarehouse._id || formWarehouseId },
      warehouses,
      warehouseNames: warehouses.map((item) => item.name),
      warehouseIndex,
      purchaseDateText: form.purchaseDate || "请选择购买日期",
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  onCategory(e) {
    this.setData({ "form.category": this.data.categories[e.detail.value] });
  },

  onWarehouse(e) {
    const index = Number(e.detail.value);
    const warehouse = this.data.warehouses[index];
    if (!warehouse) return;
    this.setData({
      warehouseIndex: index,
      "form.warehouseId": warehouse._id,
    });
  },

  onPurchaseDate(e) {
    this.setData({ "form.purchaseDate": e.detail.value, purchaseDateText: e.detail.value });
  },

  async save() {
    const form = this.data.form;
    if (!form.deviceNo || !form.name || !form.brand || !form.model) {
      wx.showToast({ title: "请填写编号、名称、品牌、型号", icon: "none" });
      return;
    }
    const exists = (await store.getDevices({ warehouseId: form.warehouseId })).find((item) => item.deviceNo === form.deviceNo && item._id !== form._id);
    if (exists) {
      wx.showToast({ title: "该仓库内设备编号已存在", icon: "none" });
      return;
    }
    try {
      const device = await store.upsertDevice(form);
      wx.showToast({ title: "已保存" });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/deviceDetail/index?id=${device._id}` });
      }, 500);
    } catch (e) {
      wx.showToast({ title: e.message || "保存失败", icon: "none" });
    }
  },
});
