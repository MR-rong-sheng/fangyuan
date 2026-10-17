/* ==========================================================================
   方圆 · views/streak.js —— 连续打卡：连续天数 / 最长记录 / 最近 30 天热力条 / 今日状态
   口径（只读本机存档，不排名、不扣分、不催逼）：
     某一天只要满足任一条件，就算这一天「来过」——
       ① fangyuan:today.done[YYYY-MM-DD] 存在；
       ② fangyuan:drill.stats.history[].at 有该日记录；
       ③ fangyuan:wrongs[].at 有该日记录。
   数据钩子（供自检断言）：根 [data-streak] · 连续 [data-streak-now] · 最长 [data-streak-best] ·
   今日状态 [data-streak-today] · 热力条 [data-streak-strip]（每格 [data-day]，带 data-on/data-off 与 title）
   ========================================================================== */
import { esc, openDrawer, ic, dayKey } from '../core.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const weekday = d => '星期' + WEEK[d.getDay()];
const pad2 = n => String(n).padStart(2, '0');

/* 本地零点的日期：不要用 Date.parse('YYYY-MM-DD')，那是 UTC，会把日期挪一天 */
function parseDay(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function diffDays(a, b) {   // b - a，按本地零点算，跨月跨年都准
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / 86400000);
}

/* ---------------------------------------------------------------- 采集 */
/* 返回 Map<YYYY-MM-DD, Set<来源标签>>：只收「本地存档里能指认的」那一天 */
export function collectDays(src = store) {
  const days = new Map();
  const mark = (k, label) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k))) return;
    if (!days.has(k)) days.set(k, new Set());
    days.get(k).add(label);
  };

  const done = src.get('today.done', {}) || {};
  for (const k of Object.keys(done)) if (done[k]) mark(k, '今日一题');

  const st = src.get('drill.stats', {}) || {};
  const hist = Array.isArray(st.history) ? st.history : [];
  for (const r of hist) if (r && r.at) mark(dayKey(new Date(r.at)), '练习');

  const wrongs = src.get('wrongs', []) || [];
  if (Array.isArray(wrongs)) for (const w of wrongs) if (w && w.at) mark(dayKey(new Date(w.at)), '错题');

  return days;
}

