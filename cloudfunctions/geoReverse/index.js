/**
 * 经纬度 -> 城市名
 *
 * 用的是腾讯位置服务 WebService API（小程序端 getLocation 拿不到地址文本）：
 * 1. 去 https://lbs.qq.com/dev/console/key/manage 申请 Key，开启 WebService API
 * 2. 在云函数「配置 -> 环境变量」里加 TENCENT_MAP_KEY=你的Key
 * 没配 Key 时本函数返回空对象，前端会自动降级成“已定位 · 附近”，不影响主流程。
 *
 * 免费 Key 每天有调用上限（超了返回 status 121），所以这里加了进程内缓存：
 * 坐标取到小数点后 2 位（约 1km）作为 key，6 小时内不重复请求，
 * 同一个城市的人打开小程序基本只会打一次腾讯地图。
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 正式环境请在「云函数 -> 函数配置 -> 环境变量」里设置 TENCENT_MAP_KEY，
// 本地调试可以临时把 fallback 填在 || 后面，但不要提交到公开仓库。
const KEY = process.env.TENCENT_MAP_KEY || ''

const CACHE_TTL = 6 * 60 * 60 * 1000
const CACHE_MAX = 500
const cache = new Map()

function cacheKey(lat, lng) {
  return lat.toFixed(2) + ',' + lng.toFixed(2)
}

function cacheGet(k) {
  const hit = cache.get(k)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(k)
    return null
  }
  return hit.data
}

function cacheSet(k, data) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value
    if (first !== undefined) cache.delete(first)
  }
  cache.set(k, { at: Date.now(), data })
}

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

  const ck = cacheKey(lat, lng)
  const cached = cacheGet(ck)
  if (cached) return ok(Object.assign({ cached: true }, cached))

  try {
    const url = 'https://apis.map.qq.com/ws/geocoder/v1/?location=' + lat + ',' + lng +
      '&key=' + KEY + '&get_poi=0'
    const data = await request(url)
    if (!data || data.status !== 0) {
      const status = data && data.status
      const message = (data && data.message) || ''
      console.error('[geoReverse] api error', status, message)
      return ok({ configured: true, city: '', debug: 'API_ERROR', status, message })
    }
    const comp = (data.result && data.result.address_component) || {}
    const payload = {
      configured: true,
      province: comp.province || '',
      city: comp.city || '',
      district: comp.district || '',
      address: (data.result && data.result.address) || ''
    }
    if (payload.city) cacheSet(ck, payload)
    return ok(payload)
  } catch (err) {
    console.error('[geoReverse] error', err && err.message)
    return ok({ configured: true, city: '', debug: 'REQUEST_FAIL', message: String((err && err.message) || err) })
  }
}
