/* ==========================================================================
   方圆 · views/bank.js —— 题库浏览
   按城市 / 年份 / 题型 / 章节 / 难度 / 关键词筛题；点条目在抽屉里看题干、选项、
   答案、解析与来源；勾选若干题后可「拿去组卷」（交给同目录的 papers.js）。

   数据全部来自父级加载器 ../bank.js：
     loadIndex() / loadAll(cb) / filterQuestions(list, opt) / CITIES / KIND_NAMES / LEVEL_NAMES
   题库为空时（另一批还在收题）显示友好空状态，并从 loadIndex().gaps 读出「还缺哪些卷子」。
   与 papers.js 是跨视图协议：m.openWith(ids) 收下题目 id 数组，再 ctx.go('papers')。
   ========================================================================== */
import { esc } from '../core.js';
import {
  loadIndex, loadAll, filterQuestions, CITIES, KIND_NAMES, LEVEL_NAMES,
} from '../bank.js';
import { renderMath } from '../lib/mathfmt.js';
import { mountFigs } from '../fig.js';

/* 八个章节（与 tools/BANK.md 的 unit 表一致；内容固定，不随题库多少变化） */
const UNITS = [
  { id: 'u1', name: '有理数与实数', grade: '七年级上' },
  { id: 'u2', name: '代数式与整式', grade: '七年级上' },
  { id: 'u3', name: '一元一次方程', grade: '七年级上' },
  { id: 'u4', name: '不等式与不等式组', grade: '七年级下' },
  { id: 'u5', name: '一次函数', grade: '八年级下' },
  { id: 'u6', name: '二次函数', grade: '九年级上' },
  { id: 'u7', name: '勾股定理与全等三角形', grade: '八年级上' },
  { id: 'u8', name: '相似与圆', grade: '九年级上' },
];
const unitOf = id => UNITS.find(u => u.id === id) || null;
const unitName = id => (unitOf(id) || {}).name || '';
const unitFull = id => {
  const u = unitOf(id);
  return u ? `${u.name}（${u.grade}）` : '';
};

const FILTER_KEYS = ['city', 'year', 'kind', 'unit', 'level'];

/* 来源地址：只把 http(s) 渲染成可点的链接，其余原样显示 */
function isUrl(s) {
  return /^https?:\/\//i.test(String(s || ''));
}

