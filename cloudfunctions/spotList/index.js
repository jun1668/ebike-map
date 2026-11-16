const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SPOTS = 'spots'
const PAGE_MAX = 50

function ok(data) {
  return { ok: true, data }
}

function fail(code, msg) {
  return { ok: false, code, msg }
}

/** 数据库 GeoPoint -> 前端更省事的 { latitude, longitude } */
function normalize(doc) {
  const out = Object.assign({}, doc)
  if (doc.location && Array.isArray(doc.location.coordinates)) {
    out.location = {
      latitude: doc.location.coordinates[1],
      longitude: doc.location.coordinates[0]
    }
  } else if (doc.latitude && doc.longitude) {
    out.location = { latitude: doc.latitude, longitude: doc.longitude }
  } else {
    out.location = null
  }
  delete out.reporters
  delete out._openid
  return out
}


/** 把一批点位聚合成「城市索引」：每城品牌数 / 区数 / 点位数 */
function buildCityIndex(rows) {
  const map = {}
  rows.forEach((s) => {
    const key = (s.province || '') + '|' + (s.city || '')
    if (!map[key]) {
      map[key] = {
        province: s.province || '',
        city: s.city || '',
        total: 0,
        brandSet: {},
        districtSet: {},
        latestAt: 0
      }
    }
    const c = map[key]
    c.total++
    c.brandSet[s.brandName || s.brand || ''] = 1
    if (s.district) c.districtSet[s.district] = 1
    const t = new Date(s.updatedAt || s.createdAt || 0).getTime() || 0
    if (t > c.latestAt) c.latestAt = t
  })
  return Object.keys(map).map((k) => {
    const c = map[k]
    return {
      province: c.province,
      city: c.city,
      total: c.total,
      brandCount: Object.keys(c.brandSet).filter(Boolean).length,
      districtCount: Object.keys(c.districtSet).length,
      latestAt: c.latestAt
    }
  }).sort((a, b) => b.brandCount - a.brandCount || b.total - a.total)
}

/** 单城市聚合：按品牌分组，带每品牌最新确认时间与代表点位 */
function buildCityDetail(rows, city) {
  const brands = {}
  const districts = {}
  rows.forEach((s) => {
    const name = s.brandName || s.brand || ''
    if (!brands[name]) {
      brands[name] = {
        brand: s.brand,
        brandName: name,
        count: 0,
        latestAt: 0,
        sample: null
      }
    }
    const b = brands[name]
    b.count++
    const t = new Date(s.updatedAt || s.createdAt || 0).getTime() || 0
    if (t > b.latestAt || !b.sample) {
      b.latestAt = t
      b.sample = normalize(s)
    }
    if (s.district) districts[s.district] = 1
  })
  const list = Object.keys(brands).map((k) => brands[k]).sort((a, b) => b.latestAt - a.latestAt)
  return {
    city,
    total: rows.length,
    districtCount: Object.keys(districts).length,
    brandCount: list.length,
    brands: list,
    districts: Object.keys(districts)
  }
}

