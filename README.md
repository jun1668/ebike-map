# 附近共享电动车 · ebike-map

一张用户共建的「共享电动车小程序地图」——谁在哪儿发现哪个品牌的车，就传上来；别人到陌生城市打开，直接看到、一键跳进对应品牌的小程序。

原生微信小程序 + 云开发，零服务器、免备案。9 个页面、6 个云函数，没有任何第三方运行时依赖。

> 只想看长什么样？直接打开 [`preview/index.html`](preview/index.html)，那是一个不依赖微信环境的单文件交互原型。

## 最短跑起来

1. 微信开发者工具导入本目录，填自己的小程序 AppID
2. 顶部「云开发」→ 开通 → 复制环境 ID
3. 改 `miniprogram/utils/config.js` 的 `cloudEnv`
4. 上传 6 个云函数（右键 → 上传并部署：云端安装依赖）
5. 云函数 `spotInit` 云端测试 `{"action":"init"}`，再 `{"action":"seed"}`
6. 预览 → 手机上点「定位」

完整步骤、索引、权限申请、隐私指引都在 [部署与上线](docs/03-部署与上线.md)，提审与驳回对照在 [上架清单](docs/05-上架清单.md)。

## 从 GitHub 自动上传

推到 `v*` 标签就会自动跑一遍自查并用 CI 上传体验版，不用每次开开发者工具。需要在仓库 Settings → Secrets 配两个：

| Secret | 内容 |
| --- | --- |
| `WX_APPID` | 你的小程序 AppID |
| `WX_PRIVATE_KEY` | 微信公众平台 → 开发 → 开发设置 → 小程序代码上传 生成的密钥内容 |

密钥泄露等于别人能以你的身份发版本，**只放 Secrets，不要提交进仓库**（`.gitignore` 已挡掉 `private.*.key`）。本地想跑同一条路径：`WX_APPID=wx... WX_PRIVATE_KEY_PATH=./private.key npm run upload`。

## 自查

```bash
node scripts/validate.js            # 结构 / 语法 / 标签 / 事件绑定 / 跳转路径
node scripts/test-cloudfunctions.js # 云函数业务逻辑（内存 mock 数据库）
```

## 目录

```
miniprogram/pages/index     附近：定位 + 列表 + 地图 + 筛选
miniprogram/pages/detail    详情 + 跳转品牌小程序 + 举报
miniprogram/pages/upload    上传：品牌 → 位置 → 提交
miniprogram/pages/mine      我的上传
miniprogram/pages/about     说明
miniprogram/pages/cities    按城市找（城市索引）
miniprogram/pages/city      城市详情（品牌 / 区县 / 点位数聚合）
miniprogram/utils           config / cloud / location / brands / province / format / link
.github/workflows           CI：自查 + 自动上传体验版
cloudfunctions/             spotList spotSubmit spotReport spotMine spotInit geoReverse
docs/                       需求规则 / 技术架构 / 部署上线 / 运营维护
```

## 最关键的运营动作

品牌小程序的 **AppID** 需要人工补到 `miniprogram/utils/brands.js`。补齐前点按钮会走「复制名称 → 微信搜索」的降级路径；补齐后可一键直达。这是这个产品体验的分水岭，详见 [运营与维护](docs/04-运营与维护.md)。

## 验证状态

- 源码结构、语法、WXML 标签与事件绑定、页面跳转路径：已通过 `scripts/validate.js`
- 云函数业务逻辑（参数校验、限流、去重、举报下架、任何人可下架与限流、续期确认、筛选分页、权限隔离）：已通过 `scripts/test-cloudfunctions.js`，74 个用例（含城市聚合索引与单城聚合）
- **尚未在微信开发者工具 / 真机运行**：定位授权、地图渲染、`navigateToMiniProgram` 跳转、云数据库地理索引都需要真机或真实云环境验证

## 开源说明

代码以 [MIT](LICENSE) 发布：可以自由使用、修改、分发、商用，保留版权声明即可。

需要说清楚的是，这个项目的价值不在代码，在两件事上：

1. **数据** —— 用户一条一条传上来的点位，抄不走
2. **运营** —— 小程序主体、品牌合作、流量主，这些跟着你的账号走

所以别人 fork 一份代码并不会有你的用户和数据。如果你更希望「谁想商用得先跟你谈」，把 `LICENSE` 换成 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.txt) 就行，GitHub 建仓时也能直接选。

## 免责

点位信息全部由用户上传，本项目不保证准确性，也不代表任何品牌的官方信息。遇到已经不存在的点位，任何人都可以在列表里标记下架。
