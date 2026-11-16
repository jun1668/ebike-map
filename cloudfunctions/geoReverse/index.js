/**
 * 经纬度 -> 城市名
 *
 * 用的是腾讯位置服务 WebService API（小程序端 getLocation 拿不到地址文本）：
 * 1. 去 https://lbs.qq.com/dev/console/key/manage 申请 Key，开启 WebService API
 * 2. 在云函数「配置 -> 环境变量」里加 TENCENT_MAP_KEY=你的Key
 * 没配 Key 时本函数返回空对象，前端会自动降级成“已定位 · 附近”，不影响主流程。
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const KEY = process.env.TENCENT_MAP_KEY || ''

function ok(data) {
  return { ok: true, data }
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 6000 }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
  })
}

exports.main = async (event) => {
  const lat = Number(event && event.latitude)
  const lng = Number(event && event.longitude)
  if (!isFinite(lat) || !isFinite(lng)) return ok({})
  if (!KEY) return ok({ configured: false })

  try {
    const url = 'https://apis.map.qq.com/ws/geocoder/v1/?location=' + lat + ',' + lng +
      '&key=' + KEY + '&get_poi=0'
    const data = await request(url)
    if (!data || data.status !== 0) {
      return ok({ configured: true, city: '' })
    }
    const comp = (data.result && data.result.address_component) || {}
    return ok({
      configured: true,
      province: comp.province || '',
      city: comp.city || '',
      district: comp.district || '',
      address: (data.result && data.result.address) || ''
    })
  } catch (err) {
    console.error('[geoReverse] error', err && err.message)
    return ok({ configured: true, city: '' })
  }
}
