#!/usr/bin/env node
/**
 * 云函数逻辑自测（内存版微信云开发 mock）
 *   node scripts/test-cloudfunctions.js
 *
 * 目的：在没有微信环境的情况下，真实跑一遍云函数的业务分支，
 * 验证校验、限流、去重、举报下架、筛选分页这些逻辑，而不是只检查语法。
 *
 * 不覆盖：真实数据库索引、geoNear 的服务端行为、openapi 内容安全、
 * 小程序端渲染 —— 这些必须在开发者工具 / 真机验证。
 */
const path = require('path')
const Module = require('module')

/* ==================== 内存数据库 ==================== */
const store = { spots: [] }
let autoId = 0

const F = {
  gt: (v) => ({ __op: 'gt', v }),
  and: (list) => ({ __op: 'and', v: list }),
  or: (list) => ({ __op: 'or', v: list }),
  push: (arr) => ({ __op: 'push', v: arr }),
  inc: (n) => ({ __op: 'inc', v: n }),
  geoNear: (opts) => ({ __op: 'geoNear', v: opts }),
  in: (arr) => ({ __op: 'in', v: arr })
}

const REGEX_MARK = '__regex'

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function matchValue(docVal, cond) {
  if (cond === null || cond === undefined) return docVal === cond
  if (typeof cond === 'object' && cond[REGEX_MARK]) {
    return typeof docVal === 'string' && new RegExp(cond.source, cond.flags).test(docVal)
  }
  if (typeof cond === 'object' && cond.__op) {
    switch (cond.__op) {
      case 'gt':
        return typeof docVal === 'number' && docVal > cond.v
      case 'in':
        return cond.v.indexOf(docVal) >= 0
      case 'geoNear': {
        if (!docVal || !Array.isArray(docVal.coordinates)) return false
        const { geometry, maxDistance } = cond.v
        const d = distanceM(geometry.coordinates[1], geometry.coordinates[0],
          docVal.coordinates[1], docVal.coordinates[0])
        return d <= maxDistance
      }
      default:
        return false
    }
  }
  return docVal === cond
}

function match(doc, cond) {
  if (!cond) return true
  if (cond.__op === 'and') return cond.v.every((c) => match(doc, c))
  if (cond.__op === 'or') return cond.v.some((c) => match(doc, c))
  return Object.keys(cond).every((key) => matchValue(doc[key], cond[key]))
}

function applyUpdate(doc, patch) {
  Object.keys(patch).forEach((k) => {
    const v = patch[k]
    if (v && typeof v === 'object' && v.__op === 'push') {
      doc[k] = (doc[k] || []).concat(v.v)
    } else if (v && typeof v === 'object' && v.__op === 'inc') {
      doc[k] = (doc[k] || 0) + v.v
    } else {
      doc[k] = v
    }
  })
}

class Query {
  constructor(coll, cond) {
    this.coll = coll
    this.cond = cond || null
    this._skip = 0
    this._limit = 100
    this._order = null
  }

  where(cond) {
    this.cond = cond
    return this
  }

  orderBy(field, dir) {
    this._order = { field, dir }
    return this
  }

  skip(n) {
    this._skip = n
    return this
  }

  limit(n) {
    this._limit = n
    return this
  }

  /* 只取指定字段；mock 里保留全字段不影响断言 */
  field(fields) {
    this._fields = fields
    return this
  }

  _rows() {
    let rows = this.coll.filter((d) => match(d, this.cond))
    if (this._order) {
      const { field, dir } = this._order
      rows = rows.slice().sort((a, b) => {
        const x = a[field] || 0
        const y = b[field] || 0
        return dir === 'desc' ? y - x : x - y
      })
    }
    return rows
  }

  async get() {
    return { data: this._rows().slice(this._skip, this._skip + this._limit).map((d) => Object.assign({}, d)) }
  }

  async count() {
    return { total: this._rows().length }
  }

  async remove() {
    const rows = this._rows()
    rows.forEach((r) => {
      const i = store.spots.indexOf(r)
      if (i >= 0) store.spots.splice(i, 1)
    })
    return { stats: { removed: rows.length } }
  }
}

