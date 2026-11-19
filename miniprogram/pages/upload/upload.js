const cloud = require('../../utils/cloud')
const locUtil = require('../../utils/location')
const brandsUtil = require('../../utils/brands')
const parseRegion = require('../../utils/province').parseRegion
const guessRegion = require('../../utils/province').guessRegion
const linkUtil = require('../../utils/link')

const app = getApp()

const EMPTY_FORM = { address: '', latitude: null, longitude: null, remark: '', appId: '' }

Page({
  data: {
    brands: brandsUtil.BRANDS,
    activeBrand: '',
    customBrand: '',
    form: Object.assign({}, EMPTY_FORM),
    region: [],
    regionText: '',
    linkHint: null,
    images: [],
    showAdvanced: false,
    agreed: false,
    submitting: false,
    quickDone: false,
    quickBusy: false,
    mapOpen: false,
    mapPicked: false,
    mapLat: 22.5405,
    mapLng: 113.9545,
    mapAddr: ''
  },

  onShow() {
    const pre = app.globalData.uploadPrefill
    if (!pre) return
    app.globalData.uploadPrefill = null

    const patch = {}
    if (pre.latitude && pre.longitude) {
      patch['form.latitude'] = pre.latitude
      patch['form.longitude'] = pre.longitude
      patch['form.address'] = '当前位置附近'
    }
    if (pre.province) {
      // 只带省份时，先给 region 一个起点，用户可再细化
      patch.region = [pre.province, '', '']
      patch.regionText = pre.province
    }
    if (pre.brand && brandsUtil.findBrand(pre.brand)) {
      patch.activeBrand = pre.brand
    }
    // 从「城市页 / 空城市引导」带过来的城市，直接落到省市区
    if (pre.city) {
      const prov = pre.province || ''
      patch.region = [prov, pre.city, pre.district || '']
      patch.regionText = (prov ? prov + ' ' : '') + pre.city + (pre.district ? ' ' + pre.district : '')
      patch.quickDone = !!(prov && pre.city)
    }
    this.setData(patch)
  },

  /* ------------------ 品牌 ------------------ */

  onPickBrand(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ activeBrand: this.data.activeBrand === key ? '' : key })
  },

  onCustomBrand(e) {
    this.setData({ customBrand: e.detail.value })
  },

  /* ------------------ 位置 ------------------ */

  onPickLocation() {
    wx.showActionSheet({
      itemList: ['用当前位置', '在地图上选点'],
      success: (res) => {
        if (res.tapIndex === 0) this.useCurrentLocation()
        if (res.tapIndex === 1) this.pickOnMap()
      }
    })
  },

  /** 快速模式：一次把坐标 + 省市区填好，用户只剩「选品牌 → 提交」 */
  onQuickFill() {
    if (this.data.quickDone) {
      this.useCurrentLocation()
      return
    }
    this.setData({ quickBusy: true })
    locUtil.ensureLocation()
      .then((location) => {
        this.setData({
          quickBusy: false,
          quickDone: true,
          'form.latitude': location.latitude,
          'form.longitude': location.longitude,
          'form.address': this.data.form.address || '当前位置附近'
        })
        this.fillRegionByGeo(location.latitude, location.longitude)
        if (location.precise === false) {
          wx.showToast({ title: '这里只是大概位置，建议点地图选精确点', icon: 'none', duration: 3000 })
        } else {
          wx.showToast({ title: '位置已填好，选个品牌就能提交', icon: 'none', duration: 2400 })
        }
      })
      .catch((err) => {
        this.setData({ quickBusy: false })
        if (err && err.code === 'AUTH_DENIED') {
          wx.showModal({
            title: '需要定位权限',
            content: '开启后才能带上坐标，别人才能在地图上看到',
            confirmText: '去开启',
            success: (r) => {
              if (r.confirm) locUtil.openLocationSetting()
            }
          })
        } else {
          wx.showToast({ title: '定位失败，可在地图上选点', icon: 'none' })
        }
      })
  },

  useCurrentLocation() {
    locUtil.ensureLocation()
      .then((location) => {
        this.setData({
          'form.latitude': location.latitude,
          'form.longitude': location.longitude,
          'form.address': this.data.form.address || '当前位置附近'
        })
        wx.showToast({
          title: location.precise === false ? '已获取大概位置，建议再点地图微调' : '已获取当前位置',
          icon: 'none'
        })
        this.fillRegionByGeo(location.latitude, location.longitude)
      })
      .catch((err) => {
        if (err && err.code === 'AUTH_DENIED') {
          wx.showModal({
            title: '需要定位权限',
            content: '开启后才能带上坐标，别人才能在地图上看到',
            confirmText: '去开启',
            success: (r) => {
              if (r.confirm) locUtil.openLocationSetting()
            }
          })
        } else {
          wx.showToast({ title: '定位失败，可在地图上选点', icon: 'none' })
        }
      })
  },

  pickOnMap() {
    locUtil.chooseLocation()
      .then((res) => {
        this.setData({
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
          'form.address': res.name || res.address || ''
        })
        this.fillRegionByAddress(res.address || res.name)
      })
      .catch((err) => {
        if (err && err.code === 'CHOOSE_CANCELLED') return
        // chooseLocation 未获批（工具类目常见）→ 降级到内置地图自选点
        this.openInnerMap()
      })
  },

  /** 没有 chooseLocation 权限时，用 <map> 组件让用户自己点一下 */
  openInnerMap() {
    const f = this.data.form
    const loc = app.globalData.location || {}
    this.setData({
      mapOpen: true,
      mapPicked: false,
      mapLat: f.latitude || loc.latitude || 22.5405,
      mapLng: f.longitude || loc.longitude || 113.9545,
      mapAddr: f.address || ''
    })
  },

  onMapTap(e) {
    this.setData({
      mapLat: e.detail.latitude,
      mapLng: e.detail.longitude,
      mapPicked: true
    })
  },

  onMapAddr(e) {
    this.setData({ mapAddr: e.detail.value })
  },

  onMapCancel() {
    this.setData({ mapOpen: false })
  },

  onMapConfirm() {
    if (!this.data.mapPicked) {
      wx.showToast({ title: '先在地图上点一下位置', icon: 'none' })
      return
    }
    const addr = (this.data.mapAddr || '').trim()
    this.setData({
      mapOpen: false,
      'form.latitude': this.data.mapLat,
      'form.longitude': this.data.mapLng,
      'form.address': addr || '地图选点'
    })
    if (addr) this.fillRegionByAddress(addr)
  },

  /** 地址文字能认出省市区就顺手填上，认不出就留给用户自己选 */
  fillRegionByAddress(address) {
    const g = guessRegion(address)
    if (!g.province && !g.city) return
    const region = [g.province, g.city, g.district]
    this.setData({
      region,
      regionText: region.filter(Boolean).join(' ')
    })
  },

  /** 只有坐标时调一次逆地理解析；云函数没配 key 就静默跳过 */
  fillRegionByGeo(latitude, longitude) {
    if (this.data.region && this.data.region[0]) return
    cloud.call('geoReverse', { latitude, longitude })
      .then((data) => {
        if (!data || !data.configured) return
        if (data.province || data.city) {
          const region = [data.province, data.city || data.province, data.district]
          this.setData({ region, regionText: region.filter(Boolean).join(' ') })
          return
        }
        this.fillRegionByAddress(data.address)
      })
      .catch(() => {})
  },

  onRegionChange(e) {
    const value = e.detail.value || []
    this.setData({
      region: value,
      regionText: value.filter(Boolean).join(' ')
    })
  },

  /* ------------------ 其他字段 ------------------ */

  onRemarkInput(e) {
    const value = e.detail.value
    this.setData({ 'form.remark': value, linkHint: this.buildLinkHint(value) })
  },

  /** 备注里贴了链接就给一句反馈，让人知道会生成「打开」按钮 */
  buildLinkHint(text) {
    const info = linkUtil.parseLink(text)
    if (!info) return null
    const tail = info.direct ? '列表里会显示「可一键打开」' : '列表里会显示「有链接」'
    return { text: '已识别' + info.label + '，' + tail, warn: !info.direct }
  },

  onAppIdInput(e) {
    this.setData({ 'form.appId': e.detail.value.trim() })
  },

  onToggleAdvanced() {
    this.setData({ showAdvanced: !this.data.showAdvanced })
  },

  onAgreeChange(e) {
    this.setData({ agreed: (e.detail.value || []).length > 0 })
  },

  /* ------------------ 图片 ------------------ */

  onAddImage() {
    const remain = 3 - this.data.images.length
    if (remain <= 0) return
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).slice(0, remain)
        wx.showLoading({ title: '处理中', mask: true })
        Promise.all(paths.map((p) => this.compressImage(p))).then((list) => {
          wx.hideLoading()
          this.setData({ images: this.data.images.concat(list).slice(0, 3) })
        })
      }
    })
  },

  // 二次压缩：微信 chooseMedia 的 compressed 只是「不传原图」，
  // 手机拍照仍可能 500KB+，这里再压到 1080 宽 / quality 60，通常 80~150KB
  compressImage(filePath) {
    return new Promise((resolve) => {
      if (!wx.compressImage) { resolve(filePath); return }
      wx.compressImage({
        src: filePath,
        quality: 60,
        compressedWidth: 1080,
        success: (res) => resolve((res && res.tempFilePath) || filePath),
        fail: () => resolve(filePath)
      })
    })
  },

  onRemoveImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.previewImage({ current: this.data.images[index], urls: this.data.images })
  },

  /* ------------------ 提交 ------------------ */

  validate() {
    const { activeBrand, customBrand, form, region, agreed } = this.data

    if (!activeBrand) return '请选择品牌'
    if (activeBrand === 'other' && !customBrand.trim()) return '请填写品牌名称'
    if (!form.latitude || !form.longitude) return '请先定位或在地图上选点'
    if (!region || !region[0]) return '请选择省 / 市 / 区'
    if (!agreed) return '请先确认信息真实并同意分享'
    if (form.appId && !/^wx[0-9a-zA-Z]{16}$/.test(form.appId)) return 'AppID 格式不对，应为 wx 开头的 18 位'
    return ''
  },

  onSubmit() {
    if (this.data.submitting) return
    const invalid = this.validate()
    if (invalid) {
      wx.showToast({ title: invalid, icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })

    this.uploadImages()
      .then((fileIds) => {
        const { activeBrand, customBrand, form } = this.data
        const region = parseRegion(this.data.region)
        const linkInfo = linkUtil.parseLink(form.remark)
        const brand = brandsUtil.findBrand(activeBrand)

        return cloud.call('spotSubmit', {
          brand: activeBrand,
          brandName: activeBrand === 'other' ? customBrand.trim() : (brand && brand.name),
          latitude: form.latitude,
          longitude: form.longitude,
          address: form.address,
          province: region.province,
          city: region.city,
          district: region.district,
          remark: form.remark.trim(),
          appId: form.appId || (linkInfo && linkInfo.kind === 'appid' ? linkInfo.id : ''),
          link: linkInfo ? (linkInfo.url || linkInfo.id || '') : '',
          images: fileIds
        })
      })
      .then((data) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        const pending = data && data.status === 'pending'
        wx.showModal({
          title: pending ? '已提交，等待审核' : '上传成功',
          content: pending
            ? '维护者审核通过后，其他人就能在地图上看到这条信息了。'
            : '已经在地图上出现，感谢你帮到别人 🎉',
          showCancel: false,
          success: () => {
            this.reset()
            app.globalData.needRefreshIndex = true
            wx.switchTab({ url: '/pages/index/index' })
          }
        })
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        cloud.toastError(err)
      })
  },

  uploadImages() {
    const images = this.data.images
    if (!images.length) return Promise.resolve([])
    const tasks = images.map((filePath, i) => {
      const ext = (filePath.match(/\.(\w+)$/) || [, 'jpg'])[1]
      const cloudPath = 'spots/' + Date.now() + '-' + i + '.' + ext
      return new Promise((resolve) => {
        wx.cloud.uploadFile({
          cloudPath,
          filePath,
          success: (res) => resolve(res.fileID),
          // 图片失败不阻塞主流程
          fail: () => resolve('')
        })
      })
    })
    return Promise.all(tasks).then((ids) => ids.filter(Boolean))
  },

  reset() {
    this.setData({
      activeBrand: '',
      customBrand: '',
      form: Object.assign({}, EMPTY_FORM),
      region: [],
      regionText: '',
      linkHint: null,
      images: [],
      agreed: false,
      showAdvanced: false
    })
  }
})
