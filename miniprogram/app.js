const CONFIG = require('./utils/config')
const location = require('./utils/location')

App({
  globalData: {
    openid: '',
    // 用户当前位置 { latitude, longitude }
    location: null,
    // 定位得到或用户手选的省市
    province: '',
    city: '',
    // 云开发是否可用
    cloudReady: false
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('[app] 基础库过低，请使用 2.2.3 及以上版本以使用云开发')
      return
    }
    // 没填环境 ID 时退回默认环境，避免一启动就报错
    const env = CONFIG.cloudEnv && CONFIG.cloudEnv.indexOf('YOUR_') !== 0 ? CONFIG.cloudEnv : ''
    if (!env) {
      console.warn('[app] 未配置 cloudEnv，请在 utils/config.js 填写云开发环境 ID')
    }
    wx.cloud.init(env ? { env, traceUser: true } : { traceUser: true })
    this.globalData.cloudReady = true

    // 静默尝试一次定位，失败不打扰用户
    this.silentLocate()
  },

  /**
   * 静默定位：只在用户已授权过的情况下直接拿结果。
   * 未授权时不弹窗，等用户主动点“定位”再申请。
   */
  silentLocate() {
    location.getSetting()
      .then((setting) => {
        const authed = setting && setting.authSetting && setting.authSetting['scope.userLocation']
        if (!authed) return null
        return location.getLocation()
      })
      .then((res) => {
        if (!res) return
        this.globalData.location = { latitude: res.latitude, longitude: res.longitude }
        if (typeof this.onLocationReady === 'function') {
          this.onLocationReady(this.globalData.location)
        }
      })
      .catch(() => {})
  }
})
