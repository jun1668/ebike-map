/**
 * 全局配置：换成自己的云开发环境 ID 即可跑起来。
 * env 获取：微信开发者工具 -> 云开发 -> 设置 -> 环境ID
 */
module.exports = {
  // 云开发环境 ID，例如 'ebike-map-3g9k2x'
  cloudEnv: 'YOUR_CLOUD_ENV_ID',

  // 列表每页条数
  pageSize: 15,

  // 附近搜索半径（米）
  defaultRadius: 30000,
  maxRadius: 200000,

  // 举报下架阈值、限流条数都在云函数里：cloudfunctions/spotReport、spotSubmit
}