exports.main = async (event) => {
  const payload = event || {}

  try {
    /* ---------- 城市索引：所有已收录城市 ---------- */
    if (payload.action === 'cities') {
      const MAX = 1000
      const res = await db.collection(SPOTS)
        .where({ status: 'approved' })
        .field({ province: true, city: true, district: true, brand: true, brandName: true, createdAt: true, updatedAt: true })
        .limit(MAX)
        .get()
      const rows = (res.data || []).map((r) => ({ brandName: r.brandName || '', brand: r.brand || '', province: r.province || '', city: r.city || '', district: r.district || '', createdAt: r.createdAt, updatedAt: r.updatedAt }))
      return ok({ list: buildCityIndex(rows), truncated: rows.length >= MAX })
    }

    /* ---------- 单城市聚合 ---------- */
    if (payload.action === 'city') {
      const city = String(payload.city || '').trim().slice(0, 20)
      if (!city) return fail('INVALID', '缺少城市')
      const MAX = 500
      const res = await db.collection(SPOTS)
        .where({ status: 'approved', city })
        .limit(MAX)
        .get()
      const rows = res.data || []
      return ok(buildCityDetail(rows, city))
    }

    /* ---------- 单条详情 ---------- */
    if (payload.id) {
      const res = await db.collection(SPOTS).doc(payload.id).get()
      const doc = res.data
      // 只认同 approved：pending / hidden / rejected / removed 一律不对外
      if (!doc || doc.status !== 'approved') {
        return ok({ list: [], total: 0, hasMore: false })
      }

      // 同城同品牌还有多少人上传过，给详情页一个“不是我一个人”的信号
      let sameCityCount = 1
      try {
        const c = await db.collection(SPOTS)
          .where({
            brand: doc.brand,
            city: doc.city || '',
            status: 'approved'
          })
          .count()
        sameCityCount = Math.max(c.total, 1)
      } catch (e) {
        sameCityCount = 1
      }

      return ok({
        list: [Object.assign(normalize(doc), { sameCityCount })],
        total: 1,
        hasMore: false
      })
    }

    /* ---------- 列表 ---------- */
    const pageSize = Math.min(Math.max(Number(payload.pageSize) || 15, 1), PAGE_MAX)
    const page = Math.max(Number(payload.page) || 0, 0)
    const keyword = String(payload.keyword || '').trim().slice(0, 20)
    const province = String(payload.province || '').trim()
    const brand = String(payload.brand || '').trim()
    const latitude = Number(payload.latitude)
    const longitude = Number(payload.longitude)
    const hasGeo = isFinite(latitude) && isFinite(longitude) && latitude !== 0 && longitude !== 0
    const radius = Math.min(Math.max(Number(payload.radius) || 30000, 1000), 500000)

    // 条件用 _.and 组合；关键词用 _.or 才是云开发支持的写法
    const conds = [{ status: 'approved' }]

    if (province) conds.push({ province })
    if (brand) conds.push({ brand })

    if (keyword) {
      const reg = db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
      conds.push(_.or([
        { brandName: reg },
        { city: reg },
        { province: reg },
        { address: reg }
      ]))
    }

    // geoNear 与关键词检索组合会失效，有关键词时退回普通查询
    const useGeo = hasGeo && !province && !keyword
    if (useGeo) {
      conds.push({
        location: _.geoNear({
          geometry: db.Geo.Point(longitude, latitude),
          maxDistance: radius,
          minDistance: 0
        })
      })
    }

    const where = conds.length === 1 ? conds[0] : _.and(conds)

    let query = db.collection(SPOTS).where(where)
    if (!useGeo) {
      query = query.orderBy('updatedAt', 'desc')
    }

    const res = await query.skip(page * pageSize).limit(pageSize + 1).get()
    const rows = res.data || []
    const hasMore = rows.length > pageSize
    const list = rows.slice(0, pageSize).map(normalize)

    // geoNear 不返回距离，这里顺手算出来，省一次前端循环
    if (useGeo) {
      const R = 6371000
      const rad = (d) => (d * Math.PI) / 180
      list.forEach((item) => {
        if (!item.location) return
        const dLat = rad(item.location.latitude - latitude)
        const dLng = rad(item.location.longitude - longitude)
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(rad(latitude)) * Math.cos(rad(item.location.latitude)) * Math.sin(dLng / 2) ** 2
        item.distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      })
      list.sort((a, b) => (a.distance || 0) - (b.distance || 0))
    }

    let total = list.length + page * pageSize
    try {
      const c = await db.collection(SPOTS).where(where).count()
      total = c.total
    } catch (e) {
      // geoNear 场景下 count 可能不被支持，退回估算值
    }

    return ok({ list, total, hasMore })
  } catch (err) {
    console.error('[spotList] error', err)
    if (err && /not exist|collection/i.test(err.errMsg || '')) {
      return ok({ list: [], total: 0, hasMore: false })
    }
    return fail('DB_ERROR', '查询失败，请稍后再试')
  }
}
