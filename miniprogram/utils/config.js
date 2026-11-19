/**
 * 全局配置：换成自己的云开发环境 ID 即可跑起来。
 * env 获取：微信开发者工具 -> 云开发 -> 设置 -> 环境ID
 */
module.exports = {
  // 云开发环境 ID，例如 'ebike-map-3g9k2x'
  cloudEnv: 'junge-d5glgeh8v153d36db',

  // 列表每页条数
  pageSize: 15,

  // 附近搜索半径（米）
  defaultRadius: 30000,
  // 只有模糊定位时用的半径：模糊定位误差约 5km，半径太小会筛不到东西
  fuzzyRadius: 60000,
  maxRadius: 200000,

  // 举报下架阈值、限流条数都在云函数里：cloudfunctions/spotReport、spotSubmit
}