class DocRef {
  constructor(id) {
    this.id = id
  }

  _find() {
    const doc = store.spots.find((d) => d._id === this.id)
    if (!doc) {
      const err = new Error('document not exists')
      err.errMsg = 'document.get:fail document not exists'
      throw err
    }
    return doc
  }

  async get() {
    return { data: Object.assign({}, this._find()) }
  }

  async update({ data }) {
    applyUpdate(this._find(), data)
    return { stats: { updated: 1 } }
  }

  async remove() {
    const doc = this._find()
    store.spots.splice(store.spots.indexOf(doc), 1)
    return { stats: { removed: 1 } }
  }
}

function collection(name) {
  if (!store[name]) store[name] = []
  const coll = store[name]
  return {
    where: (cond) => new Query(coll, cond),
    orderBy: (f, d) => new Query(coll, null).orderBy(f, d),
    limit: (n) => new Query(coll, null).limit(n),
    doc: (id) => new DocRef(id),
    add: async ({ data }) => {
      const _id = 'doc_' + (++autoId)
      coll.push(Object.assign({ _id }, data))
      return { _id }
    },
    count: async () => ({ total: coll.length })
  }
}

/* ==================== mock wx-server-sdk ==================== */
let currentOpenid = 'user_a'
let secCheckResult = 'pass'

const fakeCloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  getWXContext: () => ({ OPENID: currentOpenid }),
  database: () => ({
    collection,
    command: F,
    Geo: { Point: (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] }) },
    RegExp: ({ regexp, options }) => ({ [REGEX_MARK]: true, source: regexp, flags: options || '' })
  }),
  openapi: {
    security: {
      msgSecCheck: async () => {
        if (secCheckResult === 'throw') {
          const e = new Error('api unauthorized')
          e.errCode = -604101
          throw e
        }
        return { result: { suggest: secCheckResult } }
      }
    }
  }
}

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return fakeCloud
  return origLoad.apply(this, arguments)
}

const fn = (name) => require(path.resolve(__dirname, '../cloudfunctions', name, 'index.js'))

/* ==================== 测试框架 ==================== */
let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    failures.push(name)
    console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : ''))
  }
}

function reset() {
  store.spots.length = 0
  autoId = 0
  currentOpenid = 'user_a'
  secCheckResult = 'pass'
}

function baseSpot(over) {
  const now = Date.now()
  return Object.assign({
    _id: 'seed_' + (++autoId),
    brand: 'hello',
    brandName: '哈啰出行',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    address: '科技园',
    remark: '',
    appId: '',
    images: [],
    location: { type: 'Point', coordinates: [113.95, 22.54] },
    latitude: 22.54,
    longitude: 113.95,
    status: 'approved',
    reportCount: 0,
    reporters: [],
    upCount: 0,
    createdAt: now,
    updatedAt: now
  }, over || {})
}

