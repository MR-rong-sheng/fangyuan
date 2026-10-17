/* ==========================================================================
   方圆 · views/formulas.js —— 公式速查
   按章节分组；顶部即时搜索（名称 / 公式 / 说明）；点一条开抽屉看说明与例子。
   公式文本一律经 lib/mathfmt.js 渲染（先转义再替换，杜绝注入）。
   ========================================================================== */
import { esc } from '../core.js';
import { load } from '../data.js';
import { renderMath } from '../lib/mathfmt.js';

export default {
  id: 'formulas', name: '公式', icon: 'book', nav: true,

  async mount(root, ctx) {
    root.dataset.fx = '1';

    /* ---------- 取数据 ---------- */
    let formulas = [], units = [], loadErr = '';
    try {
      const [fd, ud] = await Promise.all([load('formulas'), load('units')]);
      formulas = (fd && (fd.formulas || fd.items)) || [];
      units = (ud && (ud.units || ud.items)) || [];
    } catch (err) {
      loadErr = err && err.message ? err.message : String(err);
    }
    if (ctx.stale('formulas')) return;              /* 数据到手时用户可能已经切走了 */

    /* ---------- 章节与分组 ---------- */
    const unitMap = new Map();
    units.forEach((u, i) => unitMap.set(u.id, { ...u, order: i + 1 }));

    const labelOf = id => {
      const u = unitMap.get(id);
      return u ? `第${u.order}章 · ${u.name}` : '未归章';
    };
    const fullOf = id => {
      const u = unitMap.get(id);
      return u ? `第${u.order}章 · ${u.name}（${u.grade}）` : '未归章';
    };

    const groups = [];
    const byUnit = new Map(units.map(u => [u.id, []]));
    const strays = [];
    for (const f of formulas) {
      if (byUnit.has(f.unit)) byUnit.get(f.unit).push(f);
      else strays.push(f);
    }
    for (const u of units) {
      const list = byUnit.get(u.id);
      if (list.length) groups.push({ id: u.id, label: labelOf(u.id), grade: u.grade, items: list });
    }
    if (strays.length) groups.push({ id: '_stray', label: '未归章', grade: '', items: strays });

    /* id → 可搜索文本（名称 / 公式 / 说明 / 例子），统一小写 */
    const hay = new Map();
    for (const f of formulas) {
      hay.set(f.id, [f.name, f.body, f.note, f.example]
        .map(v => String(v == null ? '' : v)).join(' ').toLowerCase());
    }

    /* ---------- 骨架 ---------- */
    const groupHTML = groups.map(g => `
      <section class="fx-group" data-fx-group>
        <div class="fx-group__head">
          <h3 class="fx-group__title">${esc(g.label)}</h3>
          ${g.grade ? `<span class="fx-group__grade">${esc(g.grade)}</span>` : ''}
        </div>
        <div class="fx-list">
          ${g.items.map(f => `
            <article class="fx-item" data-fx-item data-fx-id="${esc(f.id)}">
              <button class="fx-item__btn" type="button" data-fx-open>
                <span class="fx-item__text">
                  <span class="fx-item__name">${esc(f.name)}</span>
                  <span class="fx-item__body fx-math" data-fx-body>${renderMath(f.body)}</span>
                </span>
                <span class="fx-item__chev" aria-hidden="true">${ctx.ic('right')}</span>
              </button>
            </article>`).join('')}
        </div>
      </section>`).join('');

    const hasData = formulas.length > 0;

    root.innerHTML = `
      <div class="fx">
      <section class="fx-head">
        <div class="fx-kicker">公式速查</div>
        <h2>公式</h2>
        <p>按章节整理，一处就能翻到要用的那一条。</p>
      </section>

      ${loadErr ? `<div class="fx-note fx-note--err">内容读取失败：${esc(loadErr)}</div>` : ''}

      ${hasData ? `
      <div class="fx-searchbar">
        <label class="fx-search">
          ${ctx.ic('search', 'fx-search__ic')}
          <input data-fx-search type="search" inputmode="search" autocomplete="off"
                 placeholder="搜索名称、公式或说明…" aria-label="搜索公式" />
          <button type="button" class="fx-search__clear" data-fx-clear hidden aria-label="清空搜索">${ctx.ic('close')}</button>
        </label>
        <div class="fx-count" data-fx-count aria-live="polite"></div>
      </div>

      <div class="fx-body" data-fx-groups>
        ${groupHTML}
      </div>

      <div class="fx-empty" data-fx-empty hidden></div>
      ` : `
      <div class="fx-empty fx-empty--static">
        <b>还没有公式</b>
        <span>在 <code>content/formulas.json</code> 里加上条目，这一页就会自动长出来。</span>
      </div>`}
      </div>
    `;

    if (!hasData) { root.dataset.fxReady = '1'; return; }

    /* ---------- 搜索过滤 ---------- */
    const input = root.querySelector('[data-fx-search]');
    const countEl = root.querySelector('[data-fx-count]');
    const clearBtn = root.querySelector('[data-fx-clear]');
    const emptyEl = root.querySelector('[data-fx-empty]');
    const items = Array.from(root.querySelectorAll('[data-fx-item]'));
    const groupEls = Array.from(root.querySelectorAll('[data-fx-group]'));

    function apply() {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      for (const el of items) {
        const ok = !q || (hay.get(el.dataset.fxId) || '').includes(q);
        el.hidden = !ok;
        if (ok) shown++;
      }
      for (const g of groupEls) {
        g.hidden = !g.querySelector('[data-fx-item]:not([hidden])');
      }
      countEl.textContent = q ? `匹配 ${shown} 条` : `共 ${shown} 条`;
      clearBtn.hidden = !q;
      emptyEl.hidden = shown !== 0;
      if (!shown) {
        emptyEl.innerHTML = `<b>没有找到「${esc(input.value.trim())}」</b>`
          + `<span>换个说法试试，比如公式里的字母或章节名。</span>`;
      }
    }

    input.addEventListener('input', apply);
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; apply(); } });
    clearBtn.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
    apply();

    /* ---------- 打开抽屉 ---------- */
    function openItem(id) {
      const f = formulas.find(x => String(x.id) === String(id));
      if (!f) return;
      ctx.track('note', '查公式 · ' + f.name);
      const chapter = fullOf(f.unit);
      ctx.openDrawer({
        title: f.name,
        sub: chapter,
        html: `
          <div class="fx-drawer">
            <div class="fx-drawer__formula fx-math">${renderMath(f.body)}</div>
            <div class="fx-chapter">${esc(chapter)}</div>
            ${f.note ? `<div class="fx-sec"><div class="fx-sec__label">说明</div>
              <div class="fx-sec__text fx-math">${renderMath(f.note)}</div></div>` : ''}
            ${f.example ? `<div class="fx-sec"><div class="fx-sec__label">例子</div>
              <div class="fx-sec__text fx-sec__text--eg fx-math">${renderMath(f.example)}</div></div>` : ''}
          </div>`,
      });
    }

    root.querySelectorAll('[data-fx-open]').forEach(btn => {
      btn.addEventListener('click', () => openItem(btn.closest('[data-fx-item]').dataset.fxId));
    });

    root.dataset.fxReady = '1';
  },
};
