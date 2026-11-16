Page({
  data: {
    version: '1.0.0'
  },

  onAgreement() {
    wx.navigateTo({ url: '/pages/agreement/agreement' })
  }
})
