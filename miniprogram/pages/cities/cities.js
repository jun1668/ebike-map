const cloud = require('../../utils/cloud.js')

Page({
  data: {
    loading: true,
    groups: [],
    empty: false
  },

  onLoad() {
    this.loadCities()
  },

  onPullDownRefresh() {
    this.loadCities(() => wx.stopPullDownRefresh())
  },

  async loadCities(done) {
    this.setData({ loading: true })
    try {
      const data = await cloud.call('spotList', { action: 'cities' })
      const list = (data && data.list) || []

      // 按省分组，保持原排序（品牌多的城市在前）
      const map = {}
      list.forEach((c) => {
        const p = c.province || '其他'
        if (!map[p]) map[p] = []
        map[p].push(c)
      })
      const groups = Object.keys(map).map((province) => ({
        province,
        cities: map[province]
      }))

      this.setData({
        groups,
        empty: groups.length === 0,
        loading: false
      })
    } catch (e) {
      this.setData({ loading: false, empty: true })
    }
    if (done) done()
  },

  onCity(e) {
    const city = e.currentTarget.dataset.city
    wx.navigateTo({ url: `/pages/city/city?city=${encodeURIComponent(city)}` })
  },

  onGoUpload() {
    wx.switchTab({ url: '/pages/upload/upload' })
  },

  onShareAppMessage() {
    return {
      title: '哪个城市有共享电单车？这里都有人标好了',
      path: '/pages/cities/cities'
    }
  }
})
