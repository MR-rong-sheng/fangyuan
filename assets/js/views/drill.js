/* ==========================================================================
   方圆 · views/drill.js —— 练习：出题 / 即时判分 / 计时与正确率
   只依赖内核（core.js）与内容层（data.js），无任何外部依赖。
   数据钩子（供自检断言）：根 [data-drill] · 题干 [data-drill-stem] ·
   输入 [data-drill-input] · 提交 [data-drill-submit] · 结果 [data-drill-result] ·
   本轮统计 [data-drill-stats]
   ========================================================================== */
import { esc, store, toast, openDrawer, closeDrawer, stamp } from '../core.js';
import { load } from '../data.js';

/* ------------------------------------------------------------------ 基础工具 */
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function hash(s) {
  let h = 2166136261; s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }
function F(n, d = 1) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
const fAdd = (a, b) => F(a.n * b.d + b.n * a.d, a.d * b.d);
const fSub = (a, b) => F(a.n * b.d - b.n * a.d, a.d * b.d);
const fMul = (a, b) => F(a.n * b.n, a.d * b.d);
const fDiv = (a, b) => F(a.n * b.d, a.d * b.n);
const fStr = f => (f.d === 1 ? String(f.n) : `${f.n}/${f.d}`);

const fmtTime = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/* ------------------------------------------------ 判分：宽容而不过度 */
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

/* ------------------------------------------------------------------ 出题器 */
/* 每个出题器都返回 { stem, answer, why }：why 是关键一步的解析 */

function genInt(level) {
  if (level <= 1) {
    const op = pick(['+', '-', '×']);
    if (op === '×') { const a = ri(2, 9), b = ri(2, 9); return { stem: `${a} × ${b}`, answer: String(a * b), why: `用乘法口诀：${a}×${b}=${a * b}。` }; }
    let a = ri(6, 20), b = ri(2, 20);
    if (op === '-' && b > a) { const s = a; a = b; b = s; }
    const v = op === '+' ? a + b : a - b;
    return { stem: `${a} ${op} ${b}`, answer: String(v), why: op === '+' ? `个位相加：${a}+${b}=${v}。` : `按减法算：${a}-${b}=${v}。` };
  }
  if (level === 2) {
    const op = pick(['+', '-', '×', '÷']);
    if (op === '+') { const a = ri(12, 48), b = ri(12, 48); return { stem: `${a} + ${b}`, answer: String(a + b), why: `个位相加再进位：${a}+${b}=${a + b}。` }; }
    if (op === '-') { let a = ri(25, 70), b = ri(8, 45); if (b > a) { const s = a; a = b; b = s; } return { stem: `${a} - ${b}`, answer: String(a - b), why: `不够减就向前借一位：${a}-${b}=${a - b}。` }; }
    if (op === '×') { const a = ri(3, 15), b = ri(3, 12); return { stem: `${a} × ${b}`, answer: String(a * b), why: `拆开算：${a}×${b}=${a * b}。` }; }
    const b = ri(2, 9), v = ri(2, 9), a = b * v;
    return { stem: `${a} ÷ ${b}`, answer: String(v), why: `想 ${b} 的乘法口诀：${b}×${v}=${a}，所以 ${a}÷${b}=${v}。` };
  }
  const t = ri(0, 5);
  if (t === 0) { const a = ri(3, 9), b = ri(3, 9), c = ri(10, 40); return { stem: `${a} × ${b} + ${c}`, answer: String(a * b + c), why: `先乘后加：先算 ${a}×${b}=${a * b}，再加 ${c}。` }; }
  if (t === 1) { const a = ri(10, 40), b = ri(3, 9), c = ri(3, 9); return { stem: `${a} + ${b} × ${c}`, answer: String(a + b * c), why: `先算乘法：${b}×${c}=${b * c}，再与 ${a} 相加。` }; }
  if (t === 2) { const a = ri(2, 9), b = ri(2, 9), c = ri(2, 9); return { stem: `(${a} + ${b}) × ${c}`, answer: String((a + b) * c), why: `先算括号：${a}+${b}=${a + b}，再乘 ${c}。` }; }
  if (t === 3) { const a = ri(3, 9), b = ri(2, 9), c = ri(2, 15); return { stem: `${a} × ${b} - ${c}`, answer: String(a * b - c), why: `先算乘法 ${a}×${b}=${a * b}，再减 ${c}。` }; }
  if (t === 4) { const b = ri(2, 9), v = ri(2, 9), a = b * v, c = ri(3, 20); return { stem: `${a} ÷ ${b} + ${c}`, answer: String(v + c), why: `先算除法：${a}÷${b}=${v}，再加 ${c}。` }; }
  { const a = ri(30, 60), b = ri(3, 9), c = ri(3, 9); return { stem: `${a} - ${b} × ${c}`, answer: String(a - b * c), why: `先算乘法 ${b}×${c}=${b * c}，再减。` }; }
}

