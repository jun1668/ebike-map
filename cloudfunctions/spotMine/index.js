const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const SPOTS = 'spots'
const LIMIT = 100

function ok(data) {
  return { ok: true, data }
}

function fail(code, msg) {
  return { ok: false, code, msg }
}

function normalize(doc) {
  const out = Object.assign({}, doc)
  if (doc.location && Array.isArray(doc.location.coordinates)) {
    out.location = {
      latitude: doc.location.coordinates[1],
      longitude: doc.location.coordinates[0]
    }
  }
  delete out.reporters
  return out
}

exports.main = async () => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return fail('NO_AUTH', '请在小程序内使用')

  try {
    const res = await db.collection(SPOTS)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(LIMIT)
      .get()

    return ok({ list: (res.data || []).map(normalize) })
  } catch (err) {
    console.error('[spotMine] error', err)
    return ok({ list: [] })
  }
}
