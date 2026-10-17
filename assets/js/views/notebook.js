/* ==========================================================================
   方圆 · views/notebook.js —— 错题本
   数据来自本机 ctx.store 的 'wrongs'：练习页 / 今日页写进去，这里读、改、删。
   每一项：{ id, stem, answer, mine, why, unit, at, tries, mastered }
   ========================================================================== */
import { $, $$, esc, ic } from '../core.js';
import { load } from '../data.js';

/* ---------- 判分：宽容比较 ----------
   1) 全角 → 半角（数字/字母/标点），去掉空白与顿号逗号
   2) 去掉「x=」这类前缀
   3) 数值/分数等价：1/2 与 0.5、2 与 2.0 都算对
（题目要求“至少做去空格比较”，这里在此之上再宽一点，宁可判对也不冤判） */
const half = s => String(s ?? '')
  .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // ！-～ 全角段
  .replace(/\u3000/g, ' ');                                                          // 全角空格

const norm = s => half(s)
  .replace(/\s+/g, '')
  .replace(/[、,，]/g, '')
  .replace(/^[a-z]=/, '')
  .toLowerCase();

const toNum = s => {
  const t = norm(s);
  if (!/^[-+]?\d+(?:\.\d+)?(?:\/[-+]?\d+(?:\.\d+)?)?$/.test(t)) return null;
  const [a, b] = t.split('/');
  if (b === undefined) return Number(t);
  const d = Number(b);
  if (!d) return null;
  return Number(a) / d;
};

function equivalent(a, b) {
  if (a == null || b == null) return false;
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const xa = toNum(a), xb = toNum(b);
  if (xa != null && xb != null && Math.abs(xa - xb) < 1e-9) return true;
  return false;
}

const FILTERS = [
  { id: 'all',        label: '全部' },
  { id: 'unmastered', label: '未掌握' },
  { id: 'mastered',   label: '已掌握' },
];

