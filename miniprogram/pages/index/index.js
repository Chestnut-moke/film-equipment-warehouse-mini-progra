const store = require("../../utils/store");

Page({
  data: {
    stats: {},
    dueRentals: [],
    currentWarehouse: {},
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
      this.setData({
        stats: data.stats,
        dueRentals: data.dueRentals,
        currentWarehouse: data.currentWarehouse,
        currentWarehouseName: data.currentWarehouseName,
        _loading: false,
      });
    } catch (e) {
      this.setData({ _loading: false, _error: true });
      console.error("工作台加载失败", e);
    }
  },

  onRetry() {
    this.load();
  },

  scanDevice() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ["barCode", "qrCode"],
      success: async (res) => {
        const code = res.result;
        try {
          const device = await store.getDevice(code);
          if (!device) {
            wx.showModal({
              title: "未找到设备",
              content: `没有找到编号为 ${code} 的设备，是否新增？`,
              confirmText: "新增",
              success: (modal) => {
                if (modal.confirm) {
                  wx.navigateTo({ url: `/pages/deviceForm/index?deviceNo=${code}` });
                }
              },
            });
            return;
          }
          wx.navigateTo({ url: `/pages/deviceDetail/index?id=${device._id}` });
        } catch (e) {
          wx.showToast({ title: "查询设备失败，请重试", icon: "none" });
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes("cancel")) {
          wx.showToast({ title: "扫码已取消", icon: "none" });
        } else {
          wx.showToast({ title: "扫码失败，请检查相机权限", icon: "none" });
        }
      },
    });
  },

  goDevices() {
    wx.switchTab({ url: "/pages/devices/index" });
  },

  goNewDevice() {
    wx.navigateTo({ url: "/pages/deviceForm/index" });
  },

  goNewRental() {
    wx.navigateTo({ url: "/pages/rentalForm/index" });
  },

  goRentals() {
    wx.switchTab({ url: "/pages/rentals/index" });
  },

  goCustomers() {
    wx.navigateTo({ url: "/pages/customers/index" });
  },

  goSchedule() {
    wx.navigateTo({ url: "/pages/schedule/index" });
  },

  goWarehouses() {
    wx.navigateTo({ url: "/pages/warehouses/index" });
  },

  async backupData() {
    wx.showLoading({ title: "导出中" });
    const fs = wx.getFileSystemManager();
    let tempFilePath;
    try {
      const data = await store.backupAllData();
      const json = JSON.stringify(data, null, 2);
      const fileName = `设备管理备份_${store.formatDate(new Date())}.json`;
      tempFilePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      await new Promise((resolve, reject) => {
        fs.writeFile({ filePath: tempFilePath, data: json, encoding: "utf8", success: resolve, fail: reject });
      });
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "备份失败", icon: "none" });
      return;
    }

    wx.showActionSheet({
      itemList: ["分享文件", "复制到剪贴板"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this._shareBackupFile(tempFilePath);
        } else {
          this._copyBackupToClipboard(tempFilePath);
        }
      },
    });
  },

  _shareBackupFile(tempFilePath) {
    wx.shareFileMessage({
      filePath: tempFilePath,
      fileName: tempFilePath.split("/").pop(),
      fail: () => {
        wx.showToast({ title: "分享失败，请尝试复制到剪贴板", icon: "none" });
      },
    });
  },

  _copyBackupToClipboard(tempFilePath) {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: tempFilePath,
      encoding: "utf8",
      success: (res) => {
        wx.setClipboardData({
          data: res.data,
          success: () => {
            wx.showModal({ title: "备份已复制", content: "数据已复制到剪贴板，请粘贴到备忘录或文件中保存。", showCancel: false });
          },
        });
      },
      fail: () => {
        wx.showToast({ title: "读取文件失败", icon: "none" });
      },
    });
  },

  restoreData() {
    wx.showActionSheet({
      itemList: ["选择备份文件", "粘贴 JSON"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this._restoreFromFile();
        } else {
          this._restoreFromPaste();
        }
      },
    });
  },

  _restoreFromFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file) return;
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: file.path,
          encoding: "utf8",
          success: async (readRes) => {
            this._doRestore(readRes.data);
          },
          fail: () => {
            wx.showToast({ title: "读取文件失败", icon: "none" });
          },
        });
      },
      fail: (err) => {
        if (!(err.errMsg || "").includes("cancel")) {
          wx.showToast({ title: "选择文件失败", icon: "none" });
        }
      },
    });
  },

  _restoreFromPaste() {
    wx.showModal({
      title: "粘贴备份 JSON",
      content: "请先通过「备份数据」获取 JSON，粘贴到下方进行恢复。此操作将合并数据，不会覆盖已有记录。",
      editable: true,
      placeholderText: "将备份的 JSON 粘贴到这里",
      success: (res) => {
        if (!res.confirm || !res.content) {
          wx.showToast({ title: "已取消", icon: "none" });
          return;
        }
        this._doRestore(res.content);
      },
    });
  },

  async _doRestore(json) {
    wx.showLoading({ title: "导入中" });
    try {
      const result = await store.restoreAllData(json);
      wx.hideLoading();
      wx.showModal({
        title: "恢复完成",
        content: `成功导入 ${result.imported} 条记录。`,
        showCancel: false,
        success: () => this.load(),
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || "恢复失败", icon: "none" });
    }
  },

  openRental(e) {
    wx.navigateTo({ url: `/pages/rentalDetail/index?id=${e.currentTarget.dataset.id}` });
  },
});