export default {
  id: 'bank', name: '题库', icon: 'db', nav: true,

  async mount(root, ctx) {
    /* ---------- 清单（题库空也能读，返回空结构而不是抛错） ---------- */
    let idx = { total: 0, gaps: [], years: [], cities: [] };
    try { idx = await loadIndex(); } catch (e) { /* 交给下面的空状态处理 */ }
    if (ctx.stale('bank')) return;                  /* 清单一到手就先看一眼还在不在这一页 */
    const gaps = Array.isArray(idx.gaps) ? idx.gaps : [];

    let years = Array.isArray(idx.years) ? idx.years.slice() : [];
    if (!years.length) {
      const set = new Set();
      (idx.cities || []).forEach(c => (c.years || []).forEach(y => set.add(y.year)));
      years = [...set].sort((a, b) => a - b);
    }

    /* ---------- 状态 ---------- */
    const state = { city: '', year: '', kind: '', unit: '', level: '', q: '', picked: new Set() };

    /* ---------- 骨架（先把全部钩子渲染出来，题库为空时也齐） ---------- */
    const cityOpts = CITIES.map(c => `<option value="${esc(c.city)}">${esc(c.city)}</option>`).join('');
    const yearOpts = years.map(y => `<option value="${esc(y)}">${esc(y)} 年</option>`).join('');
    const kindOpts = Object.entries(KIND_NAMES).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    const unitOpts = UNITS.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const levelOpts = Object.keys(LEVEL_NAMES).map(k => `<option value="${esc(k)}">${esc(LEVEL_NAMES[k])}</option>`).join('');

    root.innerHTML = `
      <div class="bk" data-bank="1">
        <section class="view-head">
          <div class="kicker">题库</div>
          <h2>江苏中考真题库</h2>
          <p>按城市、年份、章节、难度筛题；点开看题干与解析，勾选后可以拿去组卷。</p>
        </section>

        <div class="card glass bk-tool">
          <div class="card__label">筛选</div>
          <div class="bk-filters">
            <label class="field bk-f"><span class="bk-f__k">城市</span>
              <select data-bank-city aria-label="按城市筛选"><option value="">全部城市</option>${cityOpts}</select></label>
            <label class="field bk-f"><span class="bk-f__k">年份</span>
              <select data-bank-year aria-label="按年份筛选"><option value="">全部年份</option>${yearOpts}</select></label>
            <label class="field bk-f"><span class="bk-f__k">题型</span>
              <select data-bank-kind aria-label="按题型筛选"><option value="">全部题型</option>${kindOpts}</select></label>
            <label class="field bk-f"><span class="bk-f__k">章节</span>
              <select data-bank-unit aria-label="按章节筛选"><option value="">全部章节</option>${unitOpts}</select></label>
            <label class="field bk-f"><span class="bk-f__k">难度</span>
              <select data-bank-level aria-label="按难度筛选"><option value="">全部难度</option>${levelOpts}</select></label>
            <label class="field bk-f bk-f--q">
              ${ctx.ic('search', 'bk-f__ic')}
              <input data-bank-q type="search" inputmode="search" autocomplete="off"
                     placeholder="搜题干、答案、解析或考点…" aria-label="关键词搜索" />
            </label>
          </div>
          <div class="bk-tool__foot">
            <div class="bk-count" data-bank-count aria-live="polite">正在读题…</div>
            <div class="btn-row">
              <button class="btn btn--ghost btn--sm" type="button" data-bank-all>选中命中</button>
              <button class="btn btn--ghost btn--sm" type="button" data-bank-reset>重置筛选</button>
            </div>
          </div>
        </div>

        <div class="card glass bk-build" data-bank-buildbar>
          <div class="bk-build__info">
            <span class="bk-build__n">已勾选 <b data-bank-picked>0</b> 题</span>
            <span class="bk-build__hint">勾选后可拿去组卷</span>
          </div>
          <div class="btn-row">
            <button class="btn btn--primary btn--sm" type="button" data-bank-build disabled>${ctx.ic('right')}把勾选的题拿去组卷</button>
            <button class="btn btn--ghost btn--sm" type="button" data-bank-clear disabled>清空勾选</button>
          </div>
        </div>

        <div class="bk-list" data-bank-list>
          <div class="bk-loading">正在读题… <span data-bank-progress></span></div>
        </div>
      </div>`;

    const wrap = root.querySelector('[data-bank="1"]');
    const listEl = root.querySelector('[data-bank-list]');
    const countEl = root.querySelector('[data-bank-count]');
    const qEl = root.querySelector('[data-bank-q]');
    const pickEl = root.querySelector('[data-bank-picked]');
    const buildBtn = root.querySelector('[data-bank-build]');
    const clearBtn = root.querySelector('[data-bank-clear]');

    /* ---------- 读全部题（带进度） ---------- */
    let all = [];
    let loadErr = '';
    try {
      const res = await loadAll((done, total) => {
        const p = root.querySelector('[data-bank-progress]');
        if (p) p.textContent = total ? `${done}/${total} 份卷子` : '';
      });
      all = Array.isArray(res.questions) ? res.questions : [];
    } catch (e) {
      loadErr = e && e.message ? e.message : String(e);
    }
    if (ctx.stale('bank')) return;                  /* 505 题读完可能要一会儿，先确认还在这一页 */

    /* 城市 → 年份 → 题号 排序（加载器已排过，这里再兜一次底） */
    all.sort((a, b) =>
      String(a.city || '').localeCompare(String(b.city || ''), 'zh')
      || (Number(a.year) || 0) - (Number(b.year) || 0)
      || (Number(a.no) || 0) - (Number(b.no) || 0));

    /* ---------- 单项 ---------- */
    const itemHTML = q => {
      const id = String(q.id);
      const u = unitName(q.unit);
      const lv = LEVEL_NAMES[q.level] || '';
      const tags = (q.tags || []).slice(0, 4);
      return `<article class="bk-item" data-bank-item data-bank-id="${esc(id)}">
        <label class="bk-pick" title="勾选这道题">
          <input type="checkbox" data-bank-pick aria-label="勾选第 ${esc(q.no)} 题" />
        </label>
        <button class="bk-item__btn" type="button" data-bank-open>
          <span class="bk-item__top">
            <span class="bk-no">${esc(q.no)}</span>
            <span class="bk-chip">${esc(q.city || '')}${q.year ? ` · ${esc(q.year)}` : ''}</span>
            <span class="bk-chip">${esc(KIND_NAMES[q.kind] || q.kind || '')}</span>
            ${q.fig ? '<span class="bk-chip bk-chip--fig" title="这道题带图">图</span>' : ''}
            ${u ? `<span class="bk-chip bk-chip--unit">${esc(u)}</span>` : ''}
            ${lv ? `<span class="bk-chip bk-lv bk-lv--${esc(q.level)}">${esc(lv)}</span>` : ''}
          </span>
          <span class="bk-item__stem fx-math">${renderMath(q.stem)}</span>
          ${tags.length ? `<span class="bk-item__tags">${tags.map(t => `<span class="bk-tag">${esc(t)}</span>`).join('')}</span>` : ''}
        </button>
        <span class="bk-item__chev" aria-hidden="true">${ctx.ic('right')}</span>
      </article>`;
    };

    /* ---------- 空状态 ---------- */
    function emptyBankHTML() {
      const shown = gaps.slice(0, 15);
      return `<div class="card glass bk-empty">
        <div class="bk-empty__mark">${ctx.ic('db')}</div>
        <b>题库还没收题</b>
        <p>真题正在收集中 —— 已经收进来的卷子会自动出现在这一页。</p>
        ${gaps.length ? `<div class="bk-gaps">
          <div class="bk-gaps__k">还缺这些卷子 · 共 ${gaps.length} 份</div>
          <div class="chips">${shown.map(g => `<span class="chip">${esc(g)}</span>`).join('')}${
            gaps.length > shown.length ? `<span class="chip chip--accent">…等 ${gaps.length} 份</span>` : ''}</div>
        </div>` : ''}
      </div>`;
    }
    const emptyFilterHTML = () => `<div class="card glass bk-empty">
        <div class="bk-empty__mark">${ctx.ic('search')}</div>
        <b>这个筛选下没有题目</b>
        <p>换个城市、年份或难度，或点「重置筛选」从头看。</p>
      </div>`;

    /* ---------- 勾选状态同步 ---------- */
    function syncPickUI() {
      let n = 0;
      root.querySelectorAll('[data-bank-item]').forEach(it => {
        const id = it.dataset.bankId;
        const on = state.picked.has(id);
        it.classList.toggle('is-picked', on);
        const cb = it.querySelector('[data-bank-pick]');
        if (cb && cb.checked !== on) cb.checked = on;
        if (on) n++;
      });
      pickEl.textContent = String(n);
      buildBtn.disabled = n === 0;
      clearBtn.disabled = n === 0;
    }

    /* ---------- 重绘列表 ---------- */
    function apply() {
      const rows = filterQuestions(all, {
        city: state.city, year: state.year, kind: state.kind,
        unit: state.unit, level: state.level, q: state.q,
      });
      countEl.textContent = `共 ${all.length} 题 / 命中 ${rows.length} 题`;

      if (loadErr) {
        listEl.innerHTML = `<div class="card glass bk-empty">
          <div class="bk-empty__mark">${ctx.ic('ban')}</div>
          <b>题库没读出来</b><p>${esc(loadErr)}</p></div>`;
      } else if (!all.length) {
        listEl.innerHTML = emptyBankHTML();
      } else if (!rows.length) {
        listEl.innerHTML = emptyFilterHTML();
      } else {
        listEl.innerHTML = rows.map(itemHTML).join('');
      }
      syncPickUI();
    }

    /* ---------- 抽屉：看题 ---------- */
    function openItem(id) {
      const q = all.find(x => String(x.id) === String(id));
      if (!q) return;
      const u = unitOf(q.unit);
      const picked = state.picked.has(String(q.id));
      const src = q.src || '';
      ctx.track('bank.view', `${q.city || ''}${q.year || ''}·第${q.no}题`);

      ctx.openDrawer({
        title: `${q.city || ''}${q.year || ''} · 第 ${q.no} 题`,
        sub: [KIND_NAMES[q.kind] || q.kind, u ? u.name : ''].filter(Boolean).join(' · '),
        html: `
          <div class="bk-drawer">
            <div class="bk-drawer__meta">
              <span class="bk-chip">${esc(q.city || '')}${q.year ? ` · ${esc(q.year)}` : ''}</span>
              <span class="bk-chip">${esc(KIND_NAMES[q.kind] || q.kind || '')}</span>
              ${u ? `<span class="bk-chip bk-chip--unit">${esc(unitFull(q.unit))}</span>` : ''}
              ${LEVEL_NAMES[q.level] ? `<span class="bk-chip bk-lv bk-lv--${esc(q.level)}">${esc(LEVEL_NAMES[q.level])}</span>` : ''}
            </div>

            <div class="bk-sec">
              <div class="bk-sec__label">题干</div>
              <div class="bk-drawer__stem fx-math">${renderMath(q.stem)}</div>
              ${q.fig ? `<div class="fig" data-fig="${esc(q.fig)}" aria-label="${esc(q.figAlt || '题图')}"></div>` : ''}
            </div>

            ${(q.choices && q.choices.length) ? `<div class="bk-choices fx-math">
              ${q.choices.map((c, i) => `<div class="bk-choice">
                <span class="bk-choice__k">${String.fromCharCode(65 + i)}</span>
                <span class="bk-choice__v">${renderMath(String(c).replace(/^[A-D][．.、]\s*/, ''))}</span>
              </div>`).join('')}
            </div>` : ''}

            <hr class="hr" />
            <div class="kv"><b>答案</b><span class="bk-ans fx-math">${renderMath(q.answer)}</span></div>

            ${q.solution ? `<div class="bk-sec">
              <div class="bk-sec__label">解析</div>
              <div class="bk-drawer__why fx-math">${renderMath(q.solution)}</div>
            </div>` : ''}

            ${(q.tags && q.tags.length) ? `<div class="bk-sec">
              <div class="bk-sec__label">考点</div>
              <div class="chips">${q.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
            </div>` : ''}

            <hr class="hr" />
            <div class="kv"><b>来源</b><span>${
              isUrl(src)
                ? `<a class="bk-src" href="${esc(src)}" target="_blank" rel="noopener noreferrer">打开原页 ↗</a>`
                : (src ? esc(src) : '未标注')
            }</span></div>

            <div class="btn-row" style="margin-top:18px">
              <button class="btn btn--sm" type="button" data-bank-drawer-pick>
                ${ctx.ic('check')}${picked ? '已勾选 · 点此取消' : '勾选这道题'}
              </button>
            </div>
          </div>`,
      });

      mountFigs(document.querySelector('#drawer'));

      const dp = document.querySelector('#drawer [data-bank-drawer-pick]');
      if (dp) dp.addEventListener('click', () => {
        const key = String(q.id);
        if (state.picked.has(key)) state.picked.delete(key); else state.picked.add(key);
        syncPickUI();
        ctx.toast(state.picked.has(key) ? '已勾选' : '已取消勾选');
        ctx.closeDrawer();
      });
    }

    /* ---------- 组卷 ---------- */
    async function build() {
      const ids = [...state.picked];
      if (!ids.length) { ctx.toast('先勾几道题再组卷'); return; }
      buildBtn.disabled = true;
      try {
        /* 走 core.js 的信箱：这里若直接 import('./papers.js')，会拿到与路由里
           `papers.js?v=…` **不同的模块实例**，参数送不到真正挂载的那一份（实测「已选 0 题」）。
           仍然保留 openWith() 调用：万一将来两处引的是同一份，也能生效。 */
        ctx.setPending('papers', ids);
        try {
          const m = await import('./papers.js');
          if (m && typeof m.openWith === 'function') m.openWith(ids);
        } catch (e) { /* papers.js 还没落地也无妨：信箱里已经放好了 */ }
        ctx.track('bank.build', `送 ${ids.length} 题去组卷`);
        ctx.go('papers');
      } catch (err) {
        console.warn('组卷模块没就绪：', err);
        ctx.toast('组卷模块还没就绪（papers.js 未落地），勾选先留着。');
      } finally {
        buildBtn.disabled = state.picked.size === 0;
      }
    }

    /* ---------- 交互：点击 ---------- */
    wrap.addEventListener('click', e => {
      const openBtn = e.target.closest('[data-bank-open]');
      if (openBtn) { openItem(openBtn.closest('[data-bank-item]').dataset.bankId); return; }
      if (e.target.closest('[data-bank-build]')) { build(); return; }
      if (e.target.closest('[data-bank-clear]')) { state.picked.clear(); syncPickUI(); return; }
      if (e.target.closest('[data-bank-all]')) {
        const rows = filterQuestions(all, {
          city: state.city, year: state.year, kind: state.kind,
          unit: state.unit, level: state.level, q: state.q,
        });
        if (!rows.length) { ctx.toast('当前没有命中的题目'); return; }
        rows.forEach(q => state.picked.add(String(q.id)));
        syncPickUI();
        ctx.toast(`已选中 ${rows.length} 题`);
        return;
      }
      if (e.target.closest('[data-bank-reset]')) {
        state.city = state.year = state.kind = state.unit = state.level = state.q = '';
        qEl.value = '';
        FILTER_KEYS.forEach(k => {
          const s = root.querySelector(`[data-bank-${k}]`);
          if (s) s.value = '';
        });
        apply();
        return;
      }
    });

    /* ---------- 交互：勾选 / 下拉 ---------- */
    wrap.addEventListener('change', e => {
      const cb = e.target.closest('[data-bank-pick]');
      if (cb) {
        const id = cb.closest('[data-bank-item]').dataset.bankId;
        if (cb.checked) state.picked.add(id); else state.picked.delete(id);
        syncPickUI();
        return;
      }
      for (const k of FILTER_KEYS) {
        const s = e.target.closest(`[data-bank-${k}]`);
        if (s) { state[k] = s.value; apply(); return; }
      }
    });

    /* ---------- 关键词（即时） ---------- */
    qEl.addEventListener('input', () => { state.q = qEl.value; apply(); });
    qEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { qEl.value = ''; state.q = ''; apply(); }
    });

    apply();
  },
};
