const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SPOTS = 'spots'

// 新上传是否需要人工审核（false = 内容安全通过即上线，配合举报下架）
const NEED_REVIEW = false
// 同一用户 10 分钟内最多提交条数
const RATE_LIMIT_COUNT = 5
const RATE_LIMIT_WINDOW = 10 * 60 * 1000
// 同一品牌在同一城市已有收录，多少天内不重复新增
const DUP_WINDOW = 30 * 24 * 60 * 60 * 1000
// 非上传者下架他人条目：每天最多条数（防止一次被清空）
const REMOVE_DAILY_LIMIT = 20

function ok(data) {
  return { ok: true, data }
}

function fail(code, msg) {
  return { ok: false, code, msg }
}

/**
 * 内容安全检测（微信官方接口）
 * 命中违规返回 false；接口异常放行并记录，避免整站无法上传
 */
async function securityPass(content, openid) {
  const text = String(content || '').trim()
  if (!text) return true
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 2,
      openid
    })
    const suggest = res && res.result && res.result.suggest
    if (suggest) return suggest === 'pass'
    return true
  } catch (err) {
    const msg = (err && (err.errMsg || err.message)) || ''
    if (String(err && err.errCode) === '87014' || msg.indexOf('87014') >= 0) {
      return false
    }
    console.warn('[spotSubmit] msgSecCheck unavailable:', msg)
    return true
  }
}

