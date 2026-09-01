const store = require("./utils/store");

App({
  onLaunch() {
    store.initCloud();
    store.bootstrap()
      .then(() => store.migrateLocalData())
      .then(() => store.ensureSeedData())
      .catch((e) => {
        console.error("初始化云端数据失败", e);
        wx.showModal({
          title: "云端连接失败",
          content: e.message || "请确认 warehouse 云函数已上传部署，并且云环境 ID 正确。",
          showCancel: false,
        });
      });
  },
});
