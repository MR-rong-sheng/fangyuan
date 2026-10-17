/* ==========================================================================
   方圆 · views/today.js —— 今日：一日一题、一日一公式、进度、今日疑问
   一天只放几样东西，不给排名、不给积分。
   ========================================================================== */
import { esc, store, toast, openDrawer, ic, dayKey } from '../core.js';
import { load } from '../data.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const weekday = () => WEEK[new Date().getDay()];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，做一道就睡';
  if (h < 11) return '早上好，先来一道';
  if (h < 14) return '中午好，来一道';
  if (h < 18) return '下午好，来一道';
  return '晚上好，来一道';
}

/* 同一天始终取同一题：按日期做哈希，不用 Math.random */
function dayHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const pickDaily = (arr, salt) => (arr && arr.length ? arr[dayHash(dayKey() + salt) % arr.length] : null);

/* 判分：宽容一点 —— 去空格、全角转半角、去掉正负号与单位的常见写法 */
export function normalizeAns(s) {
  return String(s == null ? '' : s)
    .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/[，。、；：,.;:]/g, '')
    .toLowerCase();
}
export function ansEqual(a, b) {
  const x = normalizeAns(a), y = normalizeAns(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const nx = Number(x), ny = Number(y);
  if (isFinite(nx) && isFinite(ny)) return Math.abs(nx - ny) < 1e-9;   // 1/2 与 0.5 这类先不做，数字等价先放过
  return false;
}

function pushWrong(rec) {
  const list = store.get('wrongs', []);
  if (list.some(x => x.id === rec.id && !x.mastered)) return false;
  list.push(rec);
  store.set('wrongs', list.slice(-300));
  return true;
}

export default {
  id: 'today', name: '今日', icon: 'today', nav: true,

  async mount(root, ctx) {
    const [pd, fd, unitsDoc, promptsDoc] = await Promise.all([
      load('problems'), load('formulas'), load('units'), load('prompts'),
    ]);
    if (ctx.stale('today')) return;                 /* 数据到手时用户可能已经切走了 */
    const problems = (pd && (pd.problems || pd.items)) || [];
    const formulas = (fd && (fd.formulas || fd.items)) || [];
    const units = (unitsDoc && (unitsDoc.units || unitsDoc.items)) || [];
    const prompts = (promptsDoc && (promptsDoc.prompts || promptsDoc.items)) || [];
    const unitName = id => { const u = units.find(x => x.id === id); return u ? u.name : (id || '未分章'); };

    const p = pickDaily(problems, 'p');
    const f = pickDaily(formulas, 'f');
    const tip = prompts.length ? prompts[dayHash(dayKey() + 'tip') % prompts.length] : '';

    const done = store.get('today.done', {});            // { '2026-10-07': { pid, ok } }
    const today = done[dayKey()] || null;
    const wrongs = store.get('wrongs', []);
    const wrongOpen = wrongs.filter(x => !x.mastered).length;
    const stats = store.get('drill.stats', { total: 0, right: 0 });

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">${esc(dayKey())} · 星期${weekday()}</div>
        <h2>${esc(greeting())}</h2>
        <p>这里不给排名、不给积分，一天只放几样东西：一道题，一条公式，一句提醒。</p>
      </section>

      <div class="hero">
        <article class="card glass spec">
          <div class="card__label">一日一题${p ? '　·　' + esc(unitName(p.unit)) : ''}</div>
          ${p ? `
            <div class="quote" data-q-stem style="font-size:17px;color:var(--ink);margin-top:8px">${esc(p.stem)}</div>
            <div data-q-choices class="grid grid--2" style="gap:10px;margin-top:14px">
              ${(p.choices || []).map((c, i) => `
                <button class="btn" data-q-choice="${i}" style="justify-content:flex-start;text-align:left">
                  <b style="opacity:.6;margin-right:8px">${'ABCD'[i]}</b>${esc(c)}</button>`).join('')}
            </div>
            ${(p.choices && p.choices.length) ? '' : `
            <div class="btn-row" style="margin-top:14px">
              <label class="field" style="flex:1;margin:0">你的答案
                <input data-q-input inputmode="text" autocomplete="off" placeholder="填一个数或式子" /></label>
              <button class="btn btn--primary" data-q-submit>提交</button>
            </div>`}
            <p class="quote" data-q-result style="margin-top:12px;min-height:1.6em"></p>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn btn--ghost" data-q-why hidden>看解析</button>
              <button class="btn ${today ? '' : 'btn--ghost'}" data-q-done>${today ? '今天已完成' : '标为完成'}</button>
            </div>` : `<p class="quote">content/problems.json 里还没有题目。</p>`}
        </article>

        <article class="card glass spec">
          <div class="card__label">进度</div>
          <div class="grid grid--3" style="gap:12px">
            <div class="metric"><div class="n" data-m-today>${today && today.ok ? 1 : 0}<span style="font-size:13px;color:var(--ink-3)">/1</span></div>
              <div class="k">今日一题</div></div>
            <div class="metric"><div class="n">${stats.right || 0}<span style="font-size:13px;color:var(--ink-3)">/${stats.total || 0}</span></div>
              <div class="k">练习正确</div></div>
            <div class="metric"><div class="n" data-m-wrongs>${wrongOpen}</div><div class="k">待复习错题</div>
              <div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, wrongOpen * 4)}%"></i></div></div>
          </div>
        </article>
      </div>

      <div class="grid grid--2" style="margin-top:16px">
        <article class="card glass spec">
          <div class="card__label">一日一公式${f ? '　·　' + esc(unitName(f.unit)) : ''}</div>
          ${f ? `
            <div style="font-family:var(--font-serif);font-size:19px;margin-top:6px">${esc(f.name)}</div>
            <div class="quote" data-f-body style="letter-spacing:.02em;margin-top:10px">${esc(f.body)}</div>
            <p class="quote" style="margin-top:10px;color:var(--ink-3)">${esc(f.note || '')}</p>
            <div class="btn-row" style="margin-top:auto;padding-top:18px">
              <button class="btn" data-goto-formulas>看这一章的全部公式</button>
            </div>` : `<p class="quote">content/formulas.json 里还没有公式。</p>`}
        </article>

        <article class="card glass spec">
          <div class="card__label">今日小记</div>
          <p class="quote" style="color:var(--ink-3)">${esc(tip)}</p>
          <label class="field" style="margin-top:12px">今天卡在哪、想到了什么
            <textarea data-note rows="3" placeholder="一句话就好"></textarea></label>
          <div class="btn-row" style="margin-top:12px">
            <span class="k" style="font-size:12px;color:var(--ink-3)" data-note-count></span>
            <button class="btn btn--primary" data-save-note>${ic('check')}记下来</button>
          </div>
        </article>
      </div>
    `;

    /* ---------- 判分与记录 ---------- */
    const resEl = root.querySelector('[data-q-result]');
    const whyBtn = root.querySelector('[data-q-why]');
    let answered = null;

    /* 就地更新，别整页重画：重画会把刚显示的判分结果一起抹掉（自检抓到的真 bug） */
    function markDone(ok) {
      const d = store.get('today.done', {});
      d[dayKey()] = { pid: p ? p.id : null, ok: !!ok, at: Date.now() };
      store.set('today.done', d);
      ctx.track('note', `今日一题 ${ok ? '做对' : '做错'} · ${p ? p.id : ''}`);
      const btn = root.querySelector('[data-q-done]');
      if (btn) { btn.classList.remove('btn--ghost'); btn.textContent = '今天已完成'; }
      const mToday = root.querySelector('[data-m-today]');
      if (mToday) mToday.innerHTML = (ok ? 1 : 0) + '<span style="font-size:13px;color:var(--ink-3)">/1</span>';
      const mWrongs = root.querySelector('[data-m-wrongs]');
      if (mWrongs) mWrongs.textContent = store.get('wrongs', []).filter(x => !x.mastered).length;
    }

    function judge(mine) {
      if (!p) return;
      answered = mine;
      const ok = ansEqual(mine, p.answer);
      resEl.innerHTML = ok
        ? `<b style="color:var(--accent)">对了。</b> 答案：${esc(p.answer)}`
        : `<b style="color:var(--ink)">再看看。</b> 你写的是「${esc(mine)}」，正确答案是 ${esc(p.answer)}`;
      whyBtn.hidden = false;
      if (!ok) {
        const added = pushWrong({
          id: p.id, stem: p.stem, answer: p.answer, mine, why: p.why || '',
          unit: p.unit, at: Date.now(), tries: 1, mastered: false, tags: p.tags || [],
        });
        if (added) toast('已收进错题本');
      }
      markDone(ok);
    }

    root.querySelectorAll('[data-q-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.qChoice);
        judge(p.choices[i]);
      });
    });
    const submit = root.querySelector('[data-q-submit]');
    if (submit) {
      submit.addEventListener('click', () => {
        const v = root.querySelector('[data-q-input]').value.trim();
        if (!v) return toast('先写上答案');
        judge(v);
      });
    }
    if (whyBtn) {
      whyBtn.addEventListener('click', () => {
        if (!p) return;
        openDrawer({
          title: p.stem, sub: `${unitName(p.unit)} · 难度 ${p.level || 1}`,
          html: `<div class="kv"><b>正确答案</b><span>${esc(p.answer)}</span></div>
            ${answered ? `<div class="kv"><b>你写的</b><span>${esc(answered)}</span></div>` : ''}
            <p class="quote" style="margin-top:14px">${esc(p.why || '这道题还没有写解析。')}</p>`,
        });
      });
    }
    const doneBtn = root.querySelector('[data-q-done]');
    if (doneBtn) doneBtn.addEventListener('click', () => markDone(true));

    const gotoF = root.querySelector('[data-goto-formulas]');
    if (gotoF) gotoF.addEventListener('click', () => ctx.go('formulas'));

    /* 今日小记 */
    const ta = root.querySelector('[data-note]');
    const nc = root.querySelector('[data-note-count]');
    const saved = store.get('today.note', {});
    if (ta) {
      ta.value = (saved[dayKey()] || '');
      const paint = () => { nc.textContent = ta.value.trim() ? ctx.countHan(ta.value) + ' 字' : ''; };
      paint();
      ta.addEventListener('input', paint);
      root.querySelector('[data-save-note]').addEventListener('click', () => {
        const v = ta.value.trim();
        const m = store.get('today.note', {});
        m[dayKey()] = v;
        store.set('today.note', m);
        ctx.track('note', '今日小记 · ' + v.slice(0, 40));
        toast(v ? '记下来了' : '已清空');
      });
    }

    /* 供自检使用 */
    root.dataset.todayReady = '1';
  },
};
