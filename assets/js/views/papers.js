/* ==========================================================================
   方圆 · views/papers.js —— 组卷 + 错题一页纸
   两个模式：
     paper  从题库（bank.js）按城市/年份/章节/难度/题型抽题或手工勾选 → 卷面
            （题号+题干+留白）→「开始做卷」逐题作答、宽容判分、给分，错题自动
            进错题本 → 交卷后卷面附上答案与解析，可打印。
     wrongs 把错题本（ctx.store 'wrongs'）排成一页 A4（≤2 页），每行紧凑：
            题号 / 题干 / 我的答案 / 正确答案 / 解析。
   只依赖内核（core.js）、题库加载器（bank.js）、内容层（data.js）与数式渲染
   （lib/mathfmt.js），零第三方依赖。

   数据钩子（父级自检用）：
     根 [data-papers] · [data-papers-mode]（paper / wrongs）
     [data-papers-count] · [data-papers-list] · [data-papers-item]（带 data-papers-id）
     [data-papers-pick]（勾选框） · [data-papers-random] · [data-papers-clear]
     [data-papers-start] · [data-papers-print] · [data-papers-result]

   跨视图协议（题库页「把勾选的题拿去组卷」用）：
     export function openWith(ids) —— 收下题目 id 数组，mount 结束时消费。
   ========================================================================== */
import { esc, store, toast, ic } from '../core.js';
import { loadIndex, loadAll, filterQuestions, CITIES, KIND_NAMES, LEVEL_NAMES } from '../bank.js';
import { renderMath } from '../lib/mathfmt.js';
import { mountFigs } from '../fig.js';

/* ======================================================================
   跨视图协议：暂存题库页传来的勾选 id
   ====================================================================== */
let PENDING_IDS = null;
let TICK = null;               // 做卷计时器句柄（模块级，换视图时清掉，避免泄漏）

/** 题库页调用：把勾选的题目 id 交过来；下次 mount 时收下并切到组卷模式。 */
export function openWith(ids) {
  const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  PENDING_IDS = list;
  return list.length;
}

/* ======================================================================
   宽容判分（与练习页/错题本同一套规则，实现保持一致）
   ====================================================================== */
/* 全角转半角、去空白、去中文标点、统一乘除与负号；保留小数点与冒号 */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/[。、，,;；]+/g, '')
    .replace(/[×✕·∙*]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/÷/g, '/')
    .toLowerCase();
}
function parseNum(s) {
  s = String(s).replace(/^\+/, '');
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)$/))) return Number(m[1]);
  if ((m = s.match(/^(-?\d+)\/(\d+)$/))) return Number(m[1]) / Number(m[2]);   // 3/4 → 0.75
  return null;
}
function splitEq(s) { const i = s.indexOf('='); return i < 0 ? null : [s.slice(0, i), s.slice(i + 1)]; }
function canonTerms(s) {
  return String(s).replace(/-/g, '+-').split('+').filter(x => x !== '').map(x => x.trim()).sort().join('+');
}
function ansEq(mine, correct) {
  const a = norm(mine), b = norm(correct);
  if (!a || !b) return false;
  if (a === b) return true;
  const na = parseNum(a), nb = parseNum(b);
  if (na != null && nb != null && Math.abs(na - nb) < 1e-9) return true;
  const eb = splitEq(b);
  if (eb) {                                   // 正确答案是方程：允许只写未知数的值
    const ea = splitEq(a);
    const cand = ea ? ea[1] : a;
    const nc = parseNum(cand), nw = parseNum(eb[1]);
    if (nc != null && nw != null && Math.abs(nc - nw) < 1e-9) return true;
    if (norm(cand) === norm(eb[1])) return true;
  }
  const ea2 = splitEq(a);
  if (ea2 && !eb) {                           // 用户多写了 “x=”，答案却是纯值
    const nc = parseNum(ea2[1]);
    if (nc != null && nb != null && Math.abs(nc - nb) < 1e-9) return true;
    if (norm(ea2[1]) === b) return true;
  }
  if (canonTerms(a) === canonTerms(b)) return true;   // 代数式：忽略项的先后
  return false;
}

