const cloud = require('../../utils/cloud.js')
const linkUtil = require('../../utils/link.js')
const fmt = require('../../utils/format.js')

const STALE_DAYS = 30

Page({
  data: {
    city: '',
    loading: true,
    empty: false,
    total: 0,
    brandCount: 0,
    districtCount: 0,
    brands: [],
    allStale: false,
    shareTitle: '',
    // 官方小程序兜底入口（没收录时让用户先去用）
    official: [
      { name: '美团电单车' },
      { name: '哈啰出行' },
      { name: '滴滴青桔' }
    ]
  },

  onLoad(options) {
    const city = decodeURIComponent(options.city || '')
    this.setData({ city })
    wx.setNavigationBarTitle({ title: city || '城市' })
    this.loadCity(city)
  },

  onPullDownRefresh() {
    this.loadCity(this.data.city, () => wx.stopPullDownRefresh())
  },

  async loadCity(city, done) {
    if (!city) {
      this.setData({ loading: false, empty: true })
      if (done) done()
      return
    }
    this.setData({ loading: true })
    try {
      const data = await cloud.call('spotList', { action: 'city', city })
      const brands = ((data && data.brands) || []).map((b) => {
        const days = (Date.now() - (b.latestAt || 0)) / 86400000
        return {
          brand: b.brand,
          brandName: b.brandName,
          count: b.count,
          sample: b.sample || null,
          days: Math.round(days * 10) / 10,
          timeText: fmt.timeAgo(b.latestAt),
          stale: days >= STALE_DAYS,
          openText: b.sample ? linkUtil.openLabel(b.sample).text : '需微信搜索',
          openTone: b.sample ? linkUtil.openLabel(b.sample).tone : 'off'
        }
      })
      const total = (data && data.total) || 0
      const staleCount = brands.filter((b) => b.stale).length
      const city = (data && data.city) || this.data.city

      this.setData({
        loading: false,
        empty: total === 0,
        total,
        brandCount: brands.length,
        districtCount: (data && data.districtCount) || 0,
        brands,
        allStale: total > 0 && staleCount === brands.length,
        shareTitle: `${city}有 ${brands.length} 个品牌的共享电单车`
      })
    } catch (e) {
      this.setData({ loading: false, empty: true })
    }
    if (done) done()
  },

  /** 点品牌：带着筛选条件回首页 */
  onBrand(e) {
    const { name, brand } = e.currentTarget.dataset
    const app = getApp()
    app.globalData.indexFilter = { brand: brand || '', keyword: brand ? '' : name }
    app.globalData.needRefreshIndex = true
    wx.switchTab({ url: '/pages/index/index' })
  },

  onGoUpload() {
    const app = getApp()
    app.globalData.uploadPrefill = { city: this.data.city }
    wx.switchTab({ url: '/pages/upload/upload' })
  },

  /** 没收录时，先让用户去官方小程序，别白跑一趟 */
  onOfficial(e) {
    const name = e.currentTarget.dataset.name
    wx.setClipboardData({
      data: name,
      success: () => wx.showToast({ title: `已复制「${name}」，去微信搜索`, icon: 'none', duration: 2600 })
    })
  },

  onShareAppMessage() {
    const names = this.data.brands.slice(0, 3).map((b) => b.brandName).join('、')
    return {
      title: this.data.shareTitle || `${this.data.city}的共享电单车`,
      path: `/pages/city/city?city=${encodeURIComponent(this.data.city)}`
    }
  },

  onShareTimeline() {
    return {
      title: `${this.data.city}有 ${this.data.brandCount} 个品牌的共享电单车，${this.data.total} 个点位`,
      query: `city=${encodeURIComponent(this.data.city)}`
    }
  }
})