export default {
  id: 'notebook', name: '错题', icon: 'notes', nav: true,

  async mount(root, ctx) {
    /* ---- 章节名：content/units.json 的 id → name ---- */
    let units = [];
    try {
      const u = await load('units');
      units = (u && u.units) || [];
    } catch (e) {
      units = [];                       // 拿不到章节表也不影响错题本本身
    }
    if (ctx.stale('notebook')) return;  /* 数据到手时用户可能已经切走了 */
    const unitName = id => {
      const u = units.find(x => x.id === id);
      return u ? u.name : (id || '未分类');
    };

    const state = { filter: 'all', unit: '', flash: {} };

    /* ---- 读 / 写（永远重新读，别人在别处写入也能立刻看到） ---- */
    const read = () => {
      const arr = ctx.store.get('wrongs', []);
      return Array.isArray(arr) ? arr : [];
    };
    const write = arr => ctx.store.set('wrongs', arr);
    const byTime = arr => arr.slice().sort((a, b) => (b.at || 0) - (a.at || 0));
    const visible = () => byTime(read()).filter(w => {
      if (state.filter === 'mastered' && !w.mastered) return false;
      if (state.filter === 'unmastered' && w.mastered) return false;
      if (state.unit && w.unit !== state.unit) return false;
      return true;
    });

    /* ---- 骨架 ---- */
    root.innerHTML = `
      <div class="nb" data-nb="1">
        <section class="view-head">
          <div class="kicker">错题</div>
          <h2>错题本</h2>
          <p>做错的题会自动收进来。可以重做、标记掌握，也可以导出带走。</p>
        </section>

        <div class="card glass spec nb-tool">
          <div class="nb-tool__top">
            <div class="nb-stats" data-nb-stats>—</div>
            <button class="btn btn--ghost btn--sm nb-export" data-nb-export>${ic('down')}导出 Markdown</button>
          </div>
          <div class="nb-tool__filters" role="group" aria-label="按掌握情况筛选">
            ${FILTERS.map(f => `<button class="nb-toggle" type="button" data-nb-filter="${f.id}"
              aria-pressed="${f.id === 'all'}">${f.label}</button>`).join('')}
          </div>
          <label class="field nb-unitfield">章节
            <select data-nb-unit>
              <option value="">全部章节</option>
              ${units.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="nb-list" data-nb-list></div>
      </div>
    `;

    const wrap = $('[data-nb="1"]', root);
    const statsEl = $('[data-nb-stats]', root);
    const listEl = $('[data-nb-list]', root);
    const unitSel = $('[data-nb-unit]', root);

    /* ---- 单项 ---- */
    const itemHTML = w => {
      const fb = state.flash[w.id];
      let extra = '';
      if (fb) {
        extra = `<div class="nb-verdict ${fb.ok ? 'nb-verdict--ok' : 'nb-verdict--no'}">
            ${fb.ok ? '✓ 答对了' : '✗ 还差一点'}：你填「${esc(fb.mine)}」${fb.ok ? '，已标记为掌握。' : '。'}
          </div>`;
        if (!fb.ok) {
          extra += `<div class="nb-why">
              <div class="nb-why__row"><b>正确答案</b><span class="nb-ans__val">${esc(w.answer)}</span></div>
              ${w.why ? `<div class="nb-why__text">${esc(w.why)}</div>` : ''}
            </div>`;
        }
      }
      return `
      <article class="card glass nb-item${w.mastered ? ' nb-item--done' : ''}" data-nb-item data-nb-id="${esc(w.id)}">
        <div class="nb-item__head">
          <span class="nb-chip">${esc(unitName(w.unit))}</span>
          ${w.mastered ? '<span class="nb-chip nb-chip--ok">已掌握</span>' : ''}
          <span class="nb-time">${esc(ctx.stamp(w.at || Date.now()))}</span>
        </div>
        <div class="nb-stem">${esc(w.stem)}</div>
        <div class="nb-answers">
          <div class="nb-ans nb-ans--mine"><b>我的答案</b><span class="nb-ans__val">${esc(w.mine)}</span></div>
          <div class="nb-ans nb-ans--right"><b>正确答案</b><span class="nb-ans__val">${esc(w.answer)}</span></div>
        </div>
        <div class="btn-row nb-item__acts">
          <input class="nb-input" data-nb-input type="text" inputmode="text" autocomplete="off"
                 placeholder="重做：把答案写在这里" aria-label="重做答案" />
          <button class="btn btn--sm" type="button" data-nb-retry>${ic('right')}重做</button>
          <button class="btn btn--ghost btn--sm" type="button" data-nb-master>${ic('check')}${w.mastered ? '取消掌握' : '标记已掌握'}</button>
          <button class="btn btn--ghost btn--sm" type="button" data-nb-detail>${ic('notes')}看解析</button>
          <button class="btn btn--ghost btn--sm" type="button" data-nb-del>${ic('trash')}删除</button>
        </div>
        ${w.tries ? `<div class="nb-tries">重做 ${w.tries} 次</div>` : ''}
        ${extra}
      </article>`;
    };

    const emptyHTML = kind => kind === 'none'
      ? `<div class="card glass nb-empty">
           <div class="nb-empty__mark">${ic('notes')}</div>
           <b>还没有错题</b>
           <p>做错的题会自动进来 —— 在「练习」或「今日」页答错一道，这里就多一条记录。</p>
         </div>`
      : `<div class="card glass nb-empty">
           <div class="nb-empty__mark">${ic('search')}</div>
           <b>这个筛选下没有题目</b>
           <p>换个筛选条件，或点上面的「全部」看看。</p>
         </div>`;

    /* ---- 重绘（只动列表与统计，工具栏与下拉保持不动） ---- */
    const paint = () => {
      const all = read();
      const unmastered = all.filter(w => !w.mastered).length;
      statsEl.textContent = `共 ${all.length} 题 · 未掌握 ${unmastered} 题`;

      const list = visible();
      listEl.innerHTML = !all.length ? emptyHTML('none')
        : (!list.length ? emptyHTML('filter') : list.map(itemHTML).join(''));

      $$('[data-nb-filter]', root).forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.nbFilter === state.filter)));
      if (unitSel.value !== state.unit) unitSel.value = state.unit;
    };

    /* ---- 交互（委托在 wrap 上，重绘不会丢监听） ---- */
    const find = id => read().find(w => String(w.id) === String(id));

    wrap.addEventListener('click', e => {
      /* 筛选 */
      const fbtn = e.target.closest('[data-nb-filter]');
      if (fbtn) { state.filter = fbtn.dataset.nbFilter; paint(); return; }

      /* 导出 */
      if (e.target.closest('[data-nb-export]')) { exportMd(); return; }

      const item = e.target.closest('[data-nb-item]');
      if (!item) return;
      const id = item.dataset.nbId;
      const w = find(id);
      if (!w) { paint(); return; }
      const all = read();
      const i = all.findIndex(x => String(x.id) === String(id));

      /* 重做 */
      if (e.target.closest('[data-nb-retry]')) {
        const val = ($('[data-nb-input]', item) || {}).value ?? '';
        if (!String(val).trim()) { ctx.toast('先写一个答案再重做'); return; }
        const ok = equivalent(val, w.answer);
        all[i] = Object.assign({}, w, { tries: (w.tries || 0) + 1, mastered: ok ? true : !!w.mastered });
        write(all);
        state.flash[id] = { ok, mine: String(val).trim() };
        ctx.toast(ok ? '答对了，已标记为掌握' : '还不对，看看正确答案与解析');
        paint();
        return;
      }

      /* 标记 / 取消掌握 */
      if (e.target.closest('[data-nb-master]')) {
        all[i] = Object.assign({}, w, { mastered: !w.mastered });
        write(all);
        delete state.flash[id];
        ctx.toast(w.mastered ? '已取消掌握' : '已标记为掌握');
        paint();
        return;
      }

      /* 看解析（抽屉） */
      if (e.target.closest('[data-nb-detail]')) {
        ctx.openDrawer({
          title: unitName(w.unit),
          sub: '错题解析',
          html: `
            <div class="nb-drawer">
              <div class="drawer__label">题目</div>
              <p class="nb-drawer__stem">${esc(w.stem)}</p>
              <hr class="hr" />
              <div class="kv"><b>我的答案</b><span>${esc(w.mine)}</span></div>
              <div class="kv"><b>正确答案</b><span>${esc(w.answer)}</span></div>
              <div class="kv"><b>所属章节</b><span>${esc(unitName(w.unit))}</span></div>
              <div class="kv"><b>重做次数</b><span>${w.tries || 0} 次</span></div>
              <div class="kv"><b>状态</b><span>${w.mastered ? '已掌握' : '未掌握'}</span></div>
              <div class="kv"><b>收录时间</b><span>${esc(ctx.stamp(w.at || Date.now()))}</span></div>
              ${w.why ? `<hr class="hr" /><div class="drawer__label">解析</div><p class="nb-drawer__why">${esc(w.why)}</p>` : ''}
            </div>`,
        });
        return;
      }

      /* 删除（二次确认） */
      if (e.target.closest('[data-nb-del]')) {
        if (!confirm('确定从错题本里删掉这一题？删除后不可恢复。')) return;
        all.splice(i, 1);
        write(all);
        delete state.flash[id];
        ctx.toast('已删除');
        paint();
        return;
      }
    });

    /* 回车 = 重做 */
    wrap.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('[data-nb-input]');
      if (!input) return;
      e.preventDefault();
      const item = input.closest('[data-nb-item]');
      const btn = item && $('[data-nb-retry]', item);
      if (btn) btn.click();
    });

    /* 章节下拉 */
    unitSel.addEventListener('change', () => { state.unit = unitSel.value; paint(); });

    /* ---- 导出当前筛选结果 ---- */
    function exportMd() {
      const list = visible();
      if (!list.length) { ctx.toast('当前没有可导出的错题'); return; }
      const fname = FILTERS.find(f => f.id === state.filter).label;
      const uname = state.unit ? unitName(state.unit) : '全部章节';
      const lines = [
        `# 错题本导出`,
        ``,
        `> 筛选：${fname} · 章节：${uname} · 共 ${list.length} 题`,
        `> 导出时间：${ctx.stamp(Date.now())}`,
        ``,
      ];
      list.forEach((w, n) => {
        lines.push(
          `## ${n + 1}. ${String(w.stem || '').replace(/\n+/g, ' ')}`,
          ``,
          `- 章节：${unitName(w.unit)}`,
          `- 我的答案：${w.mine ?? ''}`,
          `- 正确答案：${w.answer ?? ''}`,
          `- 解析：${w.why || '（无）'}`,
          `- 收录：${ctx.stamp(w.at || Date.now())} · 重做 ${w.tries || 0} 次 · ${w.mastered ? '已掌握' : '未掌握'}`,
          ``,
        );
      });
      ctx.download(`错题-${ctx.dayKey()}.md`, lines.join('\n'), 'text/markdown');
      ctx.track('notebook.export', `导出错题 ${list.length} 题`);
      ctx.toast(`已导出 ${list.length} 题`);
    }

    paint();
  },
};
