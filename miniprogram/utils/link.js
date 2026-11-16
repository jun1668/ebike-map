/**
 * 小程序链接识别
 *
 * 用户可能往「补充说明」里贴各种东西，这里统一识别：
 *   appid      wx1234567890abcdef           → 真能直接跳
 *   shortlink  https://wxaurl.cn/xxxx       → 真能直接跳（官方短链）
 *   scheme     #小程序://品牌/路径           → 只能复制，微信里粘贴打开
 *   web        https://...                  → 只能复制
 */
const fmt = require('./format')

const RE_SHORTLINK = /https?:\/\/wxaurl\.cn\/[A-Za-z0-9_-]+/
const RE_SCHEME = /#小程序:\/\/[^\s]+/
const RE_APPID = /\bwx[0-9a-zA-Z]{16}\b/
const RE_WEB = /https?:\/\/[^\s，。；、）)]+/

function parseLink(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()

  let m = t.match(RE_SHORTLINK)
  if (m) return { kind: 'shortlink', direct: true, url: m[0], label: '小程序短链' }

  m = t.match(RE_SCHEME)
  if (m) return { kind: 'scheme', direct: false, url: m[0], label: '小程序链接' }

  m = t.match(RE_APPID)
  if (m) return { kind: 'appid', direct: true, id: m[0], label: 'AppID' }

  m = t.match(RE_WEB)
  if (m) return { kind: 'web', direct: false, url: m[0], label: '网页链接' }

  return null
}

/** 一条记录能怎么打开：AppID 优先，其次看 note 里贴的链接 */
function spotLink(spot) {
  if (!spot) return null
  if (spot.appId && String(spot.appId).length >= 10) {
    return { kind: 'appid', direct: true, id: spot.appId, label: 'AppID' }
  }
  return parseLink(spot.link || spot.remark || '')
}

/** 列表角标文案 */
function openLabel(spot) {
  const l = spotLink(spot)
  if (l && l.direct) return { text: '可一键打开', tone: 'on' }
  if (l) return { text: '有链接', tone: 'link' }
  return { text: '需微信搜索', tone: 'off' }
}

/**
 * 统一打开入口
 * @param {object} spot   记录
 * @param {object} brand  品牌配置（可空）
 */
function openSpot(spot, brand) {
  const name = spot.brandName || (brand && brand.name) || spot.brand || '这个小程序'
  const path = spot.path || (brand && brand.path) || ''
  const appId = (spot.appId && String(spot.appId).length >= 10)
    ? spot.appId
    : (brand && brand.appId) || ''
  const link = spotLink(spot)

  const failCopy = (msg) => {
    wx.showModal({
      title: '打开失败',
      content: msg || '对方小程序可能未开放跳转，已复制名称，可在微信首页搜索',
      showCancel: false,
      success: () => fmt.copy(name, '已复制，去微信搜索')
    })
  }

  if (appId) {
    wx.navigateToMiniProgram({
      appId,
      path,
      fail: () => failCopy()
    })
    return
  }

  if (link && link.kind === 'shortlink') {
    wx.navigateToMiniProgram({
      shortLink: link.url,
      fail: () => failCopy('短链已失效或对方未开放跳转，已复制名称')
    })
    return
  }

  if (link && (link.kind === 'scheme' || link.kind === 'web')) {
    wx.showModal({
      title: '这条是分享链接',
      content: '微信不允许小程序直接打开别人贴的分享链接，复制后到微信里粘贴给「文件传输助手」就能打开。',
      confirmText: '复制链接',
      cancelText: '知道了',
      success: (res) => {
        if (res.confirm) fmt.copy(link.url, '已复制，去微信里粘贴')
      }
    })
    return
  }

  wx.showModal({
    title: '这个小程序还没有链接',
    content: '已复制「' + name + '」，在微信首页搜索即可打开。你也可以把它的链接补到补充说明里，帮到别人。',
    confirmText: '复制名称',
    cancelText: '知道了',
    success: (res) => {
      if (res.confirm) fmt.copy(name, '已复制，去微信搜索')
    }
  })
}

module.exports = { parseLink, spotLink, openLabel, openSpot }