function genFrac(level) {
  if (level <= 1) {
    if (ri(0, 1) === 0) {
      const d = ri(3, 9); let n1 = ri(1, d - 1), n2 = ri(1, d - 1);
      const op = pick(['+', '-']);
      if (op === '-' && n2 > n1) { const s = n1; n1 = n2; n2 = s; }
      const rn = op === '+' ? n1 + n2 : n1 - n2;
      const r = op === '+' ? fAdd(F(n1, d), F(n2, d)) : fSub(F(n1, d), F(n2, d));
      return { stem: `${n1}/${d} ${op} ${n2}/${d}`, answer: fStr(r),
        why: `同分母，分母不变、分子相${op === '+' ? '加' : '减'}：(${n1}${op === '+' ? '+' : '-'}${n2})/${d}=${rn}/${d}${gcd(rn, d) !== 1 ? `，约分得 ${fStr(r)}` : ''}。` };
    }
    const d = ri(2, 6), n = ri(1, d - 1), k = ri(2, 5);
    const rn = k * n, r = fMul(F(n, d), F(k));
    return { stem: `${k} × ${n}/${d}`, answer: fStr(r),
      why: `整数与分子相乘：${k}×${n}=${rn}，分母不变为 ${d}，得 ${rn}/${d}${gcd(rn, d) !== 1 ? `，约分得 ${fStr(r)}` : ''}。` };
  }
  if (level === 2) {
    let d1 = ri(2, 6), d2 = ri(2, 6);
    if (d2 === d1) d2 = d1 === 6 ? 2 : d1 + 1;
    const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
    const op = pick(['+', '-', '×']);
    if (op === '×') {
      const rn = n1 * n2, rd = d1 * d2, r = fMul(F(n1, d1), F(n2, d2));
      return { stem: `${n1}/${d1} × ${n2}/${d2}`, answer: fStr(r),
        why: `分子乘分子、分母乘分母：(${n1}×${n2})/(${d1}×${d2})=${rn}/${rd}${gcd(rn, rd) !== 1 ? `，约分得 ${fStr(r)}` : ''}。` };
    }
    let a = F(n1, d1), b = F(n2, d2);
    if (op === '-' && fSub(a, b).n < 0) { const s = a; a = b; b = s; }
    const r = op === '+' ? fAdd(a, b) : fSub(a, b);
    const L = a.d * b.d / gcd(a.d, b.d);
    const rn = op === '+' ? a.n * (L / a.d) + b.n * (L / b.d) : a.n * (L / a.d) - b.n * (L / b.d);
    return { stem: `${a.n}/${a.d} ${op} ${b.n}/${b.d}`, answer: fStr(r),
      why: `先通分（公分母 ${L}）：${a.n}/${a.d}=${a.n * (L / a.d)}/${L}、${b.n}/${b.d}=${b.n * (L / b.d)}/${L}，再相${op === '+' ? '加' : '减'}得 ${rn}/${L}${gcd(rn, L) !== 1 ? `，约分得 ${fStr(r)}` : ''}。` };
  }
  if (ri(0, 1) === 0) {
    const d1 = ri(2, 6), n1 = ri(1, d1 - 1), d2 = ri(2, 6), n2 = ri(1, d2 - 1);
    const rn = n1 * d2, rd = d1 * n2, r = fDiv(F(n1, d1), F(n2, d2));
    return { stem: `${n1}/${d1} ÷ ${n2}/${d2}`, answer: fStr(r),
      why: `除以一个分数等于乘它的倒数：${n1}/${d1} × ${d2}/${n2}=${rn}/${rd}${gcd(rn, rd) !== 1 ? `，约分得 ${fStr(r)}` : ''}。` };
  }
  const d1 = ri(2, 5), d2 = ri(2, 5), d3 = ri(2, 5);
  const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1), n3 = ri(1, d3 - 1);
  const r = fAdd(fAdd(F(n1, d1), F(n2, d2)), F(n3, d3));
  return { stem: `${n1}/${d1} + ${n2}/${d2} + ${n3}/${d3}`, answer: fStr(r),
    why: `三个分数一起通分，化成分母相同的分数再逐项相加，结果为 ${fStr(r)}。` };
}