/* ======================================================================
   小工具
   ====================================================================== */
const U8_FALLBACK = {
  u1: '有理数与实数', u2: '代数式与整式', u3: '一元一次方程', u4: '不等式与不等式组',
  u5: '一次函数', u6: '二次函数', u7: '勾股定理与全等三角形', u8: '相似与圆',
};
const levelName = n => LEVEL_NAMES[Number(n)] || LEVEL_NAMES[2];
const kindName = k => KIND_NAMES[k] || k || '题';
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtTime = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 一道题的来源小标签：南京·2025 · 选择 · 中 */
function qMeta(q) {
  return [q.city ? `${q.city}${q.year ? q.year : ''}` : (q.year || ''), kindName(q.kind), `难度${levelName(q.level)}`]
    .filter(Boolean).join(' · ');
}
/** 给胶囊用的朴素题干：把 \\frac 之类的标记压成一行文字，省得在窄胶囊里堆分数 */
function plainStem(s) {
  return String(s || '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\^\{([^{}]*)\}/g, '^$1')
    .replace(/_\{([^{}]*)\}/g, '_$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ======================================================================
   视图
   ====================================================================== */
export default {
  id: 'papers', name: '组卷', icon: 'notes', nav: true,

  async mount(root, ctx) {
    if (TICK) { clearInterval(TICK); TICK = null; }
    root.dataset.papers = '1';

    const $r = sel => root.querySelector(sel);
    const $$r = sel => Array.from(root.querySelectorAll(sel));

    /* ---------------- 状态 ---------------- */
    const S = {
      mode: 'paper',
      all: [],                       // 全部题库题（原始结构，带 solution/kind）
      units: Object.assign({}, U8_FALLBACK),
      filter: { city: '', year: '', unit: '', level: '', kind: '', q: '' },
      n: 8,
      sel: [],                       // 已选题目（原始题库对象）
      round: null,                   // 做卷状态
      sheetKeyed: false,             // 卷面是否已附答案
      wrongsOpen: false,             // 错题一页纸：仅未掌握
      notice: '',
    };

    /* ---------------- 骨架 ---------------- */
    root.innerHTML = `
      <div class="papers">
        <section class="view-head print-hide">
          <div class="kicker">组卷</div>
          <h2>组卷 · 错题一页纸</h2>
          <p>从题库按城市、年份、章节、难度抽题凑一份卷子来做；做错的题自动进错题本。
             错题本还能排成一页 A4 —— 题号、题干、我的答案、正确答案、解析，一行一道 —— 打印带走。</p>
        </section>

        <div class="papers-modeseg seg print-hide" role="tablist" aria-label="模式">
          <button type="button" role="tab" data-papers-modetab="paper">组卷做卷</button>
          <button type="button" role="tab" data-papers-modetab="wrongs">错题一页纸</button>
        </div>

        <!-- ============ 组卷 ============ -->
        <section class="papers-panel" data-papers-panel="paper">
          <article class="card glass spec papers-card papers-card--setup print-hide">
            <div class="card__label">出卷范围</div>
            <div class="papers-filters">
              <label class="field papers-f"><span class="papers-f__k">城市</span><select data-pf="city" aria-label="城市"></select></label>
              <label class="field papers-f"><span class="papers-f__k">年份</span><select data-pf="year" aria-label="年份"></select></label>
              <label class="field papers-f"><span class="papers-f__k">章节</span><select data-pf="unit" aria-label="章节"></select></label>
              <label class="field papers-f"><span class="papers-f__k">难度</span><select data-pf="level" aria-label="难度"></select></label>
              <label class="field papers-f"><span class="papers-f__k">题型</span><select data-pf="kind" aria-label="题型"></select></label>
              <label class="field papers-f papers-f--q"><span class="papers-f__k">关键词</span>
                <input data-pf="q" type="search" autocomplete="off" placeholder="题干 / 答案 / 考点" aria-label="关键词" /></label>
            </div>
            <div class="papers-bar">
              <span class="papers-count" data-papers-count>已选 0 题</span>
              <label class="field papers-num"><span class="papers-f__k">题数</span>
                <input data-papers-n type="number" min="1" max="40" step="1" value="8" inputmode="numeric" aria-label="抽题数" /></label>
              <button type="button" class="btn btn--primary btn--sm" data-papers-random>${ic('bolt')}智能抽题</button>
              <button type="button" class="btn btn--ghost btn--sm" data-papers-clear>${ic('trash')}清空</button>
            </div>
            <div class="papers-selchips chips" data-papers-selchips></div>
            <div class="papers-list" data-papers-list aria-label="候选题"></div>
          </article>

          <article class="card glass spec papers-card papers-card--sheet" data-print-keep>
            <div class="card__label print-hide">卷面</div>
            <div class="btn-row print-hide">
              <button type="button" class="btn btn--primary" data-papers-start>${ic('check')}开始做卷</button>
              <button type="button" class="btn btn--ghost" data-papers-print>${ic('down')}打印卷面</button>
            </div>
            <div class="printable" data-papers-sheet></div>
          </article>

          <article class="card glass spec papers-card papers-card--work print-hide">
            <div class="card__label">作答</div>
            <div class="papers-work" data-papers-work></div>
            <div class="papers-result" data-papers-result></div>
          </article>
        </section>

        <!-- ============ 错题一页纸 ============ -->
        <section class="papers-panel" data-papers-panel="wrongs" hidden>
          <article class="card glass spec papers-card papers-card--wrongs" data-print-keep>
            <div class="card__label print-hide">错题一页纸</div>
            <div class="btn-row print-hide">
              <button type="button" class="btn btn--primary" data-papers-print data-papers-print-wrongs>${ic('down')}打印这一页</button>
              <button type="button" class="btn btn--ghost btn--sm" data-papers-wrongsopen>仅未掌握</button>
              <button type="button" class="btn btn--ghost btn--sm" data-papers-wrongsall>全部错题</button>
              <span class="papers-count" data-papers-wrongscount>—</span>
            </div>
            <div class="printable printable--wrongs" data-wrongs-sheet></div>
          </article>
        </section>
      </div>`;

    /* ---------------- 载入题库 / 章节名 ---------------- */
    paintCount();
    $r('[data-papers-list]').innerHTML = '<div class="empty"><b>正在读取题库…</b>稍等。</div>';

    try {
      try {
        const { load } = await import('../data.js');
        const udata = await load('units');
        ((udata && udata.units) || []).forEach(u => { if (u && u.id) S.units[u.id] = u.name; });
      } catch (e) { /* 章节名读不到就用兜底表 */ }

      const idx = await loadIndex();
      const r0 = await loadAll((done, total) => {
        const c = $r('[data-papers-count]');
        if (c) c.textContent = `载入题库 ${done}/${total}…`;
      });
      S.all = r0.questions || [];
      S.idx = idx;
      if (ctx.stale('papers')) return;              /* 505 题全部读完要几秒，先确认还在这一页 */
    } catch (e) {
      S.all = [];
      toast('题库读取失败：' + (e && e.message ? e.message : e));
    }

    /* ---------------- 消费送进来的 id ---------------- */
    /* 两个来源：core.js 的信箱（ctx.takePending，跨模块实例也可靠 —— 首选）
       和本模块的 openWith() 暂存（同一实例直接调用时生效）。 */
    let wantIds = null;
    if (PENDING_IDS && PENDING_IDS.length) {
      wantIds = PENDING_IDS.slice();
      PENDING_IDS = null;                                   // mount 结束即消费掉
    } else {
      const mailed = ctx.takePending ? ctx.takePending('papers') : null;
      if (mailed && mailed.length) wantIds = mailed.slice();
    }
    if (wantIds && wantIds.length) {
      S.mode = 'paper';
    } else {
      S.mode = store.get('papers.mode', 'paper');
      if (S.mode !== 'wrongs') S.mode = 'paper';
    }

    /* ---------------- 筛选下拉 ---------------- */
    const opts = (pairs) => pairs.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    const years = new Set();
    (S.all || []).forEach(q => { if (q.year) years.add(Number(q.year)); });
    ((S.idx && S.idx.years) || []).forEach(y => years.add(Number(y)));
    const yearList = [...years].filter(Boolean).sort((a, b) => b - a);

    $r('[data-pf="city"]').innerHTML = opts([['', '不限城市']].concat(CITIES.map(c => [c.city, c.city])));
    $r('[data-pf="year"]').innerHTML = opts([['', '不限年份']].concat(yearList.map(y => [String(y), y + '年'])));
    $r('[data-pf="unit"]').innerHTML = opts([['', '不限章节']].concat(Object.keys(S.units).map(k => [k, S.units[k]])));
    $r('[data-pf="level"]').innerHTML = opts([['', '不限难度'], ['1', '易'], ['2', '中'], ['3', '难']]);
    $r('[data-pf="kind"]').innerHTML = opts([['', '不限题型'], ['选择', '选择题'], ['填空', '填空题'], ['解答', '解答题']]);

    /* ---------------- 筛选与候选列表 ---------------- */
    /* 用函数声明（有提升），因为早于这里就要画一次计数了 */
    function pool() { return filterQuestions(S.all, S.filter); }
    function selHas(id) { return S.sel.some(q => q.id === id); }

    function paintCount() {
      const hit = pool().length;
      const c = $r('[data-papers-count]');
      if (c) c.textContent = `已选 ${S.sel.length} 题 · 命中 ${hit} 题`;
    }

    function paintList() {
      const list = $r('[data-papers-list]');
      const hits = pool();
      if (!S.all.length) {
        list.innerHTML = `<div class="empty"><b>题库还是空的</b>
          收题脚本还没把卷子放进来（content/bank/&lt;城市&gt;-&lt;年份&gt;.json）。先把题收进来，这里就能按城市、年份、章节抽题了。</div>`;
        paintCount();
        return;
      }
      if (!hits.length) {
        list.innerHTML = '<div class="empty"><b>没有符合条件的题</b>换个城市、年份或难度试试。</div>';
        paintCount();
        return;
      }
      const CAP = 150;
      const shown = hits.slice(0, CAP);
      list.innerHTML = shown.map(q => `
        <label class="papers-item${selHas(q.id) ? ' is-on' : ''}" data-papers-item data-papers-id="${esc(q.id)}">
          <input type="checkbox" class="papers-item__ck" data-papers-pick value="${esc(q.id)}" ${selHas(q.id) ? 'checked' : ''} aria-label="选中" />
          <span class="papers-item__stem">${renderMath(q.stem)}</span>
          <span class="papers-item__meta">${esc(qMeta(q))}</span>
        </label>`).join('')
        + (hits.length > CAP ? `<p class="papers-more">还有 ${hits.length - CAP} 道题未列出 —— 缩小范围再看，或直接用「智能抽题」。</p>` : '');
      paintCount();
    }

    function paintChips() {
      const box = $r('[data-papers-selchips]');
      box.innerHTML = S.sel.length
        ? S.sel.map((q, i) => `<span class="chip chip--accent papers-chip" data-papers-chip="${esc(q.id)}">
             ${i + 1}. ${esc(plainStem(q.stem).slice(0, 16))}${plainStem(q.stem).length > 16 ? '…' : ''}
             <button type="button" class="papers-chip__x" data-papers-unpick="${esc(q.id)}" title="移除" aria-label="移除">${ic('close')}</button>
           </span>`).join('')
        : '<span class="papers-hint">还没有选题 —— 用「智能抽题」按当前范围抽 N 道，或在下面勾选。</span>';
    }

    function setSel(ids) {
      const want = new Set(ids);
      S.sel = S.all.filter(q => want.has(q.id));
    }

    function togglePick(id, on) {
      const q = S.all.find(x => x.id === id);
      if (!q) return;
      if (on && !selHas(id)) S.sel.push(q);
      if (!on) S.sel = S.sel.filter(x => x.id !== id);
    }

    function paintSetup() { paintChips(); paintList(); }

    /* ---------------- 卷面（可打印） ---------------- */
    function paintSheet() {
      const sheet = $r('[data-papers-sheet]');
      if (!S.sel.length) {
        sheet.innerHTML = '<div class="printable__hint">卷面是空的。抽题或勾选几道题，这里会排出题号与留白；交卷后再打印会附上答案与解析。</div>';
        return;
      }
      const keyed = S.sheetKeyed;
      const spaceCls = k => (k === '选择' ? 'choice' : k === '填空' ? 'fill' : 'solve');
      sheet.innerHTML = `
        <header class="printable__head">
          <h3 class="printable__title">组卷练习${S.sel.some(q => q.city) ? '<span class="printable__sub">江苏中考真题选编</span>' : ''}</h3>
          <div class="printable__meta">共 ${S.sel.length} 题 · 方圆 · 数学练习 · ${esc(ctx.dayKey())}</div>
        </header>
        <div class="printable__name">
          <span>姓名 <i>____________</i></span><span>日期 <i>____________</i></span><span>得分 <i>__________</i></span>
        </div>
        <ol class="printable__qs">
          ${S.sel.map((q, i) => `
            <li class="printable__q">
              <div class="printable__stem"><b>${i + 1}.</b> ${renderMath(q.stem)}</div>
              ${(q.choices && q.choices.length) ? `<div class="printable__choices">${q.choices.map(c => `<span>${renderMath(c)}</span>`).join('')}</div>` : ''}
              ${q.fig ? `<div class="printable__fig" data-fig="${esc(q.fig)}"></div>` : ''}
              <div class="printable__space printable__space--${spaceCls(q.kind)}"></div>
              ${keyed ? `<div class="printable__key"><b>答案：</b>${renderMath(q.answer)}${q.solution ? `　<b>解析：</b>${renderMath(q.solution)}` : ''}</div>` : ''}
            </li>`).join('')}
        </ol>
        <footer class="printable__foot">方圆 · 数据只保存在这台机器上</footer>`;
      mountFigs(sheet);
    }

    /* ---------------- 错题一页纸 ---------------- */
    const WRONGS_CAP = 40;
    function wrongsList() {
      let list = (ctx.store.get('wrongs', []) || []).slice();
      if (S.wrongsOpen) list = list.filter(w => !w.mastered);
      list.sort((a, b) => (b.at || 0) - (a.at || 0));       // 新错题在前
      return list;
    }
    function paintWrongs() {
      const all = wrongsList();
      const sheet = $r('[data-wrongs-sheet]');
      const cnt = $r('[data-papers-wrongscount]');
      const totalAll = (ctx.store.get('wrongs', []) || []).length;
      if (cnt) cnt.textContent = S.wrongsOpen ? `未掌握 ${all.length} / 共 ${totalAll}` : `共 ${totalAll} 条`;
      if (!all.length) {
        sheet.innerHTML = `<div class="printable__hint">错题本${S.wrongsOpen ? '里没有未掌握的题' : '还是空的'}。做题错了会自动收进来，这里就能排成一页纸。</div>`;
        return;
      }
      const rows = all.slice(0, WRONGS_CAP);
      sheet.innerHTML = `
        <header class="printable__head">
          <h3 class="printable__title">错题一页纸</h3>
          <div class="printable__meta">${rows.length} 道${all.length > rows.length ? `（共 ${all.length} 道，这里排前 ${rows.length} 道）` : ''} · 方圆 · 数学练习 · ${esc(ctx.dayKey())}</div>
        </header>
        <ol class="printable__rows">
          ${rows.map((w, i) => `
            <li class="printable__row">
              <span class="printable__no">${i + 1}</span>
              <span class="printable__stem">${renderMath(w.stem)}</span>
              ${w.fig ? `<span class="printable__fig" data-fig="${esc(w.fig)}"></span>` : ''}
              <span class="printable__mine">我：${w.mine ? renderMath(w.mine) : '<i>—</i>'}</span>
              <span class="printable__ans">正：${renderMath(w.answer || '—')}</span>
              <span class="printable__why">${w.why ? renderMath(w.why) : ''}</span>
            </li>`).join('')}
        </ol>
        <footer class="printable__foot">方圆 · 数据只保存在这台机器上</footer>`;
      mountFigs(sheet);
    }

    /* ---------------- 做卷 ---------------- */
    function paintWork() {
      const box = $r('[data-papers-work]');
      const R = S.round;
      if (!R) {
        box.innerHTML = '<p class="papers-hint papers-hint--work">还没开始做卷。选好题后点「开始做卷」，这里会一题一题请你作答。</p>';
        return;
      }
      if (R.finished) {
        box.innerHTML = `<p class="papers-hint papers-hint--work">这一份已经做完，成绩在下面。想再来一遍就再点「开始做卷」。</p>`;
        return;
      }
      const q = R.qs[R.i];
      const pct = Math.round(R.done / R.qs.length * 100);
      box.innerHTML = `
        <div class="papers-work__top">
          <span class="papers-chip2">第 ${R.i + 1} / ${R.qs.length} 题</span>
          <span class="papers-chip2 papers-chip2--dim">${esc(kindName(q.kind))} · 难度${esc(levelName(q.level))}</span>
          <span class="papers-timer" data-pw-timer>${fmtTime(Date.now() - R.start)}</span>
        </div>
        <div class="papers-progressbar"><i style="width:${pct}%"></i></div>
        <div class="papers-stem" data-pw-stem>${renderMath(q.stem)}</div>
        ${q.fig ? `<div class="fig" data-fig="${esc(q.fig)}" aria-label="${esc(q.figAlt || '题图')}"></div>` : ''}
        <div class="papers-choices" data-pw-choices ${(q.choices && q.choices.length) ? '' : 'hidden'}>
          ${(q.choices || []).map((c, i) => `<button type="button" class="papers-choice" data-pw-choice="${i}"><b>${'ABCD'[i]}</b><span>${renderMath(c)}</span></button>`).join('')}
        </div>
        <div class="papers-answer">
          <input class="papers-input" data-pw-input inputmode="text" autocomplete="off" enterkeyhint="done" placeholder="写下答案，回车提交" aria-label="你的答案" />
          <button type="button" class="btn btn--primary" data-pw-submit>提交</button>
        </div>
        <p class="papers-judge" data-pw-judge></p>
        <div class="btn-row">
          <button type="button" class="btn btn--ghost btn--sm" data-pw-skip>跳过</button>
          <button type="button" class="btn btn--ghost btn--sm" data-pw-end>交卷</button>
        </div>`;

      const input = $r('[data-pw-input]');
      const submit = $r('[data-pw-submit]');
      submit.addEventListener('click', doSubmit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
      $r('[data-pw-skip]').addEventListener('click', () => nextQuestion());
      $r('[data-pw-end]').addEventListener('click', () => finishPaper());
      $$r('[data-pw-choice]').forEach(b => b.addEventListener('click', () => {
        input.value = (q.choices || [])[Number(b.dataset.pwChoice)] || '';
        doSubmit();
      }));
      try { input.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
      mountFigs(box);
    }

    function pushWrong(q, mine) {
      const list = ctx.store.get('wrongs', []) || [];
      const hit = list.find(x => x.id === q.id);
      if (hit) { hit.tries = (hit.tries || 1) + 1; ctx.store.set('wrongs', list.slice(-500)); return false; }
      list.push({
        id: q.id, stem: q.stem, answer: q.answer, mine,
        why: q.solution || '', unit: q.unit || '', at: Date.now(), tries: 1, mastered: false,
        fig: q.fig || '',                       /* 题图跟着进错题本，一页纸上也能看到图 */
      });
      ctx.store.set('wrongs', list.slice(-500));
      return true;
    }

    function doSubmit() {
      const R = S.round;
      if (!R || R.finished) return;
      if (R.answered) return nextQuestion();
      const q = R.qs[R.i];
      const input = $r('[data-pw-input]');
      const mine = (input && input.value || '').trim();
      if (!mine) { toast('先写上答案'); return; }

      const ok = ansEq(mine, q.answer);
      R.answered = true; R.done++; if (ok) R.right++;
      R.answers.push({ id: q.id, mine, ok });

      const judge = $r('[data-pw-judge]');
      judge.className = 'papers-judge ' + (ok ? 'is-ok' : 'is-no');
      judge.textContent = ok
        ? `答对了。${q.solution ? '　' + q.solution : ''}`
        : `答错了。正确答案：${q.answer}。${q.solution ? '　' + q.solution : ''}`;
      if (!ok && pushWrong(q, mine)) toast('已收进错题本');

      const submit = $r('[data-pw-submit]');
      submit.textContent = '下一题';
      if (input) input.disabled = true;
      try { ctx.track('papers', `组卷 · ${ok ? '对' : '错'} · ${q.stem}`); } catch (e) { /* 忽略 */ }
    }

    function nextQuestion() {
      const R = S.round;
      if (!R || R.finished) return;
      if (R.i + 1 >= R.qs.length) return finishPaper();
      R.i++; R.answered = false;
      paintWork();
    }

    function finishPaper() {
      const R = S.round;
      if (!R || R.finished) return;
      if (TICK) { clearInterval(TICK); TICK = null; }
      R.finished = true;
      R.ms = Date.now() - R.start;
      const done = R.done, right = R.right;
      const acc = done ? Math.round(right / done * 100) : 0;
      const wrongs = R.answers.filter(a => !a.ok);

      $r('[data-papers-result]').innerHTML = `
        <div class="papers-score">
          <div class="metric"><div class="n">${right}<span>/${done}</span></div><div class="k">答对 / 作答</div></div>
          <div class="metric"><div class="n">${acc}<span>%</span></div><div class="k">正确率</div></div>
          <div class="metric"><div class="n">${fmtTime(R.ms)}</div><div class="k">用时</div></div>
          <div class="metric"><div class="n">${wrongs.length}</div><div class="k">错题（已入本）</div></div>
        </div>
        ${wrongs.length ? `<div class="papers-wronglist">${wrongs.map(a => {
          const q = R.qs.find(x => x.id === a.id) || {};
          return `<div class="papers-wrongitem">
            <div class="papers-wrongitem__stem">${renderMath(q.stem || '')}</div>
            <div class="papers-wrongitem__meta">你填：${renderMath(a.mine) || '—'}　正确：${renderMath(q.answer || '')}</div>
            ${q.solution ? `<div class="papers-wrongitem__why">${renderMath(q.solution)}</div>` : ''}
          </div>`;
        }).join('')}</div>` : '<p class="papers-hint">全部答对，没有错题。卷面已附上答案与解析，可以打印留档。</p>'}
        <div class="btn-row">
          <button type="button" class="btn btn--primary" data-papers-again>再做一遍</button>
        </div>`;
      const again = $r('[data-papers-again]');
      if (again) again.addEventListener('click', () => startPaper());

      S.sheetKeyed = true;                 // 交卷后卷面附答案
      paintSheet();
      paintWork();
      try { ctx.track('papers', `组卷完成 · ${right}/${done} · ${fmtTime(R.ms)} · ${S.sel.length} 题`); } catch (e) { /* 忽略 */ }
    }

    function startPaper() {
      if (TICK) { clearInterval(TICK); TICK = null; }
      if (!S.sel.length) { toast(S.all.length ? '先抽题或勾选几道题' : '题库还是空的，先去收题'); return; }
      S.sheetKeyed = false;
      S.round = { qs: S.sel.slice(), i: 0, right: 0, done: 0, answered: false, finished: false, start: Date.now(), ms: 0, answers: [] };
      $r('[data-papers-result]').innerHTML = '';
      paintSheet();
      paintWork();
      TICK = setInterval(() => {
        const t = $r('[data-pw-timer]');
        if (!t) { if (TICK) { clearInterval(TICK); TICK = null; } return; }
        const R = S.round;
        if (R && !R.finished) t.textContent = fmtTime(Date.now() - R.start);
      }, 250);
      const work = $r('[data-papers-work]');
      try { work.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 模块切换 ---------------- */
    function paintMode() {
      root.dataset.papersMode = S.mode;
      $$r('[data-papers-modetab]').forEach(b => {
        const on = b.dataset.papersModetab === S.mode;
        b.setAttribute('aria-pressed', String(on));
      });
      $$r('[data-papers-panel]').forEach(p => { p.hidden = p.dataset.papersPanel !== S.mode; });
      store.set('papers.mode', S.mode);
      if (S.mode === 'wrongs') paintWrongs();
      else paintSheet();
    }
    function setMode(m) { S.mode = m === 'wrongs' ? 'wrongs' : 'paper'; paintMode(); }

    /* ---------------- 打印 ---------------- */
    function doPrint() {
      if (S.mode === 'wrongs') paintWrongs();
      else { paintSheet(); }
      // 让浏览器先完成一次布局，再唤起打印
      setTimeout(() => { try { window.print(); } catch (e) { toast('这台浏览器不支持直接打印，用 Ctrl+P 试试'); } }, 80);
    }

    /* ---------------- 事件绑定 ---------------- */
    $$r('[data-papers-modetab]').forEach(b =>
      b.addEventListener('click', () => setMode(b.dataset.papersModetab)));

    $$r('[data-pf]').forEach(el => el.addEventListener('input', () => {
      S.filter[el.dataset.pf] = el.value;
      paintSetup();
    }));
    $$r('[data-pf]').forEach(el => el.addEventListener('change', () => {
      S.filter[el.dataset.pf] = el.value;
      paintSetup();
    }));

    $r('[data-papers-n]').addEventListener('input', e => { S.n = clamp(Number(e.target.value) || 1, 1, 40); });

    $r('[data-papers-random]').addEventListener('click', () => {
      const p = pool();
      if (!p.length) { toast(S.all.length ? '没有符合当前范围的题' : '题库还是空的，先去「题库」收题'); return; }
      S.n = clamp(Number($r('[data-papers-n]').value) || S.n, 1, 40);
      S.sel = shuffle(p).slice(0, S.n);
      S.sheetKeyed = false;
      paintSetup(); paintSheet();
      toast(`已抽 ${S.sel.length} 题`);
    });

    $r('[data-papers-clear]').addEventListener('click', () => {
      if (!S.sel.length) { toast('本来就是空的'); return; }
      S.sel = []; S.sheetKeyed = false;
      paintSetup(); paintSheet();
    });

    $r('[data-papers-list]').addEventListener('change', e => {
      const ck = e.target.closest('[data-papers-pick]');
      if (!ck) return;
      togglePick(ck.value, ck.checked);
      const item = ck.closest('[data-papers-item]');
      if (item) item.classList.toggle('is-on', ck.checked);
      paintChips(); paintCount();
    });
    $r('[data-papers-list]').addEventListener('click', e => {
      const x = e.target.closest('[data-papers-unpick]');
      if (!x) return;
      togglePick(x.dataset.papersUnpick, false);
      paintSetup();
    });
    $r('[data-papers-selchips]').addEventListener('click', e => {
      const x = e.target.closest('[data-papers-unpick]');
      if (!x) return;
      togglePick(x.dataset.papersUnpick, false);
      paintSetup();
    });

    $r('[data-papers-start]').addEventListener('click', startPaper);
    $$r('[data-papers-print]').forEach(b => b.addEventListener('click', doPrint));
    $r('[data-papers-wrongsopen]').addEventListener('click', () => { S.wrongsOpen = true; paintWrongs(); });
    $r('[data-papers-wrongsall]').addEventListener('click', () => { S.wrongsOpen = false; paintWrongs(); });

    /* ---------------- 起飞 ---------------- */
    if (wantIds) {
      const found = wantIds.filter(id => S.all.some(q => q.id === id));
      setSel(found);
      const miss = wantIds.length - found.length;
      if (found.length) toast(`从题库取来 ${found.length} 题`);
      else if (S.all.length) toast('传来的题不在题库里');
      else toast('题库还是空的，取不到题');
      if (miss > 0 && found.length) toast(`有 ${miss} 题不在题库里，已跳过`);
      S.sheetKeyed = false;
    }
    paintSetup();
    paintSheet();
    paintWork();
    paintMode();
  },
};
