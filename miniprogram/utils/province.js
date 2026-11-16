/** 省级行政区（用于按省份筛选 / 上传时选省份） */
const PROVINCES = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区',
  '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省',
  '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区',
  '海南省', '重庆市', '四川省', '贵州省', '云南省',
  '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区',
  '新疆维吾尔自治区', '台湾省', '香港特别行政区', '澳门特别行政区'
]

/** 去掉省/市/自治区后缀，得到简称，用于紧凑展示 */
function shortProvince(name) {
  if (!name) return ''
  return name
    .replace(/维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市/g, '')
}

/**
 * 从 region picker 的值里取省/市
 * region picker 返回 ['广东省','深圳市','南山区']，直辖市第二项可能为空
 */
function parseRegion(value) {
  const arr = Array.isArray(value) ? value : []
  return {
    province: arr[0] || '',
    city: arr[1] || arr[0] || '',
    district: arr[2] || ''
  }
}

/** 直辖市 / 特别行政区：省和市同名 */
const MUNICIPALITIES = [
  '北京市', '上海市', '天津市', '重庆市', '香港特别行政区', '澳门特别行政区'
]

/**
 * 从一段地址文字里猜省/市/区
 * 用于「定位 / 地图选点」后自动带出上级行政区，猜不出就返回空串让用户手动选
 * 例：'广东省深圳市南山区科技南十路' → {广东省, 深圳市, 南山区}
 */
function guessRegion(address) {
  const none = { province: '', city: '', district: '' }
  if (!address || typeof address !== 'string') return none

  let rest = address.trim()
  let province = ''
  let city = ''
  let district = ''

  const muni = MUNICIPALITIES.find((m) => rest.indexOf(m) === 0)
  if (muni) {
    province = muni
    city = muni
    rest = rest.slice(muni.length)
  } else {
    const p = rest.match(/^(.{2,9}?(?:省|自治区|特别行政区))/)
    if (p) {
      province = p[1]
      rest = rest.slice(province.length)
    }
    const c = rest.match(/^(.{2,10}?(?:市|自治州|地区|盟))/)
    if (c) {
      city = c[1]
      rest = rest.slice(city.length)
    }
  }

  const d = rest.match(/^(.{1,10}?(?:区|县|市|旗))/)
  if (d) district = d[1]

  return { province, city, district }
}

module.exports = { PROVINCES, shortProvince, parseRegion, guessRegion }
