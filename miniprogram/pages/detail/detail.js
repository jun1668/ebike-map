const cloud = require('../../utils/cloud')
const brandsUtil = require('../../utils/brands')
const linkUtil = require('../../utils/link')
const fmt = require('../../utils/format')

Page({
  data: {
    id: '',
    spot: null,
    markers: [],
    loading: true
  },

  onLoad(query) {
    const id = (query && query.id) || ''
    if (!id) {
      this.setData({ loading: false })
      return
    }
    this.setData({ id })
    this.fetch(id)
  },

  fetch(id) {
    this.setData({ loading: true })
    cloud.call('spotList', { id })
      .then((data) => {
        const raw = (data.list || [])[0]
        if (!raw) {
          this.setData({ loading: false, spot: null })
          return
        }
        const spot = this.decorate(raw)
        const markers = spot.location
          ? [{
            id: 1,
            latitude: spot.location.latitude,
            longitude: spot.location.longitude,
            iconPath: '/images/pin.png',
            width: 26,
            height: 32,
            callout: {
              content: spot.brandName,
              color: '#1f2328',
              fontSize: 12,
              borderRadius: 6,
              padding: 6,
              bgColor: '#ffffff',
              display: 'ALWAYS'
            }
          }]
          : []
        this.setData({ spot, markers, loading: false })
        wx.setNavigationBarTitle({ title: spot.brandName })
      })
      .catch((err) => {
        this.setData({ loading: false })
        cloud.toastError(err)
      })
  },

  decorate(spot) {
    const brand = brandsUtil.findBrand(spot.brand)
    const color = (brand && brand.color) || '#8A8F98'
    const customShort = spot.brand === 'other' && spot.brandName && spot.brandName !== '其他品牌'
      ? spot.brandName.slice(0, 2)
      : ''
    return Object.assign({}, spot, {
      brandName: spot.brandName || brandsUtil.brandName(spot.brand),
      short: customShort || (brand && brand.short) || (spot.brandName || '其他').slice(0, 2),
      color,
      badgeBg: color + '1a',
      canJump: linkUtil.openLabel(spot).tone === 'on',
      openText: linkUtil.openLabel(spot).text,
      openTone: linkUtil.openLabel(spot).tone,
      timeText: fmt.timeAgo(spot.updatedAt || spot.createdAt),
      sameCityCount: spot.sameCityCount || 1
    })
  },

  onOpenMap() {
    const spot = this.data.spot
    if (!spot || !spot.location) return
    wx.openLocation({
      latitude: spot.location.latitude,
      longitude: spot.location.longitude,
      name: spot.brandName,
      address: spot.address || spot.city || '',
      scale: 17
    })
  },

  onJump() {
    const spot = this.data.spot
    if (!spot) return
    linkUtil.openSpot(spot, brandsUtil.findBrand(spot.brand))
  },

  onReport() {
    const spot = this.data.spot
    if (!spot) return
    wx.showActionSheet({
      itemList: ['信息已失效（车没了/小程序换了）', '位置不对', '广告或无关内容'],
      success: (res) => {
        cloud.call('spotReport', { id: spot._id, reason: res.tapIndex })
          .then(() => {
            wx.showToast({ title: '感谢反馈，我们会核实', icon: 'none' })
          })
          .catch(cloud.toastError)
      }
    })
  },

  /** 任何人都可以下架，但必须先确认「已经下架」 */
  onAskRemove() {
    const spot = this.data.spot
    if (!spot) return
    const where = spot.city || spot.province || ''
    wx.showModal({
      title: '确认这辆车已经下架了吗？',
      content: '删除的是「' + spot.brandName + (where ? ' · ' + where : '') + '」这条记录。确认后将立即从地图和列表移除，其他人都看不到了。',
      confirmText: '确认已下架',
      confirmColor: '#e5484d',
      cancelText: '还没下架',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        cloud.call('spotSubmit', { mode: 'delete', id: spot._id })
          .then(() => {
            wx.hideLoading()
            wx.showToast({ title: '已删除，感谢更新', icon: 'none' })
            setTimeout(() => {
              if (getCurrentPages().length > 1) wx.navigateBack()
              else wx.switchTab({ url: '/pages/index/index' })
            }, 900)
          })
          .catch((err) => {
            wx.hideLoading()
            cloud.toastError(err)
          })
      }
    })
  },

  onShareAppMessage() {
    const spot = this.data.spot
    return {
      title: spot ? spot.brandName + ' · ' + (spot.city || '共享电动车') : '附近共享电鸡',
      path: '/pages/detail/detail?id=' + this.data.id
    }
  }
})
