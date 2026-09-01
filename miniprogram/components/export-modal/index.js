const store = require("../../utils/store");

Component({
  properties: {
    visible: { type: Boolean, value: false, observer: "onVisibleChange" },
    title: { type: String, value: "导出" },
    showScope: { type: Boolean, value: false },
    showFormat: { type: Boolean, value: false },
    showDateRange: { type: Boolean, value: false },
    showHeader: { type: Boolean, value: true },
    showOperator: { type: Boolean, value: false },
    showFilters: { type: Boolean, value: false },
    submitLabel: { type: String, value: "生成并预览" },
  },

  data: {
    // 范围
    scopeOptions: ["当前仓库", "全部仓库"],
    scopeValues: ["current_warehouse", "all_warehouses"],
    scopeIndex: 0,
    // 格式
    formatOptions: ["PDF", "CSV"],
    formatValues: ["pdf", "csv"],
    formatIndex: 0,
    // 日期
    startDate: "",
    endDate: "",
    // 抬头
    includeHeader: false,
    companyName: "",
    contactPhone: "",
    logoFileId: "",
    logoName: "",
    // 经办人
    operatorName: "",
    // 合同条款（仅出库单）
    contractTerms: "",
    termsEditVisible: false,
    termsEditText: "",
    // 多条件筛选
    statusOptions: ["全部", "借出", "已归还", "逾期", "部分归还", "已预约", "已取消"],
    statusValues: ["all", "rented", "returned", "overdue", "partReturned", "reserved", "cancelled"],
    filterStatus: "all",
    filterStatusIndex: 0,
    categoryOptions: ["全部"],
    categoryValues: ["all"],
    filterCategory: "all",
    filterCategoryIndex: 0,
    customerKeyword: "",
    // 状态
    submitting: false,
  },

  methods: {
    onVisibleChange(visible) {
      if (visible) {
        const today = store.formatDate(new Date());
        this.setData({
          startDate: today,
          endDate: today,
          submitting: false,
          includeHeader: false,
          companyName: "",
          contactPhone: "",
          logoFileId: "",
          logoName: "",
          operatorName: "",
          contractTerms: "",
          scopeIndex: 0,
          formatIndex: 0,
          filterStatus: "all",
          filterStatusIndex: 0,
          filterCategory: "all",
          filterCategoryIndex: 0,
          customerKeyword: "",
        });
        if (this.data.showFilters) this.loadCategories();
      }
    },

    async loadCategories() {
      try {
        const devices = await store.getDevices();
        const cats = [...new Set(devices.map((d) => d.category || "其他").filter(Boolean))];
        this.setData({
          categoryOptions: ["全部", ...cats],
          categoryValues: ["all", ...cats],
        });
      } catch (e) {
        // 静默失败，保留默认「全部」
      }
    },

    noop() {},

    onMask() {
      this.triggerEvent("close");
    },

    onCancel() {
      this.triggerEvent("close");
    },

    onScopeChange(e) {
      this.setData({ scopeIndex: Number(e.detail.value || 0) });
    },

    onFormatChange(e) {
      this.setData({ formatIndex: Number(e.detail.value || 0) });
    },

    onStartDate(e) {
      this.setData({ startDate: e.detail.value });
    },

    onEndDate(e) {
      this.setData({ endDate: e.detail.value });
    },

    onHeaderToggle(e) {
      this.setData({ includeHeader: e.detail.value.length > 0 });
    },

    onInput(e) {
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
    },

    chooseLogo() {
      const onFile = async (filePath) => {
        wx.showLoading({ title: "上传 Logo" });
        try {
          const result = await store.uploadExportLogo(filePath);
          this.setData({ logoFileId: result.fileID, logoName: "已选择 Logo" });
        } catch (e) {
          wx.showToast({ title: e.message || "Logo 上传失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      };
      if (wx.chooseMedia) {
        wx.chooseMedia({ count: 1, mediaType: ["image"], success: (res) => onFile(res.tempFiles[0].tempFilePath) });
        return;
      }
      wx.chooseImage({ count: 1, success: (res) => onFile(res.tempFilePaths[0]) });
    },

    onStatusFilter(e) {
      const idx = Number(e.detail.value || 0);
      this.setData({
        filterStatusIndex: idx,
        filterStatus: this.data.statusValues[idx],
      });
    },

    onCategoryFilter(e) {
      const idx = Number(e.detail.value || 0);
      this.setData({
        filterCategoryIndex: idx,
        filterCategory: this.data.categoryValues[idx],
      });
    },

    onCustomerKeyword(e) {
      this.setData({ customerKeyword: e.detail.value });
    },

    // 合同条款：使用默认
    async useDefaultTerms() {
      try {
        const result = await store.getDefaultTerms();
        const text = (result && result.contractTerms) || "";
        if (!text) {
          wx.showToast({ title: "暂未设置默认条款", icon: "none" });
          return;
        }
        this.setData({ contractTerms: text });
      } catch (e) {
        wx.showToast({ title: "读取默认条款失败", icon: "none" });
      }
    },

    // 合同条款：清空
    clearTerms() {
      this.setData({ contractTerms: "" });
    },

    // 合同条款：编辑默认
    async editDefaultTerms() {
      try {
        const result = await store.getDefaultTerms();
        this.setData({ termsEditVisible: true, termsEditText: (result && result.contractTerms) || "" });
      } catch (e) {
        this.setData({ termsEditVisible: true, termsEditText: "" });
      }
    },

    hideTermsEdit() {
      this.setData({ termsEditVisible: false });
    },

    onTermsEditInput(e) {
      this.setData({ termsEditText: e.detail.value });
    },

    async saveTermsEdit() {
      try {
        await store.setDefaultTerms(this.data.termsEditText || "");
        this.setData({ termsEditVisible: false });
        wx.showToast({ title: "默认条款已保存", icon: "success" });
      } catch (e) {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    },

    onSubmit() {
      this.setData({ submitting: true });
      this.triggerEvent("submit", {
        scope: this.data.scopeValues[this.data.scopeIndex],
        format: this.data.formatValues[this.data.formatIndex],
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        includeHeader: this.data.includeHeader,
        companyName: this.data.companyName,
        contactPhone: this.data.contactPhone,
        logoFileId: this.data.logoFileId,
        operatorName: this.data.operatorName,
        contractTerms: this.data.contractTerms,
        status: this.data.filterStatus,
        category: this.data.filterCategory,
        customerKeyword: this.data.customerKeyword,
      });
    },

    resetSubmitting() {
      this.setData({ submitting: false });
    },
  },
});