function genPow(level) {
  const t = level <= 1 ? ri(0, 1) : level === 2 ? ri(0, 2) : ri(0, 3);
  const square = () => { const a = ri(3, 13); return { a, v: a * a }; };
  if (t === 0) { const a = ri(3, 12); return { stem: `${a}^2`, answer: String(a * a), why: `${a}^2 表示 ${a}×${a}，等于 ${a * a}。` }; }
  if (t === 1) { const a = ri(2, 5); return { stem: `${a}^3`, answer: String(a * a * a), why: `${a}^3 = ${a}×${a}×${a} = ${a * a * a}。` }; }
  if (t === 2) { const { a, v } = square(); return { stem: `√${v}`, answer: String(a), why: `因为 ${a}×${a}=${v}，所以 √${v}=${a}（算术平方根取非负）。` }; }
  const k = ri(0, 3);
  if (k === 0) {
    const a = ri(2, 5), b = ri(2, 4);
    const va = a * a, vb = -(b * b * b);
    return { stem: `(-${a})^2 + (-${b})^3`, answer: String(va + vb), why: `负数的偶次幂为正：(-${a})^2=${va}；负数的奇次幂为负：(-${b})^3=${vb}；相加得 ${va + vb}。` };
  }
  if (k === 1) { const { a, v } = square(); return { stem: `√${v} + 3^0`, answer: String(a + 1), why: `√${v}=${a}；任何非零数的 0 次幂为 1；相加得 ${a + 1}。` }; }
  if (k === 2) { const a = ri(2, 4), v = a * a * a * a; return { stem: `2^4 - √${v}`, answer: String(16 - a * a), why: `2^4=16；√${v}=${a * a}；相减得 ${16 - a * a}。` }; }
  { const a = ri(2, 6), b = ri(2, 9); return { stem: `${a}^2 + √${b * b}`, answer: String(a * a + b), why: `${a}^2=${a * a}；√${b * b}=${b}；相加得 ${a * a + b}。` }; }
}

function genEq(level) {
  if (level <= 1) {
    const t = ri(0, 2);
    if (t === 0) { const x = ri(1, 9), a = ri(2, 9); return { stem: `${a}x = ${a * x}`, answer: `x = ${x}`, why: `两边同除以 ${a}：x = ${a * x} ÷ ${a} = ${x}。` }; }
    if (t === 1) { const x = ri(2, 20), b = ri(2, 15); return { stem: `x + ${b} = ${x + b}`, answer: `x = ${x}`, why: `移项要变号：x = ${x + b} - ${b} = ${x}。` }; }
    const x = ri(4, 20), b = ri(2, 15); return { stem: `x - ${b} = ${x - b}`, answer: `x = ${x}`, why: `移项要变号：x = ${x - b} + ${b} = ${x}。` };
  }
  if (level === 2) {
    if (ri(0, 1) === 0) { const x = ri(1, 9), a = ri(2, 9), b = ri(1, 20); return { stem: `${a}x + ${b} = ${a * x + b}`, answer: `x = ${x}`, why: `移项：${a}x = ${a * x + b} - ${b} = ${a * x}；再同除以 ${a}：x = ${x}。` }; }
    let a = ri(2, 9), c = ri(2, 9); if (a === c) c = a === 9 ? 2 : a + 1;
    const x = ri(1, 9), b = ri(1, 12), d = (a - c) * x + b;
    return { stem: `${a}x + ${b} = ${c}x + ${d}`, answer: `x = ${x}`, why: `含 x 的项移到左边：${a}x - ${c}x = ${d} - ${b}，即 ${a - c}x = ${d - b}，x = ${x}。` };
  }
  if (ri(0, 1) === 0) { const a = ri(2, 6), x = ri(1, 9), b = ri(1, 9); return { stem: `${a}(x + ${b}) = ${a * (x + b)}`, answer: `x = ${x}`, why: `先去括号：${a}x + ${a * b} = ${a * (x + b)}；移项：${a}x = ${a * (x + b)} - ${a * b} = ${a * x}；x = ${x}。` }; }
  const a = ri(2, 6), x = ri(3, 12), b = ri(1, x - 1), c = a * (x - b);
  return { stem: `${a}(x - ${b}) = ${c}`, answer: `x = ${x}`, why: `先去括号：${a}x - ${a * b} = ${c}；移项：${a}x = ${c} + ${a * b} = ${a * x}；x = ${x}。` };
}

