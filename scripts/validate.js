#!/usr/bin/env node
/**
 * 小程序工程静态自检（无需微信开发者工具）
 *   node scripts/validate.js
 *
 * 检查项：
 *  1. app.json 里声明的页面文件是否齐全
 *  2. 所有 JSON 能否解析
 *  3. 所有 JS 语法（node --check）
 *  4. WXML 标签是否闭合、是否用了未闭合的自定义标签
 *  5. WXML 里绑定的事件函数在对应 Page/Component 里是否存在
 *  6. require 的本地模块是否存在
 *  7. WXSS 大括号配平
 *  8. tabBar / 页面跳转路径是否有效
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

const errors = []
const warnings = []
const stats = { pages: 0, js: 0, wxml: 0, wxss: 0, json: 0 }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = fs.statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'miniprogram_npm') continue
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function rel(p) {
  return path.relative(ROOT, p)
}

// 这些组件习惯写成单标签；map / canvas / video 等虽然可以自闭合，但实际多写成成对标签，交给栈校验
const VOID_TAGS = new Set(['image', 'input', 'icon', 'progress', 'switch', 'slider', 'open-data', 'br'])

/* ---------- 1. 页面文件完整性 ---------- */
const appJsonPath = path.join(MP, 'app.json')
let appJson = null
try {
  appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  stats.json++
} catch (e) {
  errors.push(`app.json 解析失败: ${e.message}`)
}

if (appJson) {
  const pages = appJson.pages || []
  if (!pages.length) errors.push('app.json 的 pages 为空')
  for (const page of pages) {
    stats.pages++
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const f = path.join(MP, page + '.' + ext)
      if (!fs.existsSync(f)) {
        // wxss/json 缺失不致命，js 和 wxml 必须有
        const msg = `缺少页面文件 ${page}.${ext}`
        if (ext === 'js' || ext === 'wxml') errors.push(msg)
        else warnings.push(msg)
      }
    }
  }

  // tabBar 页面必须在 pages 里
  const tabs = (appJson.tabBar && appJson.tabBar.list) || []
  for (const t of tabs) {
    if (pages.indexOf(t.pagePath) < 0) {
      errors.push(`tabBar 页面 ${t.pagePath} 未在 pages 中声明`)
    }
  }
}

/* ---------- 2/3/7. 遍历文件做语法检查 ---------- */
const files = walk(MP)

for (const file of files) {
  const ext = path.extname(file)

  if (ext === '.json') {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'))
      stats.json++
    } catch (e) {
      errors.push(`${rel(file)} JSON 解析失败: ${e.message}`)
    }
  }

  if (ext === '.js') {
    stats.js++
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (e) {
      errors.push(`${rel(file)} JS 语法错误:\n${(e.stderr || '').toString().split('\n').slice(0, 4).join('\n')}`)
    }
  }

  if (ext === '.wxss') {
    stats.wxss++
    const css = fs.readFileSync(file, 'utf8')
    const open = (css.match(/\{/g) || []).length
    const close = (css.match(/\}/g) || []).length
    if (open !== close) errors.push(`${rel(file)} WXSS 大括号不配平 (${open} vs ${close})`)
  }

  if (ext === '.wxml') {
    stats.wxml++
    checkWxml(file)
  }
}

/* ---------- WXML 校验 ---------- */
function checkWxml(file) {
  let src = fs.readFileSync(file, 'utf8')
  // 去掉注释
  src = src.replace(/<!--[\s\S]*?-->/g, '')

  const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g
  const stack = []
  let m
  while ((m = tagRe.exec(src))) {
    const raw = m[0]
    const name = m[1]
    const selfClose = m[3] === '/'
    if (raw.startsWith('</')) {
      const top = stack.pop()
      if (!top) {
        errors.push(`${rel(file)} 多余的结束标签 </${name}>`)
      } else if (top !== name) {
        errors.push(`${rel(file)} 标签不匹配: <${top}> 被 </${name}> 关闭`)
      }
    } else if (!selfClose && !VOID_TAGS.has(name)) {
      stack.push(name)
    }
  }
  for (const left of stack) {
    errors.push(`${rel(file)} 未闭合标签 <${left}>`)
  }

  // 事件绑定 -> 处理函数
  const jsFile = file.replace(/\.wxml$/, '.js')
  if (!fs.existsSync(jsFile)) return
  const js = fs.readFileSync(jsFile, 'utf8')
  const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:]?([a-zA-Z]+)\s*[:=]\s*"([^"{}]+)"/g
  let b
  const seen = new Set()
  while ((b = bindRe.exec(src))) {
    const handler = b[2].trim()
    if (!handler || seen.has(handler)) continue
    seen.add(handler)
    // 支持 methods 里同名函数写法
    const hasFn = new RegExp(`(^|[^\\w.])${handler}\\s*\\(`, 'm').test(js)
    if (!hasFn) {
      warnings.push(`${rel(file)} 事件 ${b[0].split('=')[0].trim()}="${handler}" 在 ${path.basename(jsFile)} 里没找到同名函数`)
    }
  }
}

/* ---------- 6. require 路径 ---------- */
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(file, 'utf8')
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g
  let r
  while ((r = re.exec(src))) {
    const target = path.resolve(path.dirname(file), r[1])
    const found = fs.existsSync(target) || fs.existsSync(target + '.js') || fs.existsSync(path.join(target, 'index.js'))
    if (!found) errors.push(`${rel(file)} require('${r[1]}') 指向的文件不存在`)
  }
}

/* ---------- 8. 跳转路径 ---------- */
const pageSet = new Set((appJson && appJson.pages) || [])
for (const file of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(file, 'utf8')
  const re = /url:\s*['"]\/?(pages\/[\w-]+\/[\w-]+)/g
  let r
  while ((r = re.exec(src))) {
    if (!pageSet.has(r[1])) errors.push(`${rel(file)} 跳转到未注册页面 ${r[1]}`)
  }
}

/* ---------- 输出 ---------- */
console.log('小程序静态自检')
console.log('  页面 %d / js %d / wxml %d / wxss %d / json %d', stats.pages, stats.js, stats.wxml, stats.wxss, stats.json)

if (warnings.length) {
  console.log('\n警告 %d 条:', warnings.length)
  warnings.forEach((w) => console.log('  ! ' + w))
}

if (errors.length) {
  console.log('\n错误 %d 条:', errors.length)
  errors.forEach((e) => console.log('  x ' + e))
  process.exit(1)
}

console.log('\n通过：没有发现结构性错误。')
console.log('提示：这只证明源码结构完整，不代表已在微信里跑通；真机验证请见 docs/03-部署与上线.md')
