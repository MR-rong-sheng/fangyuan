# 方圆 · 题库与新增模块契约

子任务照此实现。**父级拥有** `tools/BANK.md`、`assets/js/bank.js`、`tools/build-bank.py`、`app.js`、
`index.html`、`content/*.json`；子任务只写自己名下的文件，需要父级改的地方在汇报里写明。

## 一、题库文件格式（子任务：数据收集）

路径：`content/bank/<城市拼音>-<年份>.json`（ASCII 文件名，内容中文）。城市拼音固定：

| 拼音 | 城市 | 拼音 | 城市 | 拼音 | 城市 |
|---|---|---|---|---|---|
| nj | 南京 | wx | 无锡 | xz | 徐州 |
| cz | 常州 | sz | 苏州 | nt | 南通 |
| lyg | 连云港 | ha | 淮安 | yc | 盐城 |
| yz | 扬州 | zj | 镇江 | tz | 泰州 |
| sq | 宿迁 | | | | |

```json
{
  "province": "江苏", "city": "南京", "year": 2025,
  "paper": "2025年江苏省南京市中考数学试卷",
  "source": "能打开并看到题目的那个页面 URL",
  "coverage": "已收 14 题 / 全卷 27 题",
  "note": "第 20 题图形缺失未收；其余为原文可见",
  "questions": [
    {
      "id": "nj-2025-01",
      "no": 1,
      "kind": "选择",
      "stem": "下列运算正确的是",
      "choices": ["A．a^2·a^3=a^6", "B．(a^2)^3=a^5", "C．a^6÷a^2=a^4", "D．a^2+a^3=a^5"],
      "answer": "C",
      "solution": "同底数幂相乘指数相加，A 应为 a^5；幂的乘方指数相乘，B 应为 a^6；D 不是同类项。",
      "unit": "u2",
      "level": 1,
      "tags": ["整式运算", "同底数幂"],
      "src": "具体到这道题能看到的页面"
    }
  ]
}
```

字段规则：

- `kind` 只用 `选择` / `填空` / `解答`。
- `stem` 用方圆的数学标记：上标 `a^2` 或 `a^{m+n}`、下标 `x_1`、分数 `\frac{分子}{分母}`、根号 `√(x)`。**不要写 LaTeX 命令之外的花括号**，不要写 `$…$`。
- `choices` 仅选择题，元素形如 `"A．2"`（全角点）。
- `solution` **自己写**关键步骤，不要照抄教辅解析。
- `unit` 取下列 id 之一（拿不准就 `""` 并在 `tags` 里写考点）：

  | id | 章节 | 年级 |
  |---|---|---|
  | u1 | 有理数与实数 | 七年级上 |
  | u2 | 代数式与整式 | 七年级上 |
  | u3 | 一元一次方程 | 七年级上 |
  | u4 | 不等式与不等式组 | 七年级下 |
  | u5 | 一次函数 | 八年级下 |
  | u6 | 二次函数 | 九年级上 |
  | u7 | 勾股定理与全等三角形 | 八年级上 |
  | u8 | 相似与圆 | 九年级上 |

- `level`：1 易 / 2 中 / 3 难。
- `src` 必填，指向**这道题所在的那一页**；一整卷只有一个来源就写那个来源。
- `id` 必须全局唯一：`<拼音>-<年份>-<两位题号>`。
- `fig` / `figAlt`：**题干提到图的题必须配图**。`fig` 是相对路径 `content/bank/fig/<id>.svg`，
  `figAlt` 是一句话描述（无障碍用）。图不是从来源页面抓的位图，而是**按题干条件重画的原创 SVG**，
  规范（画法、配色、校验要求）见 `tools/FIG.md`；校验器会检查文件存在/合法/无 `<script>`/无 `on*=`/≤20 KB，
  并统计「题干提到图但缺图」的题数（这个数要一路降到 0）。

**硬规矩（最重要）**：

1. **绝不编造题目**。找不到某份卷子，就写一个 `"questions": []` 的文件，`note` 里写清为什么（如「未找到公开可读的原文」）。**宁可少，不可假。**
2. 每道题都要能指回来源页；答案要自己算一遍或与该卷答案页核对一致。算不出来的题不收。
3. 覆盖率要诚实写在 `coverage` / `note` 里（江苏各市卷多为 25–28 题，达不到就如实写）。

生成索引与校验（父级脚本，子任务可直接跑来自查）：

```bash
python D:/Hermes/cache/scratch/fangyuan/build-bank.py     # 扫 content/bank/*.json → 写 index.json 并校验
python D:/Hermes/cache/scratch/fangyuan/build-bank.py --check   # 只校验不写
```

