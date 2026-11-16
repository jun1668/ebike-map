/**
 * 云函数调用封装：云函数统一返回 { ok, code, msg, data }
 */
const CONFIG = require('./config')

function envConfigured() {
  return !!(CONFIG.cloudEnv && CONFIG.cloudEnv.indexOf('YOUR_') !== 0)
}

function call(name, data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持云开发'))
      return
    }

    const params = {
      name,
      data: data || {},
      success: (res) => {
        const r = (res && res.result) || {}
        if (r.ok) {
          resolve(r.data)
        } else {
          const err = new Error(r.msg || '服务暂时不可用')
          err.code = r.code || 'SERVER_ERROR'
          reject(err)
        }
      },
      fail: (err) => {
        const e = new Error((err && err.errMsg) || '网络异常，请稍后重试')
        e.code = 'NETWORK_ERROR'
        reject(e)
      }
    }
    if (envConfigured()) params.config = { env: CONFIG.cloudEnv }

    wx.cloud.callFunction(params)
  })
}

/** 带 loading 的调用 */
async function callWithLoading(name, data, title) {
  wx.showLoading({ title: title || '加载中', mask: true })
  try {
    return await call(name, data)
  } finally {
    wx.hideLoading()
  }
}

function toastError(err) {
  const msg = (err && err.message) || '操作失败'
  wx.showToast({
    title: msg.length > 16 ? msg.slice(0, 15) + '…' : msg,
    icon: 'none',
    duration: 2200
  })
}

module.exports = { call, callWithLoading, toastError }
