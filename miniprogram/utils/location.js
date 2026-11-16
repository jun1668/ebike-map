/**
 * 定位与隐私授权封装
 */

/** 读取授权状态 */
function getSetting() {
  return new Promise((resolve, reject) => {
    wx.getSetting({ success: resolve, fail: reject })
  })
}

/**
 * 隐私协议授权（基础库 2.32.3+ 必走）
 * 未同意《用户隐私保护指引》时，getLocation 会直接失败
 */
function requirePrivacy() {
  return new Promise((resolve) => {
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      resolve(true)
      return
    }
    wx.requirePrivacyAuthorize({
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/** 精确到城市级别的定位，坐标系 gcj02（与 map 组件一致） */
function getLocation(options) {
  const opts = options || {}
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 确保拿到定位权限，返回 { latitude, longitude }
 * 用户曾拒绝过则引导到设置页开启
 */
async function ensureLocation() {
  const privacyOk = await requirePrivacy()
  if (!privacyOk) {
    const err = new Error('需要同意隐私协议才能定位')
    err.code = 'PRIVACY_DENIED'
    throw err
  }

  const setting = await getSetting()
  const authed = setting && setting.authSetting && setting.authSetting['scope.userLocation'] === true

  if (!authed) {
    try {
      await new Promise((resolve, reject) => {
        wx.authorize({ scope: 'scope.userLocation', success: resolve, fail: reject })
      })
    } catch (e) {
      const err = new Error('未获得定位权限')
      err.code = 'AUTH_DENIED'
      throw err
    }
  }

  const res = await getLocation()
  return { latitude: res.latitude, longitude: res.longitude }
}

/** 地图选点，用于上传时确认位置 */
function chooseLocation() {
  return new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: resolve,
      fail: (err) => {
        err.code = 'CHOOSE_CANCELLED'
        reject(err)
      }
    })
  })
}

/** 引导用户打开设置页重新授权定位 */
function openLocationSetting() {
  return new Promise((resolve) => {
    wx.openSetting({
      success: (res) => resolve(!!(res.authSetting && res.authSetting['scope.userLocation'])),
      fail: () => resolve(false)
    })
  })
}

module.exports = {
  getSetting,
  requirePrivacy,
  getLocation,
  ensureLocation,
  chooseLocation,
  openLocationSetting
}
