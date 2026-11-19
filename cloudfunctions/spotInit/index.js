/**
 * 一次性初始化脚本
 *
 * 在云开发控制台 -> 云函数 -> spotInit -> 云端测试，传入：
 *   { "action": "init" }      建集合（已存在则跳过）
 *   { "action": "seed" }      写入示例数据，方便先看到效果
 *   { "action": "clearSeed" } 删掉所有示例数据（正式上线前建议执行）
 *   { "action": "stats" }     看当前数据量
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SPOTS = 'spots'

function ok(data) {
  return { ok: true, data }
}

// 示例数据：仅用于首次预览效果，正式运营前请按真实投放情况替换
const SEED = [
  { brand: 'meituan', brandName: '美团电单车', province: '广东省', city: '深圳市', district: '南山区', address: '科技园地铁站 A 出口', lat: 22.5405, lng: 113.9545, remark: '地铁口一排，扫码即骑' },
  { brand: 'hello', brandName: '哈啰出行', province: '广东省', city: '深圳市', district: '福田区', address: '市民中心广场东侧', lat: 22.5460, lng: 114.0570, remark: '' },
  { brand: 'qingju', brandName: '滴滴青桔', province: '北京市', city: '北京市', district: '朝阳区', address: '望京 SOHO 南门', lat: 39.9968, lng: 116.4810, remark: '工作日早上车最多' },
  { brand: 'xiaoliu', brandName: '小遛共享', province: '浙江省', city: '杭州市', district: '西湖区', address: '文三路地铁站 B 口', lat: 30.2790, lng: 120.1290, remark: '' },
  { brand: 'songguo', brandName: '松果出行', province: '四川省', city: '成都市', district: '武侯区', address: '天府三街地铁站', lat: 30.5450, lng: 104.0640, remark: '县城也能用，走之前看一眼小程序' },
  { brand: 'miaozou', brandName: '喵走出行', province: '江苏省', city: '南京市', district: '鼓楼区', address: '新街口地铁站 3 号口', lat: 32.0450, lng: 118.7780, remark: '' },
  { brand: 'renmin', brandName: '人民出行', province: '山东省', city: '青岛市', district: '市南区', address: '五四广场附近', lat: 36.0620, lng: 120.3840, remark: '景区周边投放' },
  { brand: 'leifeng', brandName: '雷风出行', province: '湖北省', city: '武汉市', district: '洪山区', address: '光谷广场步行街口', lat: 30.5050, lng: 114.4000, remark: '' }
]

async function init() {
  const results = []
  for (const name of [SPOTS, 'favorites']) {
    try {
      await db.createCollection(name)
      results.push(name + ' 创建成功')
    } catch (err) {
      const msg = (err && err.errMsg) || ''
      if (/exist/i.test(msg)) results.push(name + ' 已存在，跳过')
      else throw err
    }
  }
  return ok({ message: results.join('；') })
}

async function seed() {
  const now = Date.now()
  const tasks = SEED.map((item, i) => {
    const doc = Object.assign({}, item, {
      location: db.Geo.Point(item.lng, item.lat),
      latitude: item.lat,
      longitude: item.lng,
      appId: '',
      images: [],
      status: 'approved',
      reportCount: 0,
      reporters: [],
      upCount: 0,
      seeded: true,
      _openid: 'seed',
      createdAt: now - i * 3600000,
      updatedAt: now - i * 3600000
    })
    delete doc.lat
    delete doc.lng
    return db.collection(SPOTS).add({ data: doc })
  })
  await Promise.all(tasks)
  return ok({ message: '已写入 ' + SEED.length + ' 条示例数据' })
}

async function clearSeed() {
  const res = await db.collection(SPOTS).where({ seeded: true }).remove()
  return ok({ message: '已清理示例数据', removed: res.stats && res.stats.removed })
}

async function stats() {
  const total = await db.collection(SPOTS).count()
  const seeded = await db.collection(SPOTS).where({ seeded: true }).count()
  const pending = await db.collection(SPOTS).where({ status: 'pending' }).count()
  const hidden = await db.collection(SPOTS).where({ status: 'hidden' }).count()
  return ok({
    total: total.total,
    seeded: seeded.total,
    pending: pending.total,
    hidden: hidden.total
  })
}

exports.main = async (event) => {
  const action = (event && event.action) || 'stats'
  try {
    if (action === 'init') return await init()
    if (action === 'seed') {
      await init().catch(() => {})
      return await seed()
    }
    if (action === 'clearSeed') return await clearSeed()
    return await stats()
  } catch (err) {
    console.error('[spotInit] error', err)
    return { ok: false, code: 'INIT_ERROR', msg: (err && err.errMsg) || '初始化失败' }
  }
}
