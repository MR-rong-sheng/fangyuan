# 方圆 · 数学练习

一个安静的数学练习工具：一日一题、计算练习、公式速查、函数图像、错题本。
零依赖（原生 ES 模块 + 自带 Python 标准库服务），数据都在本机；带账号门禁与逐账号操作存档，
可以挂到公网隧道上用手机访问。

站点名取自「不以规矩，不成方圆」；默认外观是**赛博朋克**（深底 + 青霓虹 + 网格扫描线），
同时保留日间与夜间两档（顶栏那个按钮循环切换）。

## 跑起来

```bash
python -u serve.py 8082 .        # 或双击 启动服务.bat
```

打开 http://127.0.0.1:8082/ —— 首次会引导你创建管理员账号（密码只存在本机的哈希库里）。

- 账号 / 会话 / 操作存档都在 `.private/`（`fangyuan.db`、`archive/<账号>.jsonl`）
- 命令行：`python serve.py users|adduser|passwd|deluser|kick|archive|dev on|off`
- 看某人的操作轨迹：`python serve.py archive <账号> 50`，或双击 `看存档.bat`

## 目录结构

```
index.html              外壳：顶栏 / 导航 / 视图容器 / 抽屉 / toast
login.html              登录页（免登录白名单里只有它和它引用的三个 css/js）
assets/css/glass.css    设计令牌 + 液态玻璃基元
assets/css/app.css      布局与通用组件
assets/css/cyber.css    赛博朋克层（html[data-theme="cyber"]）
assets/css/<模块>.css   四个模块各自的样式（前缀：drill- / fx- / plot- / nb-）
assets/js/core.js       内核：store / prefs / 路由 / 抽屉 / toast / 转义
assets/js/app.js        启动装配（路由注册、账号抽屉、后台按角色加载）
assets/js/data.js       内容层（content/*.json）
assets/js/player.js     ——（砚池的播放器，方圆未用，可删）
assets/js/activity.js   行为采集（登录后按批次上报，进操作存档）
assets/js/views/*.js    六个前台视图 + admin.js 后台
assets/js/lib/mathfmt.js 数式渲染（^{} _{ } \frac{}{} √() → HTML，先转义再替换）
content/*.json          全部内容：units / problems / formulas / prompts
_selftest.html          自检（见下）
_phone.html             真 430px 手机预览（截图用，免得被无头浏览器的裁图骗到）
```

## 关于内容

- `content/units.json`：章节（id / name / grade / brief）
- `content/problems.json`：题目（id / unit / level / stem / choices? / answer / why / tags）
- `content/formulas.json`：公式（id / unit / name / body / note / example，body 用 mathfmt 的标记）
- `content/prompts.json`：今日页的反思提示

改完刷新即见（内容文件走 `no-store`；css/js 走 `no-cache` + ETag，改完刷新就生效，不必等缓存过期）。

## 自检

```bash
python serve.py dev on                     # 生成 .private/dev.token
# 打开 http://127.0.0.1:8082/_selftest.html?dev=<令牌>
python serve.py dev off                    # 关闭并拆掉临时 dev 账号（连会话与存档一起）
```

自检会驱动真实页面逐项断言：外壳与导航、今日作答与错题入本、四个模块的根元素、设置页、接口与操作存档。
`dev on` 是给自检和自动化用的临时直通：**用完必须 `dev off`**，否则等于公开了一个后门。

## 上手要点

- 主题：`html[data-theme="light|dark|cyber"]`；只有一支强调色（`--accent`），
  赛博层的洋红是同一色相 +120° 推导出来的辉光，不另立第二个强调色。
- 加一个模块：写 `assets/js/views/xxx.js` 导出 `{id,name,icon,nav,mount(root,ctx)}`，
  在 `app.js` 里 import 并放进 `ROUTES`，导航会自动出现；图标用 `index.html` 里的 `<symbol id="i-...">`。
- `ctx` 里能拿到：`go / store / toast / prefs / session / openDrawer / render / ic / esc / download / dayKey / track` 等。
- 错题记录的字段（四个模块共用）：`{id,stem,answer,mine,why,unit,at,tries,mastered}`，存在本机 `fangyuan:wrongs`。