function clampNum(v, min, max, fallback) {
  const n = Number(v)
  if (!isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/* ------------------------- 新建 ------------------------- */
async function create(event, openid) {
  const brand = String(event.brand || '').trim()
  const brandName = String(event.brandName || '').trim().slice(0, 20)
  const remark = String(event.remark || '').trim().slice(0, 120)
  const address = String(event.address || '').trim().slice(0, 60)
  const province = String(event.province || '').trim().slice(0, 20)
  const city = String(event.city || '').trim().slice(0, 20)
  const district = String(event.district || '').trim().slice(0, 20)
  const appId = String(event.appId || '').trim()
  const images = Array.isArray(event.images) ? event.images.filter((s) => typeof s === 'string').slice(0, 3) : []
  const link = String(event.link || '').trim().slice(0, 200)

  if (!brand) return fail('INVALID', '请选择品牌')
  if (!brandName) return fail('INVALID', '请填写品牌名称')
  if (!province) return fail('INVALID', '请选择省市')

  const latitude = Number(event.latitude)
  const longitude = Number(event.longitude)
  if (!isFinite(latitude) || !isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return fail('INVALID', '位置不合法，请重新定位')
  }
  if (appId && !/^wx[0-9a-zA-Z]{16}$/.test(appId)) {
    return fail('INVALID', 'AppID 格式不对')
  }
  if (link && !/^(https?:\/\/|#小程序:\/\/)/.test(link)) {
    return fail('INVALID', '链接格式不对，应以 http(s):// 或 #小程序:// 开头')
  }
  if (brand === 'other' && !brandName) {
    return fail('INVALID', '请填写品牌名称')
  }

  // 限流
  const now = Date.now()
  const recent = await db.collection(SPOTS)
    .where({ _openid: openid, createdAt: _.gt(now - RATE_LIMIT_WINDOW) })
    .count()
  if (recent.total >= RATE_LIMIT_COUNT) {
    return fail('RATE_LIMIT', '提交太频繁了，休息一会儿再来')
  }

  // 内容安全
  const pass = await securityPass([brandName, remark, address, link].join(' '), openid)
  if (!pass) {
    return fail('CONTENT_RISK', '内容包含不适宜信息，请修改后再提交')
  }

  // 去重：同品牌同城市近期已有收录
  const dup = await db.collection(SPOTS)
    .where({
      brand,
      city,
      status: 'approved',
      createdAt: _.gt(now - DUP_WINDOW)
    })
    .limit(1)
    .get()
  if (dup.data && dup.data.length) {
    return fail('DUPLICATE', '这个品牌该城市已经有人传过了，你可以补个更准确的位置')
  }

  const doc = {
    brand,
    brandName,
    province,
    city,
    district,
    address,
    remark,
    appId,
    link,
    images,
    location: db.Geo.Point(longitude, latitude),
    latitude,
    longitude,
    status: NEED_REVIEW ? 'pending' : 'approved',
    reportCount: 0,
    reporters: [],
    upCount: 0,
    _openid: openid,
    createdAt: now,
    updatedAt: now
  }

  const res = await db.collection(SPOTS).add({ data: doc })
  return ok({ id: res._id, status: doc.status })
}

/* ------------------------- 修改 ------------------------- */
async function update(event, openid) {
  const id = String(event.id || '')
  if (!id) return fail('INVALID', '缺少要修改的条目')

  const doc = await db.collection(SPOTS).doc(id).get().catch(() => null)
  if (!doc || !doc.data) return fail('NOT_FOUND', '这条信息不存在')
  if (doc.data._openid !== openid) return fail('FORBIDDEN', '只能修改自己上传的内容')

  const patch = { updatedAt: Date.now() }

  if (typeof event.remark === 'string') {
    const remark = event.remark.trim().slice(0, 120)
    const pass = await securityPass(remark, openid)
    if (!pass) return fail('CONTENT_RISK', '内容包含不适宜信息')
    patch.remark = remark
  }
  if (typeof event.address === 'string') {
    patch.address = event.address.trim().slice(0, 60)
  }
  if (typeof event.link === 'string') {
    const link = event.link.trim().slice(0, 200)
    if (link && !/^(https?:\/\/|#小程序:\/\/)/.test(link)) {
      return fail('INVALID', '链接格式不对，应以 http(s):// 或 #小程序:// 开头')
    }
    patch.link = link
  }
  if (isFinite(Number(event.latitude)) && isFinite(Number(event.longitude))) {
    const lat = Number(event.latitude)
    const lng = Number(event.longitude)
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail('INVALID', '位置不合法')
    patch.latitude = lat
    patch.longitude = lng
    patch.location = db.Geo.Point(lng, lat)
  }

  await db.collection(SPOTS).doc(id).update({ data: patch })
  return ok({ id })
}

/* ------------------------- 确认仍然可用 ------------------------- */
async function touch(event, openid) {
  const id = String(event.id || '')
  if (!id) return fail('INVALID', '缺少条目')

  const doc = await db.collection(SPOTS).doc(id).get().catch(() => null)
  if (!doc || !doc.data) return fail('NOT_FOUND', '这条信息不存在')
  if (doc.data.status !== 'approved') return fail('NOT_FOUND', '这条已经不在线上了')

  const confirmers = Array.isArray(doc.data.confirmers) ? doc.data.confirmers : []
  if (confirmers.indexOf(openid) >= 0) {
    return ok({ id, confirmed: false, msg: '你已经确认过了' })
  }

  await db.collection(SPOTS).doc(id).update({
    data: {
      updatedAt: Date.now(),
      confirmedAt: Date.now(),
      confirmers: _.push([openid])
    }
  })
  return ok({ id, confirmed: true })
}

/* ------------------------- 下架 / 删除 ------------------------- */
/**
 * 任何人都可以下架（删除）一条信息，但必须明确「已经下架」。
 * 采用软删除：status 改为 removed，保留记录便于申诉与恢复，列表接口不再返回。
 * 非上传者有每日上限，避免一次被恶意清空。
 */
async function remove(event, openid) {
  const id = String(event.id || '')
  if (!id) return fail('INVALID', '缺少要删除的条目')

  const doc = await db.collection(SPOTS).doc(id).get().catch(() => null)
  if (!doc || !doc.data) return fail('NOT_FOUND', '这条信息不存在')

  const spot = doc.data
  const isOwner = spot._openid === openid

  if (spot.status === 'removed') return fail('ALREADY_GONE', '这条已经删除了')

  if (!isOwner) {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const res = await db.collection(SPOTS)
      .where({ status: 'removed', removedBy: openid, removedAt: _.gt(since) })
      .count()
    if ((res && res.total) >= REMOVE_DAILY_LIMIT) {
      return fail('RATE_LIMIT', '今天下架的条数有点多，明天再来吧')
    }
  }

  await db.collection(SPOTS).doc(id).update({
    data: {
      status: 'removed',
      removedAt: Date.now(),
      removedBy: openid,
      removedByOwner: isOwner,
      updatedAt: Date.now()
    }
  })

  return ok({ id, status: 'removed', byOwner: isOwner })
}

exports.main = async (event) => {
  const payload = event || {}
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) return fail('NO_AUTH', '请在小程序内使用')

  try {
    const mode = payload.mode || 'create'
    if (mode === 'update') return await update(payload, openid)
    if (mode === 'delete') return await remove(payload, openid)
    if (mode === 'confirm') return await touch(payload, openid)
    return await create(payload, openid)
  } catch (err) {
    console.error('[spotSubmit] error', err)
    const msg = (err && err.errMsg) || ''
    if (/duplicate|E11000/.test(msg)) return fail('DUPLICATE', '这个位置已经收录过了')
    return fail('SERVER_ERROR', '提交失败，请稍后重试')
  }
}
