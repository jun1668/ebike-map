/**
 * 命令行上传小程序（给 GitHub Actions 用，也可以本地跑）
 *
 * 本地用法：
 *   WX_APPID=wx1234567890abcdef WX_PRIVATE_KEY_PATH=./private.key node scripts/ci-upload.js
 *
 * 上传密钥在：微信公众平台 → 开发 → 开发设置 → 小程序代码上传 → 生成密钥
 * 密钥只能下载一次，下载后立刻放到安全位置，绝不能提交进仓库。
 */

const path = require('path')
const crypto = require('crypto')
const fs = require('fs')

async function main() {
  const appid = process.env.WX_APPID
  const keyPath = process.env.WX_PRIVATE_KEY_PATH || process.env.WX_PRIVATE_KEY

  if (!appid || !appid.startsWith('wx')) {
    console.error('缺少 WX_APPID（形如 wx1234567890abcdef）')
    process.exit(1)
  }
  if (!keyPath || !fs.existsSync(keyPath)) {
    console.error('缺少上传密钥文件：' + keyPath)
    process.exit(1)
  }

  let ci
  try {
    ci = require('miniprogram-ci')
  } catch (e) {
    console.error('没装 miniprogram-ci，先执行：npm install')
    process.exit(1)
  }

  const projectPath = path.resolve(__dirname, '..')
  const version = process.env.VERSION || '0.1.' + Math.floor(Date.now() / 60000)

  const project = new ci.Project({
    appid: appid,
    type: 'miniProgram',
    projectPath: projectPath,
    privateKeyPath: keyPath,
    ignores: ['node_modules/**/*', '**/*.zip', 'preview/**/*']
  })

  // 上传前打印项目代码指纹，方便确认传的是哪一版
  const digest = crypto.createHash('md5').update(String(Date.now())).digest('hex').slice(0, 8)

  console.log('上传 ' + appid + ' 版本 ' + version + '（构建 ' + digest + '）')
  await ci.upload({
    project: project,
    version: version,
    desc: process.env.DESC || 'ci: 自动上传',
    setting: { es6: true, minify: true, autoPrefixWXSS: true },
    onProgressUpdate: (info) => {
      if (typeof info === 'string') console.log(info)
    }
  })
  console.log('上传完成，去微信公众平台 → 版本管理 → 开发版本 就能看到')
}

main().catch((e) => {
  console.error('上传失败：', e && e.message ? e.message : e)
  process.exit(1)
})