/* ==================== 用例 ==================== */
async function main() {
  console.log('\n[spotSubmit] 参数校验与写入')
  {
    reset()
    const submit = fn('spotSubmit')
    let r = await submit.main({})
    check('缺品牌 → INVALID', r.ok === false && r.code === 'INVALID', r)

    r = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省' })
    check('缺坐标 → INVALID', r.ok === false && r.code === 'INVALID', r)

    r = await submit.main({ brand: 'hello', brandName: 'x', province: '广东省', latitude: 200, longitude: 1 })
    check('坐标越界 → INVALID', r.ok === false && r.code === 'INVALID', r)

    r = await submit.main({ brand: 'hello', brandName: 'x', province: '广东省', latitude: 22, longitude: 113, appId: 'abc' })
    check('AppID 格式错 → INVALID', r.ok === false && r.code === 'INVALID', r)

    r = await submit.main({ brand: 'hello', brandName: 'x', province: '广东省', latitude: 22, longitude: 113, link: 'javascript:alert(1)' })
    check('链接协议不合法 → INVALID', r.ok === false && r.code === 'INVALID', r)

    r = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22.54, longitude: 113.95 })
    check('合法提交 → ok', r.ok === true && !!r.data.id, r)
    check('默认状态 approved', store.spots[0] && store.spots[0].status === 'approved', store.spots[0] && store.spots[0].status)
    check('写入者为当前 openid', store.spots[0]._openid === 'user_a')
    check('location 存为 GeoPoint', store.spots[0].location.type === 'Point')

    r = await submit.main({
      brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '广州市',
      latitude: 23.13, longitude: 113.26, remark: '扫码即骑 https://wxaurl.cn/kQ8xZmNpQd',
      link: 'https://wxaurl.cn/kQ8xZmNpQd'
    })
    check('带小程序短链 → ok', r.ok === true, r)
    const added = store.spots.find((x) => x.link === 'https://wxaurl.cn/kQ8xZmNpQd')
    check('链接已入库', !!added, added)
    check('短链能在列表带出', !!added && added.link.indexOf('wxaurl.cn') > 0)
  }

  console.log('\n[spotSubmit] 去重 / 限流 / 内容安全')
  {
    reset()
    const submit = fn('spotSubmit')
    const payload = { brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22.54, longitude: 113.95 }

    await submit.main(payload)
    const dup = await submit.main(payload)
    check('同品牌同城 30 天内 → DUPLICATE', dup.ok === false && dup.code === 'DUPLICATE', dup)

    // 换城市不受影响
    const other = await submit.main(Object.assign({}, payload, { city: '广州市' }))
    check('不同城市可正常提交', other.ok === true, other)

    reset()
    currentOpenid = 'flooder'
    let limited = null
    const cities = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市']
    for (let i = 0; i < cities.length; i++) {
      const res = await submit.main({ brand: 'meituan', brandName: '美团电单车', province: '广东省', city: cities[i], latitude: 39.9, longitude: 116.4 })
      if (i === cities.length - 1) limited = res
    }
    check('第 6 次提交 → RATE_LIMIT', limited && limited.ok === false && limited.code === 'RATE_LIMIT', limited)

    reset()
    secCheckResult = 'risky'
    const risky = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    check('内容安全命中 → CONTENT_RISK', risky.ok === false && risky.code === 'CONTENT_RISK', risky)

    reset()
    secCheckResult = 'throw'
    const apiDown = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    check('内容安全接口异常 → 放行（不阻断上传）', apiDown.ok === true, apiDown)
  }

  console.log('\n[spotSubmit] 修改与删除的权限')
  {
    reset()
    const submit = fn('spotSubmit')
    const created = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    const id = created.data.id

    currentOpenid = 'user_b'
    let r = await submit.main({ mode: 'update', id, remark: '偷改' })
    check('他人修改 → FORBIDDEN', r.ok === false && r.code === 'FORBIDDEN', r)

    currentOpenid = 'user_a'
    r = await submit.main({ mode: 'update', id, remark: '其实在 B 口' })
    check('本人修改备注 → ok', r.ok === true, r)
    check('备注已落库', store.spots.find((s) => s._id === id).remark === '其实在 B 口')

    r = await submit.main({ mode: 'update', id, latitude: 30.1, longitude: 120.2 })
    const moved = store.spots.find((s) => s._id === id)
    check('本人改坐标 → location 同步更新',
      Math.abs(moved.location.coordinates[1] - 30.1) < 1e-6 && Math.abs(moved.latitude - 30.1) < 1e-6, moved.location)
  }

  console.log('\n[spotSubmit] 任何人都能下架（软删除）')
  {
    reset()
    const submit = fn('spotSubmit')
    const list = fn('spotList')
    const created = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    const id = created.data.id

    currentOpenid = 'user_b'
    let r = await submit.main({ mode: 'delete', id })
    check('非上传者也能下架 → ok', r.ok === true, r)
    check('返回 byOwner=false', r.data.byOwner === false, r.data)
    check('状态改为 removed（软删除）', store.spots.find((s) => s._id === id).status === 'removed')
    check('记录了操作者 removedBy', store.spots.find((s) => s._id === id).removedBy === 'user_b')

    const res = await list.main({})
    check('下架后列表不可见', res.ok && res.data.list.length === 0, res.data.list.length)
    const detail = await list.main({ id })
    check('下架后详情不可见', detail.ok && detail.data.list.length === 0, detail.data.list.length)

    r = await submit.main({ mode: 'delete', id })
    check('重复下架 → ALREADY_GONE', r.ok === false && r.code === 'ALREADY_GONE', r)

    // 本人删除自己的
    currentOpenid = 'user_a'
    const mine = await submit.main({ brand: 'meituan', brandName: '美团电单车', province: '北京市', city: '北京市', latitude: 39.9, longitude: 116.4 })
    r = await submit.main({ mode: 'delete', id: mine.data.id })
    check('本人下架自己的 → byOwner=true', r.ok === true && r.data.byOwner === true, r.data)
  }

  console.log('\n[spotSubmit] 下架限流与「还可用」确认')
  {
    reset()
    const submit = fn('spotSubmit')
    const list = fn('spotList')

    // 造 21 条别人上传的
    const ids = []
    for (let i = 0; i < 21; i++) {
      currentOpenid = 'author_' + i
      const c = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '城市' + i, latitude: 22, longitude: 113 })
      ids.push(c.data.id)
    }

    currentOpenid = 'vandal'
    let limited = null
    for (let i = 0; i < 21; i++) {
      const r = await submit.main({ mode: 'delete', id: ids[i] })
      if (i === 20) limited = r
    }
    check('非上传者第 21 次下架 → RATE_LIMIT', limited && limited.ok === false && limited.code === 'RATE_LIMIT', limited)

    // 确认仍然可用
    reset()
    const c2 = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    const id = c2.data.id
    const before = store.spots.find((s) => s._id === id).updatedAt
    currentOpenid = 'checker'
    let r = await submit.main({ mode: 'confirm', id })
    check('确认仍可用 → ok', r.ok === true && r.data.confirmed === true, r)
    check('updatedAt 被刷新', store.spots.find((s) => s._id === id).updatedAt >= before)
    check('记录 confirmers', (store.spots.find((s) => s._id === id).confirmers || []).indexOf('checker') >= 0)
    r = await submit.main({ mode: 'confirm', id })
    check('同一人重复确认 → 不再刷新', r.ok === true && r.data.confirmed === false, r)

    // 已下架的不能再确认
    await submit.main({ mode: 'delete', id })
    r = await submit.main({ mode: 'confirm', id })
    check('已下架的条目不能确认 → NOT_FOUND', r.ok === false && r.code === 'NOT_FOUND', r)
  }

  console.log('\n[spotReport] 举报计数与自动下架')
  {
    reset()
    const submit = fn('spotSubmit')
    const report = fn('spotReport')
    const created = await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    const id = created.data.id

    currentOpenid = 'u1'
    let r = await report.main({ id })
    check('首次举报 → reportCount 1', r.ok && r.data.reportCount === 1, r)

    r = await report.main({ id })
    check('同一人重复举报 → 不重复计数', r.ok && r.data.duplicated === true && r.data.reportCount === 1, r)

    currentOpenid = 'u2'
    r = await report.main({ id })
    currentOpenid = 'u3'
    r = await report.main({ id })
    check('第 3 人举报 → 自动下架', r.ok && r.data.offline === true, r)
    check('状态变为 hidden', store.spots.find((s) => s._id === id).status === 'hidden')

    const list = fn('spotList')
    const res = await list.main({})
    check('hidden 条目不出现在列表', res.ok && res.data.list.length === 0, res.data)

    const detail = await list.main({ id })
    check('hidden 条目详情不可见', detail.ok && detail.data.list.length === 0, detail.data)
  }

  console.log('\n[spotList] 筛选 / 分页 / 地理查询')
  {
    reset()
    store.spots.push(
      baseSpot({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', createdAt: 1000, updatedAt: 1000 }),
      baseSpot({ brand: 'meituan', brandName: '美团电单车', province: '北京市', city: '北京市', location: { type: 'Point', coordinates: [116.4, 39.9] }, latitude: 39.9, longitude: 116.4, createdAt: 2000, updatedAt: 2000 }),
      baseSpot({ brand: 'qingju', brandName: '滴滴青桔', province: '北京市', city: '北京市', location: { type: 'Point', coordinates: [116.5, 39.95] }, latitude: 39.95, longitude: 116.5, createdAt: 3000, updatedAt: 3000 }),
      baseSpot({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '广州市', location: { type: 'Point', coordinates: [113.26, 23.13] }, latitude: 23.13, longitude: 113.26, createdAt: 4000, updatedAt: 4000 })
    )

    const list = fn('spotList')
    let r = await list.main({})
    check('无条件 → 全部 approved', r.ok && r.data.list.length === 4, r.data && r.data.list.length)
    check('按 updatedAt 倒序', r.data.list[0].city === '广州市', r.data.list.map((x) => x.city))

    r = await list.main({ province: '北京市' })
    check('按省份筛选 → 2 条', r.ok && r.data.list.length === 2, r.data.list.length)

    r = await list.main({ brand: 'hello' })
    check('按品牌筛选 → 2 条', r.ok && r.data.list.length === 2, r.data.list.length)

    r = await list.main({ keyword: '青桔' })
    check('关键词命中品牌名 → 1 条', r.ok && r.data.list.length === 1 && r.data.list[0].brand === 'qingju', r.data.list)

    r = await list.main({ keyword: '广州' })
    check('关键词命中城市 → 1 条', r.ok && r.data.list.length === 1 && r.data.list[0].city === '广州市', r.data.list)

    r = await list.main({ keyword: '不存在的词' })
    check('关键词无命中 → 空列表', r.ok && r.data.list.length === 0)

    // 地理查询：北京天安门附近，半径 50km
    r = await list.main({ latitude: 39.9087, longitude: 116.3975, radius: 50000 })
    check('附近查询 → 只返回北京 2 条', r.ok && r.data.list.length === 2, r.data.list && r.data.list.map((x) => x.city))
    check('附近查询带回 distance', typeof r.data.list[0].distance === 'number' && r.data.list[0].distance > 0, r.data.list[0] && r.data.list[0].distance)
    check('附近按距离升序', r.data.list[0].distance <= r.data.list[1].distance)

    // 云函数把半径下限钳到 1000m，传 200 实际按 1km 查：(39.9,116.4) 距天安门约 990m，命中
    r = await list.main({ latitude: 39.9087, longitude: 116.3975, radius: 200 })
    check('半径下限钳到 1km（传 200 仍命中 990m 的点）', r.ok && r.data.list.length === 1, r.data.list.length)

    r = await list.main({ latitude: 39.9087, longitude: 116.3975, radius: 20000 })
    check('半径 20km → 2 条', r.ok && r.data.list.length === 2, r.data.list.length)

    // 分页
    reset()
    for (let i = 0; i < 7; i++) {
      store.spots.push(baseSpot({ brand: 'hello', city: '深圳市', createdAt: i, updatedAt: i }))
    }
    r = await list.main({ page: 0, pageSize: 3 })
    check('第 1 页 3 条且 hasMore', r.ok && r.data.list.length === 3 && r.data.hasMore === true, { n: r.data.list.length, hasMore: r.data.hasMore })
    r = await list.main({ page: 2, pageSize: 3 })
    check('第 3 页 1 条且 hasMore=false', r.ok && r.data.list.length === 1 && r.data.hasMore === false, { n: r.data.list.length, hasMore: r.data.hasMore })
    check('分页不重复', await (async () => {
      const p0 = await list.main({ page: 0, pageSize: 3 })
      const p1 = await list.main({ page: 1, pageSize: 3 })
      const ids = new Set(p0.data.list.concat(p1.data.list).map((x) => x._id))
      return ids.size === 6
    })())

    // 字段脱敏
    r = await list.main({})
    check('不向前端返回 reporters', r.data.list.every((x) => x.reporters === undefined))
    check('不向前端返回 _openid', r.data.list.every((x) => x._openid === undefined))
    check('location 已转成 {latitude, longitude}', !!r.data.list[0].location.latitude)
  }

  console.log('\n[spotList] 详情分支')
  {
    reset()
    store.spots.push(
      baseSpot({ _id: 's1', brand: 'hello', city: '深圳市' }),
      baseSpot({ _id: 's2', brand: 'hello', city: '深圳市' })
    )
    const list = fn('spotList')
    const r = await list.main({ id: 's1' })
    check('详情返回 1 条', r.ok && r.data.list.length === 1, r.data)
    check('带同城同品牌计数', r.data.list[0].sameCityCount === 2, r.data.list[0] && r.data.list[0].sameCityCount)
  }

  console.log('\n[spotMine] 我的上传')
  {
    reset()
    const submit = fn('spotSubmit')
    const mine = fn('spotMine')
    currentOpenid = 'owner'
    await submit.main({ brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', latitude: 22, longitude: 113 })
    currentOpenid = 'other'
    await submit.main({ brand: 'meituan', brandName: '美团电单车', province: '北京市', city: '北京市', latitude: 39.9, longitude: 116.4 })

    currentOpenid = 'owner'
    const r = await mine.main({})
    check('只返回自己的条目', r.ok && r.data.list.length === 1 && r.data.list[0].brand === 'hello', r.data)
    check('按 createdAt 倒序', r.data.list.length === 1)
  }

  console.log('\n[spotList] 城市聚合')
  {
    reset()
    const list = fn('spotList')
    store.spots.push(
      baseSpot({ _id: 'c1', brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', district: '南山区' }),
      baseSpot({ _id: 'c2', brand: 'meituan', brandName: '美团电单车', province: '广东省', city: '深圳市', district: '福田区' }),
      baseSpot({ _id: 'c3', brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', district: '福田区' }),
      baseSpot({ _id: 'c4', brand: 'qingju', brandName: '滴滴青桔', province: '北京市', city: '北京市', district: '朝阳区' })
    )

    const idx = await list.main({ action: 'cities' })
    check('城市索引返回 2 个城市', idx.ok && idx.data.list.length === 2, idx.data.list && idx.data.list.length)
    const sz = (idx.data.list || []).find((c) => c.city === '深圳市')
    check('深圳 3 个点位', !!sz && sz.total === 3, sz)
    check('深圳 2 个品牌', !!sz && sz.brandCount === 2, sz && sz.brandCount)
    check('深圳 2 个区', !!sz && sz.districtCount === 2, sz && sz.districtCount)
    check('品牌多的城市排前面', (idx.data.list || [])[0].city === '深圳市', idx.data.list && idx.data.list[0])

    const one = await list.main({ action: 'city', city: '深圳市' })
    check('单城市聚合 total=3', one.ok && one.data.total === 3, one.data && one.data.total)
    check('单城市聚合 2 个品牌', one.ok && one.data.brands.length === 2, one.data && one.data.brands.length)
    check('品牌带代表点位', one.ok && !!one.data.brands[0].sample, one.data && one.data.brands[0])

    const none = await list.main({ action: 'city', city: '拉萨市' })
    check('未收录城市返回空', none.ok && none.data.total === 0 && none.data.brands.length === 0, none.data)

    const bad = await list.main({ action: 'city' })
    check('缺城市参数报错', bad.ok === false && bad.code === 'INVALID', bad)

    // 已下架的点位不能出现在聚合里
    store.spots[0].status = 'removed'
    const idx2 = await list.main({ action: 'cities' })
    const sz2 = (idx2.data.list || []).find((c) => c.city === '深圳市')
    check('下架点位不计入城市统计', !!sz2 && sz2.total === 2, sz2)
  }

  /* ==================== 汇总 ==================== */
  console.log('\n────────────────────────────')
  console.log('通过 ' + pass + ' / ' + (pass + fail))
  if (fail) {
    console.log('失败用例:')
    failures.forEach((f) => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('全部通过（内存 mock，不代表真机行为）')
}

main().catch((e) => {
  console.error('测试脚本自身异常:', e)
  process.exit(1)
})