## 二、加载器 `assets/js/bank.js`（父级已写好，子任务直接用）

```js
import { loadIndex, loadPaper, loadAll, filterQuestions, toProblem, CITIES, KIND_NAMES, LEVEL_NAMES } from '../bank.js';

await loadIndex()          // → { generated, total, cities:[{city, pinyin, years:[{year, file, count}]}] }
await loadPaper('nj', 2025)// → 单份试卷对象（带缓存；questions 已补上 city/year/pinyin）
await loadAll(cb)          // → { questions:[…], papers:N }；cb(done, total) 可用于进度条
filterQuestions(list, { city, year, kind, unit, level, q })   // 纯函数筛选，参数省略即不限
toProblem(q)               // → { id, stem, answer, why, unit, level, tags, source, city, year }
```

`toProblem()` 的结果与练习页/错题本使用的题目对象同构，字段：`id stem answer why unit level tags source city year`。

## 三、三个新视图的契约

### 1. 题库 `assets/js/views/bank.js` + `assets/css/bank.css`

- 根元素 `[data-bank]`；钩子：`[data-bank-count]`（「共 N 题 / 命中 M 题」）、
  `[data-bank-city]`、`[data-bank-year]`、`[data-bank-unit]`、`[data-bank-level]`、`[data-bank-q]`、
  `[data-bank-list]`、`[data-bank-item]`（带 `[data-bank-id]`）、`[data-bank-open]`、`[data-bank-pick]`（勾选框）。
- 交互：按城市/年份/章节/难度/关键词筛选；点条目在抽屉里看题干、选项、答案、解析、来源（可点开原页）。
- 「把勾选的题拿去组卷」按钮：`const m = await import('./papers.js'); m.openWith(ids); ctx.go('papers');`
  —— `papers.js` 必须导出 `openWith(ids)`（题目 id 数组，父级定的跨视图协议）。

### 2. 组卷 + 一页纸 `assets/js/views/papers.js` + `assets/css/papers.css` + `assets/css/print.css`

- 根元素 `[data-papers]`；钩子：`[data-papers-mode]`（`paper` / `wrongs`）、`[data-papers-count]`、
  `[data-papers-list]`、`[data-papers-item]`、`[data-papers-pick]`、`[data-papers-random]`（按当前筛选智能抽题）、
  `[data-papers-clear]`、`[data-papers-start]`（开始做卷）、`[data-papers-print]`、`[data-papers-result]`。
- **必须导出** `openWith(ids)`：把题目 id 收下（暂存），`mount` 结束时消费。
- 组卷：从题库按章节/城市/年份/难度抽题（也支持手工勾选）→ 卷面（题号+题干+留白）→
  「开始做卷」逐题作答并判分（判分用宽容规则，见下）→ 结果页给得分与错题（自动进错题本）。
- 一页纸：`mode='wrongs'` 时把错题本排成一页 A4（≤2 页），字段紧凑：题号/题干/我的答案/正确答案/解析一行。
- `css/print.css` 负责 `@media print`：A4、边距 10mm、黑白、隐藏顶栏导航抽屉 toast 页脚，
  只留 `.printable`。`.printable` 在屏幕上也可预览（白纸卡片）。
- 宽容判分规则（与练习页/错题本一致）：去空格与标点、全角转半角、`x=12`≡`12`、`3/4`≡`0.75`、忽略项序。

### 3. 连续打卡 `assets/js/views/streak.js` + `assets/css/streak.css`

- 根元素 `[data-streak]`；钩子：`[data-streak-now]`（连续天数）、`[data-streak-best]`（最长）、
  `[data-streak-today]`（今日是否已打卡）、`[data-streak-strip]`（最近 30 天格子，每格 `[data-day]` 带 `data-on`/`data-off` 与 `title`）。
- 打卡口径（本地，不排名）：某一天若满足任一条件即算打卡 ——
  ① `fangyuan:today.done[YYYY-MM-DD]` 存在；② `fangyuan:drill.stats.history[].at` 有该日的记录；
  ③ `fangyuan:wrongs[].at` 有该日的记录。store 前缀是 `fangyuan:`，用 `ctx.store.get('today.done', {})` 这样读。
- 显示：连续天数（今天没打卡则显示「连续 N 天 · 今天还没打卡」）、最长连续、30 天热力条、本月概览。
- 不排名、不扣分、不催逼：文案要克制。

## 四、父级负责（子任务不要碰）

- `app.js` 里注册路由、`index.html` 里挂样式与图标。
- 自检页 `_selftest.html` 的断言。
- 题库索引 `content/bank/index.json`。
