/** 通用格式化 */

/** 米 -> 友好距离文案 */
function distance(meters) {
  if (meters === null || meters === undefined || isNaN(meters)) return ''
  if (meters < 1000) return Math.round(meters) + 'm'
  const km = meters / 1000
  if (km < 100) return km.toFixed(1) + 'km'
  return Math.round(km) + 'km'
}

/** 时间戳/日期 -> 相对时间 */
function timeAgo(value) {
  if (!value) return ''
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + '分钟前'
  const hour = Math.floor(min / 60)
  if (hour < 24) return hour + '小时前'
  const day = Math.floor(hour / 24)
  if (day < 30) return day + '天前'
  const d = new Date(t)
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

/** 两个坐标点距离（米），Haversine */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function copy(text, tip) {
  wx.setClipboardData({
    data: String(text || ''),
    success: () => {
      wx.showToast({ title: tip || '已复制', icon: 'none' })
    }
  })
}

module.exports = { distance, timeAgo, haversine, copy }
