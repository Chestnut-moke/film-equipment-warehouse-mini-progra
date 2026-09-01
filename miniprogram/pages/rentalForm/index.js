const store = require("../../utils/store");

Page({
  data: {
    devices: [],
    allDevices: [],
    categories: [],
    categoryFilter: "all",
    selectedIds: [],
    hourOptions: [],
    startDate: "",
    startHourIndex: 9,
    returnDate: "",
    returnHourIndex: 18,
    durationHours: 24,
    currentWarehouse: {},
    customer: {
      name: "",
      phone: "",
      company: "",
      wechat: "",
      idCard: "",
      address: "",
      customerRemark: "",
    },
    form: {
      status: "rented",
      startAt: "",
      expectedReturnAt: "",
      durationHours: 24,
      rentalDays: 1,
      rentAmount: 0,
      depositAmount: 0,
      discountAmount: 0,
      paidAmount: 0,
      totalAmount: 0,
      unpaidAmount: 0,
      paymentStatus: "unpaid",
      depositStatus: "notReceived",
      remark: "",
    },
    rentedActive: "active",
    reservedActive: "",
    submitText: "确认借出",
    depositStatuses: [
      { text: "未收", value: "notReceived" },
      { text: "已收", value: "received" },
      { text: "信用免押", value: "credited" },
    ],
    depositStatusIndex: 0,
  },

  async onLoad(options) {
    const bootstrap = await store.bootstrap();
    const hourOptions = store.buildHourOptions();
    const today = store.formatDate(new Date());
    const startDate = options.startAt || today;
    const returnDate = store.addDaysFrom(startDate, 1);
    const selectedIds = options.deviceId ? [options.deviceId] : [];
    this.setData({
      currentWarehouse: bootstrap.currentWarehouse,
      hourOptions,
      selectedIds,
      startDate,
      returnDate,
      startHourIndex: 9,
      returnHourIndex: 18,
    }, () => this.syncDateTime());
  },

  onShow() {
    this.loadDevices();
  },

  async loadDevices() {
    const allDevices = (await store.getDevices()).filter((item) => item.displayStatus === "available");
    const availableCats = new Set(allDevices.map((item) => item.category || "其他"));
    // 完整分类列表，但仅标亮有可租设备的分类
    const categories = store.DEVICE_CATEGORIES.map((name) => ({
      key: name,
      text: name + (availableCats.has(name) ? "" : ""),
      active: this.data.categoryFilter === name ? "active" : "",
      empty: !availableCats.has(name),
    }));
    // 首项「全部」不做空标记
    categories.unshift({ key: "all", text: "全部", active: this.data.categoryFilter === "all" ? "active" : "", empty: false });
    this.setData({ allDevices, categories }, () => this.applyFilter());
  },

  applyFilter() {
    const filter = this.data.categoryFilter;
    const filtered = this.data.allDevices.filter((item) => filter === "all" || (item.category || "其他") === filter);
    const devices = filtered.map((item) => ({
      ...item,
      checked: this.data.selectedIds.includes(item._id),
    }));
    this.setData({ devices }, () => this.recalc());
  },

  onCategoryFilter(e) {
    const key = e.currentTarget.dataset.key;
    const cat = this.data.categories.find((item) => item.key === key);
    if (cat && cat.empty) return;  // 无可租设备，不可选
    const categories = this.data.categories.map((item) => ({
      ...item, active: item.key === key ? "active" : "",
    }));
    this.setData({ categoryFilter: key, categories }, () => this.applyFilter());
  },

  decorateDevices(devices) {
    return devices.map((item) => ({
      ...item,
      checked: this.data.selectedIds.includes(item._id),
    }));
  },

  onCustomerInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`customer.${field}`]: e.detail.value });
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value }, () => {
      if (field === "paidAmount" || field === "discountAmount") this.recalc();
    });
  },

  scanDevice() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode"],
      success: (res) => {
        const code = res.result;
        const device = this.data.allDevices.find((item) =>
          item._id === code || item.deviceNo === code || item.qrCode === code
        );
        if (!device) {
          wx.showToast({ title: `未找到设备 ${code}`, icon: "none" });
          return;
        }
        if (device.displayStatus !== "available") {
          wx.showToast({ title: `${device.deviceNo} 不可租`, icon: "none" });
          return;
        }
        const selectedIds = [...new Set([...this.data.selectedIds, device._id])];
        this.setData({ selectedIds }, () => this.applyFilter());
      },
      fail: (err) => {
        if (!(err.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "扫码失败", icon: "none" });
        }
      },
    });
  },

  onStartDate(e) {
    this.setData({ startDate: e.detail.value }, () => this.syncDateTime());
  },

  onStartHour(e) {
    this.setData({ startHourIndex: Number(e.detail.value) }, () => this.syncDateTime());
  },

  onReturnDate(e) {
    this.setData({ returnDate: e.detail.value }, () => this.syncDateTime());
  },

  onReturnHour(e) {
    this.setData({ returnHourIndex: Number(e.detail.value) }, () => this.syncDateTime());
  },

  syncDateTime() {
    const startAt = store.combineDateHour(this.data.startDate, this.data.hourOptions[this.data.startHourIndex]);
    const expectedReturnAt = store.combineDateHour(this.data.returnDate, this.data.hourOptions[this.data.returnHourIndex]);
    const duration = store.calculateDuration(startAt, expectedReturnAt);
    this.setData({
      "form.startAt": startAt,
      "form.expectedReturnAt": expectedReturnAt,
      "form.durationHours": duration.durationHours,
      "form.rentalDays": duration.rentalDays,
      durationHours: duration.durationHours,
    }, () => this.recalc());
  },

  onStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({
      "form.status": status,
      rentedActive: status === "rented" ? "active" : "",
      reservedActive: status === "reserved" ? "active" : "",
      submitText: status === "reserved" ? "保存预约" : "确认借出",
    });
  },

  onDepositStatus(e) {
    const index = Number(e.detail.value);
    const status = this.data.depositStatuses[index].value;
    this.setData({
      depositStatusIndex: index,
      "form.depositStatus": status,
    });
    if (status === "credited") {
      this.setData({ "form.depositAmount": 0 }, () => this.recalc());
    }
  },

  onDevicesChange(e) {
    const visibleIds = this.data.devices.map((item) => item._id);
    const newSelected = e.detail.value;
    // 保留当前视图外已选中的设备
    const hiddenSelected = this.data.selectedIds.filter((id) => !visibleIds.includes(id));
    const selectedIds = [...new Set([...newSelected, ...hiddenSelected])];
    this.setData({
      selectedIds,
      devices: this.data.devices.map((item) => ({ ...item, checked: selectedIds.includes(item._id) })),
    }, () => this.recalc());
  },

  recalc() {
    const days = Math.max(Number(this.data.form.rentalDays || 1), 1);
    const selected = this.data.devices.filter((item) => this.data.selectedIds.includes(item._id));
    const rentAmount = selected.reduce((sum, item) => sum + Number(item.dailyRent || 0) * days, 0);
    const depositAmount = selected.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0);
    const discountAmount = Number(this.data.form.discountAmount || 0);
    const paidAmount = Number(this.data.form.paidAmount || 0);
    const totalAmount = Math.max(rentAmount - discountAmount, 0);
    const unpaidAmount = Math.max(totalAmount - paidAmount, 0);
    let paymentStatus = "unpaid";
    if (totalAmount === 0) paymentStatus = "paid";          // 免费租赁
    else if (paidAmount >= totalAmount) paymentStatus = "paid";
    else if (paidAmount > 0) paymentStatus = "partial";
    this.setData({
      "form.rentAmount": rentAmount,
      "form.depositAmount": depositAmount,
      "form.totalAmount": totalAmount,
      "form.unpaidAmount": unpaidAmount,
      "form.paymentStatus": paymentStatus,
    });
  },

  async submit() {
    const customer = this.data.customer;
    const form = this.data.form;
    if (!customer.name || !customer.phone) {
      wx.showToast({ title: "请填写租赁人姓名和电话", icon: "none" });
      return;
    }
    if (!this.data.selectedIds.length) {
      wx.showToast({ title: "请选择设备", icon: "none" });
      return;
    }
    if (new Date(form.expectedReturnAt.replace(/-/g, "/")).getTime() <= new Date(form.startAt.replace(/-/g, "/")).getTime()) {
      wx.showToast({ title: "归还时间必须晚于开始时间", icon: "none" });
      return;
    }
    try {
      const rental = await store.createRental({
        customer,
        deviceIds: this.data.selectedIds,
        ...form,
      });
      wx.showToast({ title: form.status === "reserved" ? "已预约" : "已借出" });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/rentalDetail/index?id=${rental._id}` });
      }, 500);
    } catch (e) {
      wx.showToast({ title: e.message || "创建失败", icon: "none" });
    }
  },
});