function tTerm(c, v) { if (c === 0) return ''; if (!v) return String(c); if (c === 1) return v; if (c === -1) return '-' + v; return c + v; }
function poly(terms) {
  const parts = terms.filter(t => t.c !== 0).map(t => tTerm(t.c, t.v));
  if (!parts.length) return '0';
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) out += parts[i][0] === '-' ? ' - ' + parts[i].slice(1) : ' + ' + parts[i];
  return out;
}
function genAlg(level) {
  if (level <= 1) {
    const p = ri(2, 5); let q = ri(2, 6); if (q === p) q = p + 1;
    const m = ri(1, 9), n = ri(1, 9);
    const cx = p - q, c = p * m - q * n;
    const ans = poly([{ c: cx, v: 'x' }, { c: c, v: '' }]);
    return { stem: `${p}(x + ${m}) - ${q}(x + ${n})`, answer: ans,
      why: `先去括号：${p}x + ${p * m} - ${q}x - ${q * n}；合并同类项：x 项 ${p}x - ${q}x = ${cx === 1 ? 'x' : cx === -1 ? '-x' : cx + 'x'}，常数项 ${p * m} - ${q * n} = ${c}，得 ${ans}。` };
  }
  if (level === 2) {
    if (ri(0, 1) === 0) {
      const m = ri(2, 9);
      return { stem: `(x + ${m})(x - ${m})`, answer: poly([{ c: 1, v: 'x^2' }, { c: -m * m, v: '' }]),
        why: `平方差公式 (a+b)(a-b)=a²-b²，这里 a=x、b=${m}，得 x² - ${m * m}。` };
    }
    const p = ri(2, 5), m = ri(2, 5), q = ri(2, 4), n = ri(1, 5);
    const cx = p - q, cy = p * m - n;
    const ans = poly([{ c: cx, v: 'x' }, { c: cy, v: 'y' }]);
    return { stem: `${p}(x + ${m}y) - (${q}x + ${n}y)`, answer: ans,
      why: `先去括号：${p}x + ${p * m}y - ${q}x - ${n}y；合并同类项：x 项得 ${cx === 1 ? 'x' : cx === -1 ? '-x' : cx + 'x'}，y 项得 ${cy === 1 ? 'y' : cy === -1 ? '-y' : cy + 'y'}，结果是 ${ans}。` };
  }
  const p = ri(1, 4), q = ri(1, 6), r = ri(1, 4), s = ri(1, 6);
  const a = p * r, b = p * s + q * r, c = q * s;
  const ans = poly([{ c: a, v: 'x^2' }, { c: b, v: 'x' }, { c: c, v: '' }]);
  return { stem: `(${p}x + ${q})(${r}x + ${s})`, answer: ans,
    why: `逐项相乘：${p}x·${r}x = ${a}x²；交叉项 ${p}x·${s} + ${q}·${r}x = ${b}x；常数项 ${q}×${s} = ${c}；合并得 ${ans}。` };
}

