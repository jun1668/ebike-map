const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const SPOTS = 'spots'

// 累计多少条举报自动转入待复核（不在列表展示）
const OFFLINE_THRESHOLD = 3

function ok(data) {
  return { ok: true, data }
}

function fail(code, msg) {
  return { ok: false, code, msg }
}

exports.main = async (event) => {
  const id = String((event && event.id) || '')
  const reason = String((event && event.reason) || '').slice(0, 20)
  const openid = cloud.getWXContext().OPENID

  if (!id) return fail('INVALID', '缺少条目 ID')
  if (!openid) return fail('NO_AUTH', '请在小程序内使用')

  try {
    const doc = await db.collection(SPOTS).doc(id).get().catch(() => null)
    if (!doc || !doc.data) return fail('NOT_FOUND', '这条信息不存在')

    const reporters = doc.data.reporters || []
    // 同一人重复举报不再计数
    if (reporters.indexOf(openid) >= 0) {
      return ok({ duplicated: true, reportCount: doc.data.reportCount || 0 })
    }

    const reportCount = (doc.data.reportCount || 0) + 1
    const patch = {
      reportCount: _.inc(1),
      reporters: _.push([openid]),
      lastReportAt: Date.now(),
      lastReportReason: reason
    }
    if (reportCount >= OFFLINE_THRESHOLD) {
      patch.status = 'hidden'
      patch.hiddenAt = Date.now()
    }

    await db.collection(SPOTS).doc(id).update({ data: patch })

    return ok({ reportCount, offline: reportCount >= OFFLINE_THRESHOLD })
  } catch (err) {
    console.error('[spotReport] error', err)
    return fail('SERVER_ERROR', '提交失败，请稍后重试')
  }
}
