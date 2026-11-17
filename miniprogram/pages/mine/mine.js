const cloud = require('../../utils/cloud')
const brandsUtil = require('../../utils/brands')
const fmt = require('../../utils/format')
const locUtil = require('../../utils/location')

const app = getApp()

Page({
  data: {
    tab: 'mine',
    list: [],
    favList: [],
    stats: { total: 0, fav: 0, cities: 0, brands: 0 },
    loading: true,
    favLoading: true
  },

  onShow() {
    this.load()
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  onRefresh() {
    this.load()
  },

  load() {
    this.setData({ loading: true })
    cloud.call('spotMine', {})
      .then((data) => {
        const rows = (data.list || []).map((s) => Object.assign({}, s, {
          brandName: s.brandName || brandsUtil.brandName(s.brand),
          timeText: fmt.timeAgo(s.createdAt || s.updatedAt)
        }))
        const cities = {}
        const brands = {}
        rows.forEach((r) => {
          if (r.city) cities[r.city] = 1
          if (r.brand) brands[r.brand] = 1
        })
        this.setData({
          list: rows,
          stats: Object.assign({}, this.data.stats, {
            total: rows.length,
            cities: Object.keys(cities).length,
            brands: Object.keys(brands).length
          }),
          loading: false
        })
      })
      .catch((err) => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
    this.loadFav()
  },

  /** 我的收藏：存的是收藏时的快照，原点位被删也能看到（标灰） */
  loadFav() {
    this.setData({ favLoading: true })
    cloud.call('spotFav', { action: 'list' })
      .then((data) => {
        const rows = (data.list || []).map((f) => Object.assign({}, f, {
          brandName: f.brandName || brandsUtil.brandName(f.brand),
          short: (f.brandName || '其他').slice(0, 2),
          timeText: fmt.timeAgo(f.createdAt),
          where: [f.city, f.district].filter(Boolean).join(' · ')
        }))
        this.setData({
          favList: rows,
          stats: Object.assign({}, this.data.stats, { fav: rows.length }),
          favLoading: false
        })
      })
      .catch((err) => {
        this.setData({ favLoading: false })
        if (err && err.code === 'NO_COLLECTION') return
        cloud.toastError(err)
      })
  },

  onOpenFav(e) {
    const spotId = e.currentTarget.dataset.spotid
    const alive = e.currentTarget.dataset.alive
    if (!alive) {
      wx.showModal({
        title: '这条已经失效了',
        content: '它在列表里已经被下架或删除。要把它从收藏里去掉吗？',
        confirmText: '去掉',
        success: (res) => {
          if (res.confirm) this.unfav(spotId)
        }
      })
      return
    }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + spotId })
  },

  onUnfav(e) {
    this.unfav(e.currentTarget.dataset.spotid)
  },

  unfav(spotId) {
    cloud.call('spotFav', { action: 'toggle', spotId })
      .then(() => {
        wx.showToast({ title: '已取消收藏', icon: 'none' })
        this.loadFav()
      })
      .catch(cloud.toastError)
  },

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    const spot = this.data.list.find((s) => s._id === id)
    if (!spot) return
    wx.showActionSheet({
      itemList: ['改备注说明', '重新定位'],
      success: (res) => {
        if (res.tapIndex === 0) this.editRemark(spot)
        if (res.tapIndex === 1) this.editLocation(spot)
      }
    })
  },

  editRemark(spot) {
    wx.showModal({
      title: '修改备注',
      editable: true,
      placeholderText: '补充说明，最多 120 字',
      content: spot.remark || '',
      success: (res) => {
        if (!res.confirm) return
        this.update(spot._id, { remark: (res.content || '').trim() })
      }
    })
  },

  editLocation(spot) {
    locUtil.chooseLocation()
      .then((res) => {
        this.update(spot._id, {
          latitude: res.latitude,
          longitude: res.longitude,
          address: res.name || res.address || spot.address
        })
      })
      .catch(() => {})
  },

  update(id, patch) {
    cloud.call('spotSubmit', Object.assign({ id, mode: 'update' }, patch))
      .then(() => {
        wx.showToast({ title: '已更新', icon: 'none' })
        this.load()
      })
      .catch(cloud.toastError)
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条上传？',
      content: '删除后其他人也看不到了',
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return
        cloud.call('spotSubmit', { id, mode: 'delete' })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'none' })
            this.load()
            app.globalData.needRefreshIndex = true
          })
          .catch(cloud.toastError)
      }
    })
  },

  onGoUpload() {
    wx.switchTab({ url: '/pages/upload/upload' })
  },

  onAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  }
})