const GEN = { int: genInt, frac: genFrac, pow: genPow, eq: genEq, alg: genAlg };
const TYPES = [
  { id: 'int', name: '整数四则', unit: '整数四则' },
  { id: 'frac', name: '分数运算', unit: '分数运算' },
  { id: 'pow', name: '乘方与开方', unit: '乘方与开方' },
  { id: 'eq', name: '解一元一次方程', unit: '一元一次方程' },
  { id: 'alg', name: '代数式化简', unit: '代数式' },
  { id: 'bank', name: '真题题库', unit: '真题' },
];
const LEVELS = [{ id: 1, name: '易' }, { id: 2, name: '中' }, { id: 3, name: '难' }];
const COUNTS = [5, 10, 20];

/* ------------------------------------------------------------------ 存储 */
function loadStats() {
  const s = store.get('drill.stats', {}) || {};
  return {
    total: s.total || 0, right: s.right || 0, ms: s.ms || 0, rounds: s.rounds || 0,
    byType: s.byType && typeof s.byType === 'object' ? s.byType : {},
    last: s.last || null, history: Array.isArray(s.history) ? s.history : [],
  };
}

/* ------------------------------------------------------------------ 视图 */
let tick = null;   // 计时器句柄：模块级，换视图/重开一轮时清掉，避免泄漏

