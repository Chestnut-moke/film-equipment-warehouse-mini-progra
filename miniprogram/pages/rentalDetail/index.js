const store = require("../../utils/store");

Page({
  data: {
    rental: null,
    canReturn: false,
    returnIds: [],
    returnCheckedMap: {},
    damagedIds: [],
    damageFee: "",
    remark: "",
    printVisible: false,
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
    // 切换租赁单时清除上次勾选
    if (this._lastRentalId && this._lastRentalId !== this.id) {
      this.setData({ returnIds: [], returnCheckedMap: {} });
    }
    this._lastRentalId = this.id;
    try {
      const raw = await store.getRental(this.id);
      const rental = raw ? {
        ...raw,
        companyText: raw.customerSnapshot.company || "无公司/剧组",
        actualReturnText: raw.actualReturnAt || "-",
        durationText: `${raw.durationHours || 0} 小时 / ${raw.rentalDays} 天`,
        devices: raw.devices.map((item) => ({
          ...item,
          returnText: item.returnedAt ? `已归还 ${item.returnedAt}` : "未归还",
          statusText: store.STATUS_TEXT[item.status] || "借出",
        })),
      } : null;
      this.setData({
        rental,
        canReturn: rental && rental.status !== "returned" && rental.status !== "cancelled" && rental.status !== "reserved",
        damagedIds: [],
        damageFee: "",
        remark: "",
      });
    } catch (e) {
      this.setData({ _error: true });
      console.error("租赁详情加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  toggleReturnDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid;
    const checked = !this.data.returnCheckedMap[deviceId];
    const returnCheckedMap = { ...this.data.returnCheckedMap, [deviceId]: checked };
    const returnIds = checked
      ? [...new Set([...this.data.returnIds, deviceId])]
      : this.data.returnIds.filter((id) => id !== deviceId);
    this.setData({ returnIds, returnCheckedMap });
  },

  onDamageChange(e) {
    this.setData({ damagedIds: e.detail.value });
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  scanForReturn() {
    const rental = this.data.rental;
    if (!rental) return;
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode"],
      success: (res) => {
        const code = res.result;
        const device = (rental.devices || []).find((item) =>
          item.deviceId === code || item.deviceNo === code
        );
        if (!device) {
          wx.showToast({ title: "该设备不在本次租赁中", icon: "none" });
          return;
        }
        if (device.returnedAt) {
          wx.showToast({ title: `${device.deviceNo || device.name} 已归还`, icon: "none" });
          return;
        }
        const returnCheckedMap = { ...this.data.returnCheckedMap, [device.deviceId]: true };
        const returnIds = [...new Set([...this.data.returnIds, device.deviceId])];
        this.setData({ returnCheckedMap, returnIds });
        wx.showToast({ title: `已勾选 ${device.deviceNo || device.name}`, icon: "success" });
      },
      fail: (err) => {
        if (!(err.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "扫码失败", icon: "none" });
        }
      },
    });
  },

  showPrint() {
    this.setData({ printVisible: true });
  },

  hidePrint() {
    this.setData({ printVisible: false });
  },

  async submitPrint(e) {
    const form = e.detail;
    wx.showLoading({ title: "生成出库单" });
    try {
      const file = await store.exportOutboundOrder({
        rentalId: this.data.rental._id,
        includeHeader: form.includeHeader,
        companyName: form.companyName,
        contactPhone: form.contactPhone,
        logoFileId: form.logoFileId,
        operatorName: form.operatorName,
        contractTerms: form.contractTerms,
      });
      wx.hideLoading();
      this.setData({ printVisible: false });
      await store.openExportFile(file);
      this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "生成失败", icon: "none" });
    }
  },

  async submitReturn() {
    if (!this.data.returnIds.length) {
      wx.showToast({ title: "请选择要归还的设备", icon: "none" });
      return;
    }
    const rental = this.data.rental;
    const damagedCount = this.data.damagedIds.length;
    const damageAmount = Number(this.data.damageFee || 0);
    try {
      await store.returnRentalDevices(this.data.rental._id, this.data.returnIds, {
        damagedIds: this.data.damagedIds,
        damageFee: this.data.damageFee,
        remark: this.data.remark,
      });
    } catch (e) {
      wx.showToast({ title: e.message || "归还失败", icon: "none" });
      return;
    }
    this.setData({ returnIds: [], returnCheckedMap: {} });
    this.load();

    // 归还后押金处理提示
    if (rental.depositStatus === "received" || rental.depositStatus === "partialRefund") {
      if (damagedCount > 0) {
        wx.showModal({
          title: "归还完成",
          content: `${damagedCount} 台损坏 · 扣款 ¥${damageAmount} | 押金 ¥${Number(rental.depositAmount || 0)} → 应退 ¥${Math.max(Number(rental.depositAmount || 0) - damageAmount, 0)}`,
          confirmText: "处理押金",
          success: (res) => { if (res.confirm) this.updateDeposit(); },
        });
      } else if (rental.depositAmount > 0) {
        wx.showModal({
          title: "归还完成",
          content: "全部设备已归还且无损坏，建议退还押金。",
          confirmText: "处理押金",
          success: (res) => { if (res.confirm) this.updateDeposit(); },
        });
      } else {
        wx.showToast({ title: "已归还" });
      }
    } else {
      wx.showToast({ title: "已归还" });
    }
  },

  async confirmRentOut() {
    await store.confirmRental(this.data.rental._id);
    wx.showToast({ title: "已确认借出" });
    this.load();
  },

  cancelRental() {
    const rental = this.data.rental;
    if (!rental) return;
    const label = rental.status === "reserved" ? "预约" : "租赁";
    wx.showModal({
      title: `取消${label}`,
      content: `确认取消该${label}单吗？所有未归还设备将恢复为可租状态。`,
      confirmText: "确认取消",
      confirmColor: "#FF3B30",
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await store.cancelRental(rental._id);
          wx.showToast({ title: `已取消${label}` });
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || "取消失败", icon: "none" });
        }
      },
    });
  },

  openDevice(e) {
    wx.navigateTo({ url: `/pages/deviceDetail/index?id=${e.currentTarget.dataset.id}` });
  },

  addPayment() {
    const rental = this.data.rental;
    if (!rental) return;
    wx.showModal({
      title: "追加收款",
      content: "",
      editable: true,
      placeholderText: `已收 ¥${Number(rental.paidAmount || 0).toFixed(2)} · 未付 ¥${Number(rental.unpaidAmount || 0).toFixed(2)}`,
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        const amount = Number(res.content);
        if (isNaN(amount) || amount <= 0) {
          wx.showToast({ title: "请输入有效金额", icon: "none" });
          return;
        }
        try {
          await store.updateRentalPayment(rental._id, amount, null, `追加收款 ¥${amount}`);
          wx.showToast({ title: `已追加收款 ¥${amount.toFixed(2)}` });
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || "操作失败", icon: "none" });
        }
      },
    });
  },

  updateDeposit() {
    const rental = this.data.rental;
    if (!rental) return;
    wx.showActionSheet({
      itemList: ["未收", "已收", "部分退", "已退", "已扣除", "信用免押"],
      success: async (res) => {
        const statuses = ["notReceived", "received", "partialRefund", "refunded", "deducted", "credited"];
        const status = statuses[res.tapIndex];
        try {
          await store.updateRentalPayment(rental._id, null, status, `押金状态 → ${store.DEPOSIT_TEXT[status]}`);
          wx.showToast({ title: `押金 ${store.DEPOSIT_TEXT[status]}` });
          this.load();
        } catch (e) {
          wx.showToast({ title: e.message || "操作失败", icon: "none" });
        }
      },
    });
  },
});