/* 以 endKey 结尾向前数，连续存在的天数（endKey 必须存在） */
function runEndingAt(days, endKey) {
  let n = 0;
  let d = parseDay(endKey);
  if (!d) return 0;
  while (days.has(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

/* 全部记录里最长的一段连续 */
function bestRun(days) {
  const keys = [...days.keys()].sort();
  let best = 0, cur = 0, prev = null;
  for (const k of keys) {
    cur = prev && diffDays(parseDay(prev), parseDay(k)) === 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = k;
  }
  return best;
}

/* 汇总：连续 / 最长 / 今日 / 30 天条 / 本月本周 */
export function summarize(days, now = new Date()) {
  const today = dayKey(now);
  const yKey = dayKey(addDays(now, -1));
  const todayOn = days.has(today);

  const nowRun = todayOn ? runEndingAt(days, today)
                         : (days.has(yKey) ? runEndingAt(days, yKey) : 0);
  const best = bestRun(days);

  const strip = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(now, -i);
    const k = dayKey(d);
    const srcs = days.get(k);
    strip.push({
      key: k, on: !!srcs, today: k === today,
      weekday: d.getDay(), date: d,
      sources: srcs ? [...srcs] : [],
    });
  }

  const mk = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  let monthDays = 0;
  for (const k of days.keys()) if (k.startsWith(mk)) monthDays++;

  const monday = addDays(now, -((now.getDay() + 6) % 7));
  let weekDays = 0;
  for (let i = 0; i < 7; i++) if (days.has(dayKey(addDays(monday, i)))) weekDays++;

  return { today, todayOn, now: nowRun, best, strip, monthDays, elapsed: now.getDate(), weekDays, total: days.size };
}

/* ---------------------------------------------------------------- 视图 */
export default {
  id: 'streak', name: '打卡', icon: 'chart', nav: true,

  async mount(root, ctx) {
    const days = collectDays(ctx.store);
    const s = summarize(days);

    /* 文案克制：不排名、不扣分、不催 */
    const headline = s.todayOn
      ? `已连续 ${s.now} 天 · 今天已来过`
      : (s.now > 0 ? `已连续 ${s.now} 天 · 今天还没打卡`
                   : '还没有连续记录 · 今天做一道就开了头');

    root.innerHTML = `
      <div data-streak="1">
        <section class="view-head">
          <div class="kicker">连续打卡</div>
          <h2>来过，就算数</h2>
          <p>一天里做过一道题、练过一轮，或收进一道错题，都算这一天来过。这里不排名、不扣分，只替未来的你留一条浅浅的痕迹。</p>
        </section>

        <div class="grid grid--3">
          <article class="card glass spec metric">
            <div class="card__label">连续天数</div>
            <div class="n" data-streak-now>${s.now}</div>
            <div class="k">天 · 从今天往前数</div>
          </article>
          <article class="card glass spec metric">
            <div class="card__label">最长记录</div>
            <div class="n" data-streak-best>${s.best}</div>
            <div class="k">天 · 有记录以来最长的一段</div>
          </article>
          <article class="card glass spec metric">
            <div class="card__label">今日状态</div>
            <div class="streak-today" data-streak-today data-state="${s.todayOn ? 'on' : 'off'}">
              ${s.todayOn ? '今天已打卡' : '今天还没打卡'}
            </div>
            <div class="k">${s.todayOn ? (s.strip[29].sources.join('、') || '来过') : '做一道就记上'}</div>
          </article>
        </div>

        <article class="card glass spec">
          <div class="card__label">最近 30 天</div>
          <p class="streak-headline" data-streak-headline>${esc(headline)}</p>
          <div class="streak-strip" data-streak-strip role="list" aria-label="最近 30 天的打卡情况">
            ${s.strip.map(c => `
              <button type="button" class="streak-cell${c.today ? ' is-today' : ''}"
                data-day="${c.key}" ${c.on ? 'data-on="1"' : 'data-off="1"'}
                data-lv="${c.sources.length}"
                title="${c.key} ${weekday(c.date)} · ${c.on ? '已来过（' + (c.sources.join('、') || '有记录') + '）' : '未记录'}"
                aria-label="${c.key} ${c.on ? '已打卡' : '未打卡'}"></button>`).join('')}
          </div>
          <div class="streak-legend">
            <span class="streak-swatch" data-off="1"></span>未记录
            <span class="streak-swatch" data-on="1" data-lv="1"></span>来过
            <span class="streak-swatch" data-on="1" data-lv="2"></span>来过（两处以上）
            <span class="streak-span">${s.strip[0].key} → ${s.strip[29].key}</span>
          </div>
          <p class="streak-hint">点任意一格，看看那天做了什么。</p>
        </article>

        <article class="card glass spec">
          <div class="card__label">本月概览</div>
          <div class="streak-month">
            <div class="metric"><div class="n">${s.monthDays}</div><div class="k">本月来过（天）</div></div>
            <div class="metric"><div class="n">${s.weekDays}</div><div class="k">本周来过（天）</div></div>
            <div class="metric"><div class="n">${s.total}</div><div class="k">有记录的日子（天）</div></div>
          </div>
          <div class="progress streak-bar"><i style="width:${Math.min(100, Math.round(s.monthDays / Math.max(1, s.elapsed) * 100))}%"></i></div>
          <p class="streak-hint">本月已过 ${s.elapsed} 天，来过 ${s.monthDays} 天。</p>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn ${s.todayOn ? 'btn--ghost' : 'btn--primary'}" data-streak-go>${ic('calc')}${s.todayOn ? '再练一轮' : '去做一道'}</button>
          </div>
        </article>
      </div>`;

    const goBtn = root.querySelector('[data-streak-go]');
    if (goBtn) goBtn.addEventListener('click', () => ctx.go('drill'));

    /* 点格子：抽屉里说清那天做了什么（只陈述，不评价） */
    root.querySelectorAll('[data-day]').forEach(cell => {
      cell.addEventListener('click', () => {
        const k = cell.dataset.day;
        const srcs = days.get(k);
        const d = parseDay(k);
        const on = !!srcs;
        openDrawer({
          title: k,
          sub: `${weekday(d)} · ${on ? '来过' : '没有记录'}`,
          html: on
            ? `<div class="kv"><b>这天</b><span>${esc([...srcs].join('、'))}</span></div>
               <p class="quote" style="margin-top:14px">来过就算数，做得多少不重要。</p>`
            : `<p class="quote">这一天本机没有留下记录。没记上也不扣什么，想起来就接着来。</p>`,
        });
        try { ctx.track('streak', `查看 ${k} · ${on ? [...srcs].join('、') : '未记录'}`); } catch (e) { /* 忽略 */ }
      });
    });

    try { ctx.track('streak', `打卡页 · 连续 ${s.now} 天 · 最长 ${s.best} 天 · 今日${s.todayOn ? '已' : '未'}打卡`); } catch (e) { /* 忽略 */ }
    root.dataset.streakReady = '1';
  },
};
