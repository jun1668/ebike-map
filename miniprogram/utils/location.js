/**
 * 定位与隐私授权封装
 *
 * 微信对精确定位（wx.getLocation）管得很严，只有「出行 / 外卖 / 导航 / 运动」
 * 这类类目才能申请到，工具类小程序通常只批模糊定位（wx.getFuzzyLocation，
 * 精度约 5km）。所以这里做三级降级：
 *
 *   1. wx.getLocation      精确位置，能算距离
 *   2. wx.getFuzzyLocation 模糊位置，只能按范围筛，不显示距离
 *   3. 都没有              抛错，由页面引导用户按省份 / 城市查找
 *
 * ensureLocation 返回 { latitude, longitude, precise }，precise 为 false 时
 * 调用方不要再算距离、也不要把半径设得太小。
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

/** 主动申请定位授权，返回是否同意 */
function tryAuthorize() {
  return new Promise((resolve) => {
    if (typeof wx.authorize !== 'function') {
      resolve(false)
      return
    }
    wx.authorize({
      scope: 'scope.userLocation',
      success: () => resolve(true),
      fail: () => resolve(false)
    })
  })
}

/** 精确定位，坐标系 gcj02（与 map 组件一致） */
function getLocation(options) {
  const opts = options || {}
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: !!opts.highAccuracy,
      highAccuracyExpireTime: 4000,
      success: resolve,
      fail: reject
    })
  })
}

/** 模糊定位，城市级别；接口未获批或基础库太旧时 reject */
function getFuzzyLocation() {
  return new Promise((resolve, reject) => {
    if (typeof wx.getFuzzyLocation !== 'function') {
      const err = new Error('当前基础库不支持模糊定位')
      err.code = 'NO_FUZZY'
      reject(err)
      return
    }
    wx.getFuzzyLocation({
      type: 'gcj02',
      success: resolve,
      fail: reject
    })
  })
}

/**
 * 确保拿到一个可用的位置，返回 { latitude, longitude, precise }
 * precise === true  精确定位
 * precise === false 模糊定位（只能筛范围，不要算距离）
 */
async function ensureLocation() {
  const privacyOk = await requirePrivacy()
  if (!privacyOk) {
    const err = new Error('需要同意隐私协议才能定位')
    err.code = 'PRIVACY_DENIED'
    throw err
  }

  const setting = await getSetting().catch(() => null)
  const authState = setting && setting.authSetting
    ? setting.authSetting['scope.userLocation']
    : undefined

  // 从没问过 → 主动弹一次授权
  if (authState === undefined) {
    const ok = await tryAuthorize()
    if (!ok) {
      const err = new Error('未获得定位权限')
      err.code = 'AUTH_DENIED'
      throw err
    }
  }

  // 第一级：精确定位
  try {
    const res = await getLocation({ highAccuracy: true })
    if (res && typeof res.latitude === 'number') {
      return { latitude: res.latitude, longitude: res.longitude, precise: true }
    }
  } catch (e) {
    // 未获批或用户拒绝，继续降级
  }

  // 第二级：模糊定位
  try {
    const res = await getFuzzyLocation()
    if (res && typeof res.latitude === 'number') {
      return { latitude: res.latitude, longitude: res.longitude, precise: false }
    }
  } catch (e) {
    // 也失败，继续往下
  }

  const denied = authState === false
  const err = new Error(denied ? '未获得定位权限' : '定位不可用')
  err.code = denied ? 'AUTH_DENIED' : 'NO_LOCATION'
  throw err
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
  tryAuthorize,
  getLocation,
  getFuzzyLocation,
  ensureLocation,
  chooseLocation,
  openLocationSetting
}
