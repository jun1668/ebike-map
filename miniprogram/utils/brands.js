/**
 * 品牌字典
 *
 * appId 说明（重要）：
 * 微信小程序之间互跳（wx.navigateToMiniProgram）必须拿到对方的 AppID。
 * 品牌官方小程序的 AppID 不由第三方分发，需要一个一个核对后填进来：
 *   微信里搜到该品牌小程序 -> 右上角「…」-> 关于 -> 里面有 AppID；
 *   或用微信开发者工具的「小程序码/链接解析」工具反查。
 *
 * appId 为空时，本小程序会走「复制品牌名 + 提示去微信搜索」的降级路径，
 * 功能可用但多一步操作。运营补齐 appId 后就能一键直达。
 */
const BRANDS = [
  { key: 'meituan', name: '美团电单车', short: '美团', color: '#FFD100', appId: '', path: '' },
  { key: 'hello', name: '哈啰出行', short: '哈啰', color: '#0091FF', appId: '', path: '' },
  { key: 'qingju', name: '滴滴青桔', short: '青桔', color: '#00C6A2', appId: '', path: '' },
  { key: 'xiaoliu', name: '小遛共享', short: '小遛', color: '#FF7A00', appId: '', path: '' },
  { key: 'songguo', name: '松果出行', short: '松果', color: '#F5C518', appId: '', path: '' },
  { key: 'miaozou', name: '喵走出行', short: '喵走', color: '#7C4DFF', appId: '', path: '' },
  { key: 'renmin', name: '人民出行', short: '人民', color: '#D32F2F', appId: '', path: '' },
  { key: 'mibu', name: '蜜步出行', short: '蜜步', color: '#FF5C8A', appId: '', path: '' },
  { key: 'baishu', name: '拜米出行', short: '拜米', color: '#2E7D32', appId: '', path: '' },
  { key: 'leifeng', name: '雷风出行', short: '雷风', color: '#0288D1', appId: '', path: '' },
  { key: 'xiaobin', name: '小彬出行', short: '小彬', color: '#455A64', appId: '', path: '' },
  { key: 'qingke', name: '氢氪出行', short: '氢氪', color: '#00897B', appId: '', path: '' },
  { key: 'other', name: '其他品牌', short: '其他', color: '#8A8F98', appId: '', path: '' }
]

const MAP = {}
BRANDS.forEach((b) => {
  MAP[b.key] = b
})

/** 按 key 或名称找品牌 */
function findBrand(keyOrName) {
  if (!keyOrName) return null
  if (MAP[keyOrName]) return MAP[keyOrName]
  return BRANDS.find((b) => b.name === keyOrName) || null
}

/** 品牌展示色，未知品牌给灰色 */
function brandColor(keyOrName) {
  const b = findBrand(keyOrName)
  return (b && b.color) || '#8A8F98'
}

/** 品牌展示名 */
function brandName(keyOrName, fallback) {
  const b = findBrand(keyOrName)
  return (b && b.name) || keyOrName || fallback || '未知品牌'
}

/** 该品牌是否已配置可直跳的 AppID */
function canJump(keyOrName) {
  const b = findBrand(keyOrName)
  return !!(b && b.appId && b.appId.length >= 10 && b.appId !== 'TOURISTAPPID')
}

module.exports = { BRANDS, findBrand, brandColor, brandName, canJump }
