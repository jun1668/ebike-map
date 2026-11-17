const CONFIG = require('../../utils/config')
const cloud = require('../../utils/cloud')
const locUtil = require('../../utils/location')
const brandsUtil = require('../../utils/brands')
const linkUtil = require('../../utils/link')
const fmt = require('../../utils/format')

const PROVINCES = require('../../utils/province').PROVINCES
const shortProvince = require('../../utils/province').shortProvince

const app = getApp()

/** 距离 + 新鲜度综合分：越近越好，越旧越靠后，失效的额外降权 */
function rankScore(s) {
  const distP = Math.min((s.distance || 0) / 1000, 30)
  return distP + (s.days || 0) * 0.35 + (s.stale ? 8 : 0)
}

// 超过这么多天没人确认，就提示「可能已失效」
const STALE_DAYS = 30

// 默认地图中心（未授权定位时用天安门兜底，避免地图空白）
const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 }

Page({
  data: {
    brands: brandsUtil.BRANDS.filter((b) => b.key !== 'other'),
    provinceOptions: ['全部省份'].concat(PROVINCES),
    provinceIndex: 0,
    provinceShort: '',
    keyword: '',
    activeBrand: '',
    view: 'list',

    list: [],
    total: 0,
    unit: ' 条',
    page: 0,
    hasMore: true,
    loading: false,
    refreshing: false,

    location: null,
    locText: '未定位，点击获取当前位置',
    locating: false,

    emptyTitle: '附近还没有收录',
    emptyDesc: '',
    officialBrands: [{ name: '美团电单车' }, { name: '哈啰出行' }, { name: '滴滴青桔' }],

    mapLat: DEFAULT_CENTER.latitude,
    mapLng: DEFAULT_CENTER.longitude,
    scale: 12,
    markers: [],
    selected: null
  },

  onLoad() {
    // app 启动时的静默定位结果通过回调补进来
    app.onLocationReady = (location) => {
      if (!this.data.location) this.applyLocation(location, false)
    }
    const cached = app.globalData.location
    if (cached) {
      this.applyLocation(cached, false)
    } else {
      this.loadList(true)
    }
  },

  onShow() {
    // 上传页提交成功后会置这个标志，回到首页立刻刷新
    if (this.needRefresh || app.globalData.needRefreshIndex) {
      this.needRefresh = false
      app.globalData.needRefreshIndex = false
      this.loadList(true)
    }
  },

  onUnload() {
    if (app.onLocationReady) app.onLocationReady = null
  },

  /* ------------------ 定位 ------------------ */

  applyLocation(location, moveMap) {
    const patch = {
      location,
      locText: '已定位 · 附近',
      mapLat: location.latitude,
      mapLng: location.longitude
    }
    if (moveMap) patch.scale = 13
    this.setData(patch)
  },

  onTapLocate() {
    if (this.data.locating) return
    this.setData({ locating: true })
    locUtil.ensureLocation()
      .then((location) => {
        app.globalData.location = location
        this.applyLocation(location, true)
        this.setData({ locating: false })
        this.loadList(true)
        this.hintCity(location)
      })
      .catch((err) => {
        this.setData({ locating: false })
        if (err && err.code === 'AUTH_DENIED') {
          wx.showModal({
            title: '需要定位权限',
            content: '开启后才能按距离找附近的共享电动车',
            confirmText: '去开启',
            success: (res) => {
              if (!res.confirm) return
              locUtil.openLocationSetting().then((ok) => {
                if (ok) this.onTapLocate()
              })
            }
          })
        } else if (err && err.code === 'PRIVACY_DENIED') {
          wx.showToast({ title: '需先同意隐私协议', icon: 'none' })
        } else {
          wx.showToast({ title: '定位失败，可手动选省份查找', icon: 'none' })
        }
      })
  },

  /** 用逆地理补一个城市名（未配置 key 时静默跳过） */
  hintCity(location) {
    cloud.call('geoReverse', { latitude: location.latitude, longitude: location.longitude })
      .then((data) => {
        if (data && data.city) {
          this.setData({ locText: data.city + ' · 附近' })
        }
      })
      .catch(() => {})
  },

  /* ------------------ 筛选 ------------------ */

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.loadList(true)
  },

  onClearKeyword() {
    this.setData({ keyword: '' })
    this.loadList(true)
  },

  onProvinceChange(e) {
    const index = Number(e.detail.value)
    const province = index > 0 ? this.data.provinceOptions[index] : ''
    this.setData({
      provinceIndex: index,
      provinceShort: province ? shortProvince(province) : ''
    })
    this.loadList(true)
  },

  onBrandTap(e) {
    const key = e.currentTarget.dataset.key || ''
    this.setData({ activeBrand: key })
    this.loadList(true)
  },

  onSwitchView(e) {
    const view = e.currentTarget.dataset.v
    this.setData({ view })
    if (view === 'map') this.syncMarkers()
  },

  onRefresh() {
    this.setData({ refreshing: true })
    this.loadList(true, () => this.setData({ refreshing: false }))
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loading) return
    this.loadList(false)
  },

  /* ------------------ 数据 ------------------ */

  currentProvince() {
    const { provinceIndex, provinceOptions } = this.data
    return provinceIndex > 0 ? provinceOptions[provinceIndex] : ''
  },

  loadList(reset, done) {
    if (this.data.loading) return
    const page = reset ? 0 : this.data.page + 1
    const location = this.data.location

    const payload = {
      page,
      pageSize: CONFIG.pageSize,
      keyword: this.data.keyword.trim(),
      province: this.currentProvince(),
      brand: this.data.activeBrand
    }
    if (location) {
      payload.latitude = location.latitude
      payload.longitude = location.longitude
      if (!payload.province) payload.radius = CONFIG.defaultRadius
    }

    this.setData({ loading: true })

    cloud.call('spotList', payload)
      .then((data) => {
        const rows = (data.list || []).map((s) => this.decorate(s))
        if (reset && !payload.keyword) rows.sort((a, b) => rankScore(a) - rankScore(b))
        const list = reset ? rows : this.data.list.concat(rows)
        const patch = {
          list,
          total: data.total || list.length,
          unit: payload.province ? ' 个城市点' : ' 条',
          page,
          hasMore: !!data.hasMore,
          loading: false
        }
        if (!list.length) Object.assign(patch, this.buildEmptyCopy())
        this.setData(patch)
        this.syncMarkers()
        if (done) done()
      })
      .catch((err) => {
        this.setData({ loading: false })
        if (done) done()
        cloud.toastError(err)
      })
  },

  /** 空列表时说人话：让用户知道自己可以当第一个，而不是看到一个空白页 */
  buildEmptyCopy() {
    const kw = (this.data.keyword || '').trim()
    const prov = this.data.provinceShort || ''
    if (kw) {
      return {
        emptyTitle: `没找到「${kw}」`,
        emptyDesc: '换个关键词试试，或者你正好在本地，就来传第一条'
      }
    }
    if (prov) {
      return {
        emptyTitle: `${prov}还没有人上传过`,
        emptyDesc: '你来当这个省的第一个，之后来这儿的人打开就能看到'
      }
    }
    if (this.data.location) {
      return {
        emptyTitle: '你附近还没有人上传过',
        emptyDesc: '你来当这附近的第一个，后面路过的人都能直接看到你这条'
      }
    }
    return {
      emptyTitle: '还没有人上传过',
      emptyDesc: '你来当第一个，之后来这儿的人都能直接看到你这条'
    }
  },

  onGoCities() {
    wx.navigateTo({ url: '/pages/cities/cities' })
  },

  /** 「还在」：刷新这条的确认时间，等于帮后面的人续上时效 */
  onConfirmAlive(e) {
    const id = e.currentTarget.dataset.id
    cloud.callWithLoading('spotSubmit', { mode: 'confirm', id }, '确认中…')
      .then(() => {
        wx.showToast({ title: '已确认，感谢你帮它续上时效', icon: 'none' })
        this.loadList(true)
      })
      .catch((err) => cloud.toastError(err))
  },

  onSearchOfficial(e) {
    const name = e.currentTarget.dataset.name
    fmt.copy(name, `已复制「${name}」，去微信搜索`)
  },

  decorate(spot) {
    const brand = brandsUtil.findBrand(spot.brand) || brandsUtil.findBrand(spot.brandName)
    const color = (brand && brand.color) || '#8A8F98'
    const open = linkUtil.openLabel(spot)
    const canJump = open.tone === 'on'

    let distance = spot.distance
    const location = this.data.location
    if ((distance === undefined || distance === null) && location && spot.location) {
      distance = fmt.haversine(location.latitude, location.longitude, spot.location.latitude, spot.location.longitude)
    }

    // 「其他品牌」用用户自己填的名字做角标，不要千篇一律显示「其他」
    const customShort = spot.brand === 'other' && spot.brandName && spot.brandName !== '其他品牌'
      ? spot.brandName.slice(0, 2)
      : ''

    // 新鲜度：距上次有人确认多少天
    const lastAt = new Date(spot.updatedAt || spot.createdAt || 0).getTime()
    const days = lastAt ? (Date.now() - lastAt) / 86400000 : 0

    return Object.assign({}, spot, {
      brandName: spot.brandName || brandsUtil.brandName(spot.brand),
      short: customShort || (brand && brand.short) || (spot.brandName || '其他').slice(0, 2),
      color,
      badgeBg: color + '1a',
      canJump,
      openText: open.text,
      openTone: open.tone,
      distance,
      distanceText: fmt.distance(distance),
      timeText: fmt.timeAgo(spot.updatedAt || spot.createdAt),
      days: days,
      stale: days >= STALE_DAYS,
      isFav: !!spot.isFav
    })
  },

  syncMarkers() {
    const markers = this.data.list
      .filter((s) => s.location && s.location.latitude)
      .slice(0, 200)
      .map((s, i) => ({
        id: i + 1,
        _spotId: s._id,
        latitude: s.location.latitude,
        longitude: s.location.longitude,
        iconPath: '/images/pin.png',
        width: 26,
        height: 32,
        callout: {
          content: s.brandName + (s.city ? ' | ' + s.city : ''),
          color: '#1f2328',
          fontSize: 12,
          borderRadius: 6,
          padding: 6,
          bgColor: '#ffffff',
          display: 'BYCLICK'
        }
      }))

    // marker id 与列表下标对应，回查时用
    this._markerMap = {}
    markers.forEach((m) => {
      this._markerMap[m.id] = m._spotId
    })
    this.setData({ markers })
  },

  onMarkerTap(e) {
    const id = e.detail.markerId || (e.detail.marker && e.detail.marker.id)
    const spotId = this._markerMap && this._markerMap[id]
    const spot = this.data.list.find((s) => s._id === spotId)
    if (!spot) return
    const patch = { selected: spot }
    if (spot.location) {
      patch.mapLat = spot.location.latitude
      patch.mapLng = spot.location.longitude
    }
    this.setData(patch)
  },

  onCloseSheet() {
    this.setData({ selected: null })
  },

  onRegionChange(e) {
    if (e.type !== 'end' || e.causedBy !== 'drag') return
    const c = e.detail.centerLocation
    if (!c) return
    this.setData({ mapLat: c.latitude, mapLng: c.longitude })
  },

  onZoomIn() {
    this.setData({ scale: Math.min(this.data.scale + 1, 19) })
  },

  onZoomOut() {
    this.setData({ scale: Math.max(this.data.scale - 1, 3) })
  },

  /* ------------------ 跳转 ------------------ */

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  onJumpFromSheet(e) {
    const id = e.currentTarget.dataset.id
    const spot = this.data.list.find((s) => s._id === id) || this.data.selected
    if (!spot) return
    this.jumpToBrand(spot)
  },

  /** 列表卡片上的「可一键打开 / 有链接」直接点，不用先进详情 */
  onJumpTag(e) {
    const id = e.currentTarget.dataset.id
    const spot = this.data.list.find((s) => s._id === id)
    if (!spot) return
    this.jumpToBrand(spot)
  },

  jumpToBrand(spot) {
    const brand = brandsUtil.findBrand(spot.brand)
    linkUtil.openSpot(spot, brand)
  },

  onLongPress(e) {
    const id = e.currentTarget.dataset.id
    const spot = this.data.list.find((s) => s._id === id)
    if (!spot) return
    const favText = spot && spot.isFav ? '取消收藏' : '收藏这条'
    wx.showActionSheet({
      itemList: [favText, '还能用，我来确认一下', '已经下架了，删除这条', '复制品牌名', '举报这条信息'],
      success: (res) => {
        if (res.tapIndex === 0) this.toggleFav(spot._id)
        if (res.tapIndex === 1) this.confirmAlive(spot._id)
        if (res.tapIndex === 2) this.askRemove(spot._id)
        if (res.tapIndex === 3) fmt.copy(spot.brandName, '已复制品牌名')
        if (res.tapIndex === 4) this.report(spot._id)
      }
    })
  },

  onShareAppMessage() {
    // 当前筛选出来的城市，分享时直接落过去，比只分享首页有用得多
    const city = this.shareCity()
    if (city) {
      return {
        title: `${city}有 ${this.data.total} 个共享电单车点位，都是大家传上来的`,
        path: `/pages/city/city?city=${encodeURIComponent(city)}`
      }
    }
    return {
      title: '附近电驴在哪？这张地图是大家一起画的',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    const city = this.shareCity()
    if (city) {
      return {
        title: `${city}的共享电单车都在哪？已经有人标好了`,
        query: `city=${encodeURIComponent(city)}`
      }
    }
    return { title: '附近电驴地图 · 用户共建' }
  },

  /** 列表里如果全是同一个城市，就把它作为分享落点 */
  shareCity() {
    const cities = {}
    this.data.list.forEach((s) => {
      if (s.city) cities[s.city] = 1
    })
    const keys = Object.keys(cities)
    return keys.length === 1 ? keys[0] : ''
  },

  report(id) {
    cloud.call('spotReport', { id })
      .then(() => wx.showToast({ title: '已提交，感谢反馈', icon: 'none' }))
      .catch(cloud.toastError)
  },

  /** 卡片右上角的「⋯」：任何人都能确认可用或下架 */
  onMoreTap(e) {
    this.showSpotMenu(e.currentTarget.dataset.id)
  },

  /** 卡片菜单：收藏 / 确认 / 下架 / 举报 */
  showSpotMenu(id) {
    const spot = this.findSpot(id)
    if (!spot) return
    const favText = spot.isFav ? '取消收藏' : '收藏这条'
    wx.showActionSheet({
      itemList: [favText, '还能用，我来确认一下', '已经下架了，删除这条', '举报这条信息'],
      success: (res) => {
        if (res.tapIndex === 0) this.toggleFav(id)
        if (res.tapIndex === 1) this.confirmAlive(id)
        if (res.tapIndex === 2) this.askRemove(id)
        if (res.tapIndex === 3) this.report(id)
      }
    })
  },

  /** 收藏 / 取消收藏，先把界面改掉再等云端，感觉更快 */
  toggleFav(id) {
    const spot = this.findSpot(id)
    if (!spot) return
    const next = !spot.isFav
    this.applyFav(id, next)
    cloud.call('spotFav', { action: 'toggle', spotId: id })
      .then((data) => {
        const fav = data && typeof data.fav === 'boolean' ? data.fav : next
        this.applyFav(id, fav)
        wx.showToast({
          title: fav ? '已收藏，去「我的」看' : '已取消收藏',
          icon: 'none'
        })
      })
      .catch((err) => {
        this.applyFav(id, !next)
        cloud.toastError(err)
      })
  },

  applyFav(id, fav) {
    const list = this.data.list.map((s) => (s._id === id ? Object.assign({}, s, { isFav: fav }) : s))
    const patch = { list }
    if (this.data.selected && this.data.selected._id === id) {
      patch.selected = Object.assign({}, this.data.selected, { isFav: fav })
    }
    this.setData(patch)
    if (this.data.mode === 'map') this.syncMarkers()
  },

  findSpot(id) {
    const inList = this.data.list.find((s) => s._id === id)
    if (inList) return inList
    if (this.data.selected && this.data.selected._id === id) return this.data.selected
    return null
  },

  /** 确认这条信息还有效，刷新它的时间 */
  confirmAlive(id) {
    cloud.call('spotSubmit', { mode: 'confirm', id })
      .then((data) => {
        if (data && data.confirmed === false) {
          wx.showToast({ title: '你已经确认过了', icon: 'none' })
          return
        }
        wx.showToast({ title: '已确认，感谢更新', icon: 'none' })
        this.loadList(true)
      })
      .catch(cloud.toastError)
  },

  /** 删除前必须先确认「是否已经下架」 */
  askRemove(id) {
    const spot = this.findSpot(id)
    const name = spot ? spot.brandName : '这条记录'
    const where = spot ? spot.city : ''
    wx.showModal({
      title: '确认这辆车已经下架了吗？',
      content: '删除的是「' + name + (where ? ' · ' + where : '') + '」这条记录。确认后将立即从地图和列表移除，其他人都看不到了。',
      confirmText: '确认已下架',
      confirmColor: '#e5484d',
      cancelText: '还没下架',
      success: (res) => {
        if (res.confirm) this.doRemove(id)
      }
    })
  },

  doRemove(id) {
    wx.showLoading({ title: '处理中', mask: true })
    cloud.call('spotSubmit', { mode: 'delete', id })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已删除，感谢更新', icon: 'none' })
        this.setData({ selected: null })
        this.loadList(true)
      })
      .catch((err) => {
        wx.hideLoading()
        cloud.toastError(err)
      })
  },

  onGoUpload() {
    const location = this.data.location
    // tabBar 页面不能带 query，用全局暂存把定位和省份带过去
    app.globalData.uploadPrefill = {
      latitude: location ? location.latitude : null,
      longitude: location ? location.longitude : null,
      province: this.currentProvince(),
      brand: this.data.activeBrand || ''
    }
    this.needRefresh = true
    wx.switchTab({ url: '/pages/upload/upload' })
  }
})
