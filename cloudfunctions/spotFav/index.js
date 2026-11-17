/**
 * 收藏云函数
 * action:
 *   toggle  { spotId }            → { fav: true|false }   收藏 / 取消
 *   list    {}                    → { list: [...], total } 我的收藏
 *   remove  { spotId }            → { removed: true }      从收藏里删掉
 *
 * 收藏存的是「快照」：品牌、城市、地址、坐标。这样即使原点位被
 * 下架删除，收藏夹里仍然能看到它，只是标记为「已失效」。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const FAV = 'favorites'
const SPOT = 'spots'
const MAX_FAV = 200

function ok(data) {
  return { ok: true, data: data || {} }
}

function fail(code, msg) {
  return { ok: false, code: code, msg: msg }
}

function normalizePoint(doc) {
  if (doc && doc.location && Array.isArray(doc.location.coordinates)) {
    return {
      latitude: doc.location.coordinates[1],
      longitude: doc.location.coordinates[0]
    }
  }
  if (doc && doc.latitude && doc.longitude) {
    return { latitude: doc.latitude, longitude: doc.longitude }
  }
  return null
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext()
  const openid = ctx.OPENID
  if (!openid) return fail('NO_AUTH', '请在小程序里使用')

  const action = String(event.action || 'list')

  if (action === 'toggle') return await toggle(event, openid)
  if (action === 'list') return await list(openid)
  if (action === 'remove') return await remove(event, openid)

  return fail('INVALID', '不支持的操作')
}

/** 收藏 / 取消收藏 */
async function toggle(event, openid) {
  const spotId = String(event.spotId || '').trim()
  if (!spotId) return fail('INVALID', '缺少 spotId')

  const col = db.collection(FAV)

  let exist = null
  try {
    const res = await col.where({ _openid: openid, spotId: spotId }).limit(1).get()
    exist = res.data && res.data[0]
  } catch (err) {
    // 集合还没建
    if (isNoCollection(err)) return fail('NO_COLLECTION', '收藏功能还没初始化')
    throw err
  }

  if (exist) {
    await col.doc(exist._id).remove()
    return ok({ fav: false })
  }

  const cnt = await col.where({ _openid: openid }).count()
  if (cnt.total >= MAX_FAV) {
    return fail('LIMIT', '收藏到 ' + MAX_FAV + ' 个上限了，先删几个吧')
  }

  let spot = null
  try {
    const doc = await db.collection(SPOT).doc(spotId).get()
    spot = doc.data
  } catch (err) {
    spot = null
  }
  if (!spot || spot.status !== 'approved') {
    return fail('NOT_FOUND', '这个点位已经不存在了')
  }

  const point = normalizePoint(spot)

  await col.add({
    data: {
      _openid: openid,
      spotId: spotId,
      brand: spot.brand || '',
      brandName: spot.brandName || '',
      city: spot.city || '',
      district: spot.district || '',
      province: spot.province || '',
      address: spot.address || '',
      latitude: point ? point.latitude : null,
      longitude: point ? point.longitude : null,
      createdAt: db.serverDate()
    }
  })

  return ok({ fav: true })
}

/** 我的收藏列表，顺便标记原点位是否还在 */
async function list(openid) {
  let rows = []
  try {
    const res = await db.collection(FAV)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(MAX_FAV)
      .get()
    rows = res.data || []
  } catch (err) {
    if (isNoCollection(err)) return ok({ list: [], total: 0 })
    throw err
  }

  if (!rows.length) return ok({ list: [], total: 0 })

  const ids = rows.map((r) => r.spotId).filter(Boolean)
  const alive = {}
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    try {
      const res = await db.collection(SPOT)
        .where({ _id: _.in(batch), status: 'approved' })
        .field({ _id: true })
        .limit(100)
        .get()
      ;(res.data || []).forEach((d) => { alive[d._id] = true })
    } catch (err) {
      // 查不到就当失效，不影响列表展示
    }
  }

  const out = rows.map((r) => ({
    _id: r._id,
    spotId: r.spotId,
    brand: r.brand,
    brandName: r.brandName,
    city: r.city,
    district: r.district,
    province: r.province,
    address: r.address,
    location: (r.latitude && r.longitude) ? { latitude: r.latitude, longitude: r.longitude } : null,
    createdAt: r.createdAt,
    alive: !!alive[r.spotId]
  }))

  return ok({ list: out, total: out.length })
}

/** 从收藏夹移除（点位被删后也能清掉） */
async function remove(event, openid) {
  const spotId = String(event.spotId || '').trim()
  if (!spotId) return fail('INVALID', '缺少 spotId')
  try {
    const res = await db.collection(FAV).where({ _openid: openid, spotId: spotId }).get()
    for (const doc of res.data || []) {
      await db.collection(FAV).doc(doc._id).remove()
    }
  } catch (err) {
    if (!isNoCollection(err)) throw err
  }
  return ok({ removed: true })
}

function isNoCollection(err) {
  const msg = String((err && (err.errMsg || err.message)) || '')
  return msg.indexOf('collection not exists') >= 0 || msg.indexOf('-502005') >= 0
}