export default {
  id: 'drill', name: '练习', icon: 'calc', nav: true,

  async mount(root, ctx) {
    if (tick) { clearInterval(tick); tick = null; }
    root.dataset.drill = '1';

    let bank = [];
    try {
      const pd = await load('problems');
      bank = (pd && (pd.problems || pd.items)) || [];
    } catch (e) { bank = []; }
    if (ctx.stale('drill')) return;                 /* 数据到手时用户可能已经切走了 */

    const cfg = { type: 'int', level: 2, count: 10 };
    let round = null;

    root.innerHTML = `
      <div class="drill">
        <section class="view-head">
          <div class="kicker">练习</div>
          <h2>计算练习</h2>
          <p>选好题型与难度就出题，答完立刻判分；做错的题自动收进错题本。这里不排名、不积分，只记你自己的进度。</p>
        </section>

        <article class="card glass spec drill-panel">
          <div class="drill-roundtop">
            <div class="drill-chips">
              <span class="drill-chip" data-drill-typelabel>整数四则</span>
              <span class="drill-chip" data-drill-levellabel>中</span>
            </div>
            <span class="drill-timer" data-drill-timer>00:00</span>
          </div>
          <div class="drill-bar"><i data-drill-progress style="width:0%"></i></div>
          <div class="drill-statsline" data-drill-stats>准备开始</div>
          <div class="drill-stem" data-drill-stem>—</div>
          <div class="drill-choices" data-drill-choices hidden></div>
          <div class="drill-answer">
            <label class="drill-inputwrap">
              <input class="drill-input" data-drill-input inputmode="text" autocomplete="off"
                     enterkeyhint="done" placeholder="写下答案，回车提交" aria-label="你的答案" />
            </label>
            <button class="btn btn--primary drill-btn drill-btn--primary" data-drill-submit>提交</button>
          </div>
          <p class="drill-result" data-drill-result></p>
          <div class="drill-row">
            <button class="btn btn--ghost btn--sm drill-btn" data-drill-skip>跳过</button>
            <button class="btn btn--ghost btn--sm drill-btn" data-drill-end>结束本轮</button>
          </div>
        </article>

        <article class="card glass spec drill-panel">
          <div class="card__label">出题设置</div>
          <div class="drill-field">
            <div class="drill-label">题型</div>
            <div class="drill-seg" data-drill-types></div>
          </div>
          <div class="drill-field">
            <div class="drill-label">难度</div>
            <div class="drill-seg" data-drill-levels></div>
          </div>
          <div class="drill-field">
            <div class="drill-label">每轮题数</div>
            <div class="drill-seg" data-drill-counts></div>
          </div>
          <p class="drill-hint">换题型、难度或题数都会立刻重开一轮。</p>
        </article>

        <article class="card glass spec drill-panel">
          <div class="card__label">累计</div>
          <div class="drill-kpis" data-drill-kpis></div>
          <div class="drill-history" data-drill-history></div>
        </article>

        <article class="card glass spec drill-panel">
          <div class="card__label">错题本</div>
          <p class="drill-wrongs" data-drill-wrongs>—</p>
          <div class="drill-row">
            <button class="btn btn--ghost btn--sm drill-btn" data-drill-openwrongs>查看错题本</button>
          </div>
        </article>
      </div>`;

    const $r = sel => root.querySelector(sel);
    const stemEl = $r('[data-drill-stem]');
    const inputEl = $r('[data-drill-input]');
    const submitEl = $r('[data-drill-submit]');
    const resultEl = $r('[data-drill-result]');
    const statsEl = $r('[data-drill-stats]');
    const barEl = $r('[data-drill-progress]');
    const choicesEl = $r('[data-drill-choices]');
    const timerEl = $r('[data-drill-timer]');

    /* ---- 出题设置 ---- */
    $r('[data-drill-types]').innerHTML = TYPES.map(t => `<button data-t="${t.id}">${t.name}</button>`).join('');
    $r('[data-drill-levels]').innerHTML = LEVELS.map(l => `<button data-l="${l.id}">${l.name}</button>`).join('');
    $r('[data-drill-counts]').innerHTML = COUNTS.map(c => `<button data-c="${c}">${c}</button>`).join('');
    const syncSeg = () => {
      $r('[data-drill-types]').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === cfg.type)));
      $r('[data-drill-levels]').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.l) === cfg.level)));
      $r('[data-drill-counts]').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.c) === cfg.count)));
    };
    $r('[data-drill-types]').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.type = b.dataset.t; syncSeg(); newRound(); });
    $r('[data-drill-levels]').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.level = Number(b.dataset.l); syncSeg(); newRound(); });
    $r('[data-drill-counts]').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cfg.count = Number(b.dataset.c); syncSeg(); newRound(); });

    /* ---- 出题 ---- */
    function makeQuestion() {
      if (cfg.type === 'bank' && bank.length) {
        const pool = bank.filter(p => p.level === cfg.level);
        const q = pick(pool.length ? pool : bank);
        return { id: q.id, stem: q.stem, answer: String(q.answer), why: q.why || '', choices: q.choices || null, unit: q.unit || '真题' };
      }
      const gen = GEN[cfg.type] || genInt;
      const q = gen(cfg.level);
      const name = (TYPES.find(t => t.id === cfg.type) || {}).name || cfg.type;
      return { id: 'g:' + cfg.type + ':' + hash(q.stem), stem: q.stem, answer: q.answer, why: q.why || '', choices: null, unit: name };
    }

    /* ---- 一轮的开始 / 结束 ---- */
    function newRound() {
      if (tick) { clearInterval(tick); tick = null; }
      const qs = [];
      for (let i = 0; i < cfg.count; i++) qs.push(makeQuestion());
      round = { qs, i: 0, right: 0, done: 0, answered: false, finished: false, start: Date.now(), ms: 0 };
      $r('[data-drill-typelabel]').textContent = (TYPES.find(t => t.id === cfg.type) || {}).name || '';
      $r('[data-drill-levellabel]').textContent = (LEVELS.find(l => l.id === cfg.level) || {}).name || '';
      tick = setInterval(() => {
        if (!timerEl.isConnected) { clearInterval(tick); tick = null; return; }
        if (round && !round.finished) { timerEl.textContent = fmtTime(Date.now() - round.start); paintStats(); }
      }, 250);
      showQuestion();
    }

    function showQuestion() {
      const q = round.qs[round.i];
      round.answered = false;
      stemEl.textContent = q.stem;
      resultEl.textContent = '';
      resultEl.className = 'drill-result';
      if (q.choices && q.choices.length) {
        choicesEl.hidden = false;
        choicesEl.innerHTML = q.choices.map((c, i) =>
          `<button class="drill-choice" data-choice="${i}"><b>${'ABCD'[i]}</b><span>${esc(c)}</span></button>`).join('');
        choicesEl.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => {
          inputEl.value = q.choices[Number(b.dataset.choice)];
          doSubmit();
        }));
      } else {
        choicesEl.hidden = true;
        choicesEl.innerHTML = '';
      }
      inputEl.value = '';
      inputEl.disabled = false;
      submitEl.textContent = '提交';
      submitEl.disabled = false;
      try { inputEl.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
      paintStats();
    }

    /* ---- 判分与记录 ---- */
    function pushWrong(q, mine) {
      const list = store.get('wrongs', []);
      if (list.some(x => x.id === q.id)) return false;      // 同 id 已存在 → 跳过
      list.push({
        id: q.id, stem: q.stem, answer: q.answer, mine,
        why: q.why || '', unit: q.unit || '', at: Date.now(), tries: 1, mastered: false,
      });
      store.set('wrongs', list.slice(-500));
      return true;
    }

    function doSubmit() {
      if (!round) return newRound();
      if (round.finished) return newRound();
      if (round.answered) return nextQuestion();

      const q = round.qs[round.i];
      const mine = inputEl.value.trim();
      if (!mine) { toast('先写上答案'); return; }

      const ok = ansEq(mine, q.answer);
      round.answered = true;
      round.done++;
      if (ok) round.right++;

      if (ok) {
        resultEl.className = 'drill-result is-ok';
        resultEl.textContent = '答对了。' + (q.why ? '　' + q.why : '');
      } else {
        resultEl.className = 'drill-result is-no';
        resultEl.textContent = `答错了。正确答案：${q.answer}。` + (q.why ? '　' + q.why : '');
        if (pushWrong(q, mine)) toast('已收进错题本');
      }
      submitEl.textContent = '下一题';
      inputEl.disabled = true;
      paintStats();
      paintWrongs();
      try { ctx.track('drill', `${(TYPES.find(t => t.id === cfg.type) || {}).name || cfg.type} · ${ok ? '对' : '错'} · ${q.stem}`); } catch (e) { /* 忽略 */ }
    }

    function nextQuestion() {
      if (round.i + 1 >= round.qs.length) return finishRound();
      round.i++;
      showQuestion();
    }

    function finishRound() {
      if (tick) { clearInterval(tick); tick = null; }
      round.finished = true;
      round.ms = Date.now() - round.start;
      const done = round.done, right = round.right;
      const acc = done ? Math.round(right / done * 100) : 0;

      const s = loadStats();
      s.total += done; s.right += right; s.ms += round.ms; s.rounds += 1;
      const bt = s.byType[cfg.type] || (s.byType[cfg.type] = { total: 0, right: 0 });
      bt.total += done; bt.right += right;
      const rec = { at: Date.now(), type: cfg.type, level: cfg.level, done, right, ms: round.ms };
      s.last = rec;
      s.history = s.history.concat([rec]).slice(-30);
      store.set('drill.stats', s);

      timerEl.textContent = fmtTime(round.ms);
      stemEl.textContent = '本轮完成';
      choicesEl.hidden = true;
      inputEl.value = ''; inputEl.disabled = true;
      submitEl.textContent = '再来一轮'; submitEl.disabled = false;
      resultEl.className = 'drill-result';
      resultEl.textContent = `本轮 ${done} 题，答对 ${right} 题，正确率 ${acc}%，用时 ${fmtTime(round.ms)}。`;
      barEl.style.width = '100%';
      statsEl.textContent = `本轮 ${done} 题 · 正确 ${right} · 正确率 ${acc}% · 用时 ${fmtTime(round.ms)}`;
      paintKpis();
      try { ctx.track('drill', `一轮完成 · ${(TYPES.find(t => t.id === cfg.type) || {}).name || cfg.type} · ${right}/${done} · ${Math.round(round.ms / 1000)}s`); } catch (e) { /* 忽略 */ }
    }

    /* ---- 统计渲染 ---- */
    function paintStats() {
      if (!round) return;
      const acc = round.done ? Math.round(round.right / round.done * 100) : 0;
      const elapsed = round.finished ? round.ms : (Date.now() - round.start);
      if (!round.finished) {
        statsEl.textContent = `第 ${Math.min(round.i + 1, round.qs.length)}/${round.qs.length} 题 · 用时 ${fmtTime(elapsed)} · 已答 ${round.done} · 正确 ${round.right} · 正确率 ${acc}%`;
      }
      barEl.style.width = Math.round(round.done / round.qs.length * 100) + '%';
    }

    function paintKpis() {
      const s = loadStats();
      const acc = s.total ? Math.round(s.right / s.total * 100) : 0;
      $r('[data-drill-kpis]').innerHTML = `
        <div class="drill-kpi"><div class="n">${s.total}</div><div class="k">累计作答</div></div>
        <div class="drill-kpi"><div class="n">${acc}<span>%</span></div><div class="k">累计正确率</div></div>
        <div class="drill-kpi"><div class="n">${s.rounds}</div><div class="k">完成轮数</div></div>`;
      const hist = $r('[data-drill-history]');
      const rows = s.history.slice(-5).reverse();
      hist.innerHTML = rows.length
        ? rows.map(r => {
            const t = (TYPES.find(x => x.id === r.type) || {}).name || r.type;
            const a = r.done ? Math.round(r.right / r.done * 100) : 0;
            return `<div class="drill-histrow"><span>${esc(t)}</span><span>${r.right}/${r.done} · ${a}%</span>`
                 + `<span>${fmtTime(r.ms)}</span><span class="drill-dim">${stamp(r.at)}</span></div>`;
          }).join('')
        : '<p class="drill-hint">还没有完成过一轮。做完一轮后，这里会留下记录。</p>';
      paintWrongs();
    }

    function paintWrongs() {
      const list = store.get('wrongs', []);
      const open = list.filter(x => !x.mastered).length;
      $r('[data-drill-wrongs]').textContent = `共 ${list.length} 条，其中 ${open} 条待复习。做错的题会自动收进来。`;
    }

    /* ---- 交互 ---- */
    submitEl.addEventListener('click', doSubmit);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    $r('[data-drill-skip]').addEventListener('click', () => { if (round && !round.finished) nextQuestion(); });
    $r('[data-drill-end]').addEventListener('click', () => { if (round && !round.finished) finishRound(); });

    $r('[data-drill-openwrongs]').addEventListener('click', () => {
      const list = store.get('wrongs', []);
      if (!list.length) { toast('错题本还是空的'); return; }
      const view = list.slice().reverse().slice(0, 80);
      const html = view.map(w => `
        <div class="drill-wrongitem" data-wid="${esc(w.id)}">
          <div class="drill-wrongstem">${esc(w.stem)}</div>
          <div class="drill-wrongmeta">你填：${esc(w.mine || '—')}　正确：${esc(w.answer)}　${esc(stamp(w.at))}${w.mastered ? '　（已掌握）' : ''}</div>
          ${w.why ? `<div class="drill-wrongwhy">${esc(w.why)}</div>` : ''}
          ${w.mastered ? '' : `<button class="btn btn--ghost btn--sm drill-btn" data-master="${esc(w.id)}">标记已掌握</button>`}
        </div>`).join('');
      openDrawer({
        title: '错题本',
        sub: `共 ${list.length} 条 · 待复习 ${list.filter(x => !x.mastered).length} 条`,
        html,
        actions: [{
          label: '清空错题本', icon: 'trash', onClick: () => {
            if (!confirm('清空全部错题记录？不能撤销。')) return;
            store.set('wrongs', []);
            closeDrawer();
            paintWrongs();
            toast('错题本已清空');
          },
        }],
      });
      const drawer = document.getElementById('drawer');
      drawer.querySelectorAll('[data-master]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.master;
        const arr = store.get('wrongs', []);
        const it = arr.find(x => x.id === id);
        if (it) { it.mastered = true; store.set('wrongs', arr); }
        const meta = b.closest('.drill-wrongitem').querySelector('.drill-wrongmeta');
        if (meta && !/已掌握/.test(meta.textContent)) meta.textContent += '　（已掌握）';
        b.remove();
        paintWrongs();
        toast('已标记掌握');
      }));
    });

    /* ---- 起飞 ---- */
    syncSeg();
    paintKpis();
    newRound();
  },
};
