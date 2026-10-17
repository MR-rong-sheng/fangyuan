/* ==========================================================================
   方圆 · views/plot.js —— 图像：手绘 SVG 坐标系，画函数曲线，拖动参数看变化

   全部原生实现，不引任何外部库：
     · 表达式求值器：手写递归下降解析器（绝不用 eval / new Function）
     · 坐标系：SVG 网格 + 坐标轴 + 自动选刻度（1/2/5×10^n）
     · 曲线：屏幕每像素采样一个点，拼成 <path>
     · 交互：滚轮 / 双指缩放、拖动平移、悬停读点
   类名一律 .plot- 前缀，样式都在 plot.css。
   ========================================================================== */
import { esc } from '../core.js';

/* ==========================================================================
   一、安全表达式求值器
   支持：数字、x、a / b / c、+ - * / ^、括号、
         函数 sin cos tan sqrt ln abs，常量 pi / e。
   输出 f(x)：compile(text) → { ok, fn(x, params) } | { ok:false, error }
   非法输入返回 { ok:false }，绝不抛异常到调用方。
   ========================================================================== */

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sqrt: Math.sqrt, ln: Math.log, abs: Math.abs,
};
const CONSTS = { pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E };
const VARS = ['x', 'a', 'b', 'c'];

/* --- 词法：把字符串切成数字 / 名字 / 运算符 --- */
function tokenize(src) {
  const s = String(src == null ? '' : src).replace(/\s+/g, '');
  if (!s) throw new Error('表达式是空的');
  const isDigit = c => c >= '0' && c <= '9';
  const isAlpha = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1]))) {
      let j = i;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new Error('小数点用多了：' + raw);
      const v = Number(raw);
      if (!isFinite(v)) throw new Error('数字写错了：' + raw);
      out.push({ t: 'num', v });
      i = j;
    } else if (isAlpha(c)) {
      let j = i;
      while (j < s.length && (isAlpha(s[j]) || isDigit(s[j]))) j++;
      out.push({ t: 'name', v: s.slice(i, j) });
      i = j;
    } else if ('+-*/^()'.includes(c)) {
      out.push({ t: c });
      i++;
    } else if (c === '×' || c === '·' || c === '∗') { out.push({ t: '*' }); i++; }
    else if (c === '÷') { out.push({ t: '/' }); i++; }
    else if (c === '−' || c === '–' || c === '—') { out.push({ t: '-' }); i++; }
    else throw new Error('看不懂这个符号：' + c);
  }
  return out;
}

/* --- 语法：递归下降。优先级 低→高：expr(+,-) → term(*,/,隐式乘) → unary(±) → power(^) → primary --- */
function parseTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = type => {
    const t = next();
    if (!t || t.t !== type) throw new Error('这里少了一个「' + type + '」');
    return t;
  };

  function expr() {
    let node = term();
    let tk;
    while ((tk = peek()) && (tk.t === '+' || tk.t === '-')) {
      next();
      node = { op: tk.t, a: node, b: term() };
    }
    return node;
  }
  function term() {
    let node = unary();
    for (;;) {
      const tk = peek();
      if (!tk) break;
      if (tk.t === '*' || tk.t === '/') {
        next();
        node = { op: tk.t, a: node, b: unary() };
        continue;
      }
      // 隐式乘法：2x、3sin(x)、(x+1)(x-1)、x(x+1)
      if (tk.t === 'num' || tk.t === 'name' || tk.t === '(') {
        node = { op: '*', a: node, b: unary() };
        continue;
      }
      break;
    }
    return node;
  }
  function unary() {
    const tk = peek();
    if (tk && (tk.t === '+' || tk.t === '-')) { next(); return { op: 'u' + tk.t, a: unary() }; }
    return power();
  }
  function power() {
    const base = primary();
    const tk = peek();
    if (tk && tk.t === '^') { next(); return { op: '^', a: base, b: unary() }; }  // 右结合，指数可带负号
    return base;
  }
  function primary() {
    const tk = next();
    if (!tk) throw new Error('式子没写完');
    if (tk.t === 'num') return { n: tk.v };
    if (tk.t === '(') { const e = expr(); expect(')'); return e; }
    if (tk.t === 'name') {
      const nm = tk.v, low = nm.toLowerCase();
      if (FUNCS[low]) {
        const p = peek();
        if (!p || p.t !== '(') throw new Error('函数 ' + nm + ' 后面要跟括号，例如 ' + low + '(x)');
        next();
        const arg = expr();
        expect(')');
        return { fn: low, a: arg };
      }
      if (VARS.includes(nm)) return { v: nm };
      if (CONSTS[nm] !== undefined) return { n: CONSTS[nm] };
      if (CONSTS[low] !== undefined) return { n: CONSTS[low] };
      throw new Error('不认识的符号：' + nm);
    }
    throw new Error('不该出现的符号：' + tk.t);
  }

  const root = expr();
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new Error('式子后面多出来了：' + (t.v !== undefined ? t.v : t.t));
  }
  return root;
}

/* --- 求值：遍历 AST --- */
function evalNode(node, x, p) {
  if ('n' in node) return node.n;
  if ('v' in node) {
    if (node.v === 'x') return x;
    const val = p[node.v];
    return typeof val === 'number' ? val : NaN;
  }
  if ('fn' in node) return FUNCS[node.fn](evalNode(node.a, x, p));
  switch (node.op) {
    case '+': return evalNode(node.a, x, p) + evalNode(node.b, x, p);
    case '-': return evalNode(node.a, x, p) - evalNode(node.b, x, p);
    case '*': return evalNode(node.a, x, p) * evalNode(node.b, x, p);
    case '/': return evalNode(node.a, x, p) / evalNode(node.b, x, p);
    case '^': return Math.pow(evalNode(node.a, x, p), evalNode(node.b, x, p));
    case 'u-': return -evalNode(node.a, x, p);
    case 'u+': return +evalNode(node.a, x, p);
  }
  return NaN;
}

/** 编译表达式 → { ok, fn } 或 { ok:false, error } */
export function compile(expr) {
  try {
    const ast = parseTokens(tokenize(expr));
    return { ok: true, ast, fn: (x, params = {}) => evalNode(ast, x, params) };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  }
}

/** 求一个点的值：非法表达式 / 该点无定义（1/0、ln0、sqrt(-1)…）都返回 { ok:false, error } */
export function evaluate(expr, x, params = {}) {
  const c = compile(expr);
  if (!c.ok) return { ok: false, error: c.error };
  let v;
  try { v = c.fn(x, params); } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  if (typeof v !== 'number' || !isFinite(v)) {
    return { ok: false, error: 'x = ' + x + ' 处没有取值' };
  }
  return { ok: true, value: v };
}

/* ==========================================================================
   二、视图
   ========================================================================== */

const PRESETS = [
  { key: 'linear', label: '一次函数', expr: 'a*x+b',       p: { a: 1, b: 1, c: 0 } },
  { key: 'quad',   label: '二次函数', expr: 'a*x^2+b*x+c', p: { a: 1, b: -4, c: 3 } },
  { key: 'inv',    label: '反比例',   expr: 'a/x',         p: { a: 1, b: 0, c: 0 } },
  { key: 'sin',    label: '正弦',     expr: 'a*sin(b*x)+c', p: { a: 1, b: 1, c: 0 } },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* 把任意原始步长收拾成 1 / 2 / 5 × 10^n */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const n = m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10;
  return n * p;
}
/* 轴刻度文字：按步长决定小数位 */
function fmtTick(v, step) {
  const dec = step < 1 ? Math.min(6, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
  let s = v.toFixed(dec);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s;
}
/* 读数：自适应小数位 */
function fmtNum(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(2);
  return String(Number(v.toFixed(a < 1 ? 3 : 2)));
}

export default {
  id: 'plot', name: '图像', icon: 'chart', nav: true,

  mount(root, ctx) {
    root.dataset.plot = '1';

    /* ---- 持久化上次的表达式与参数 ---- */
    let saved = null;
    try { saved = ctx && ctx.store ? ctx.store.get('plot.state', null) : null; } catch { saved = null; }
    saved = (saved && typeof saved === 'object') ? saved : {};
    const numOr = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    const expr0 = typeof saved.expr === 'string' && saved.expr.trim() ? saved.expr : 'x^2-4*x+3';
    const param0 = { a: numOr(saved.a, 1), b: numOr(saved.b, 0), c: numOr(saved.c, 0) };

    root.innerHTML = `
      <section class="view-head">
        <div class="kicker">图像 · 手绘 SVG</div>
        <h2>函数图像</h2>
        <p>输入一个含 x 的式子，看它的曲线。拖动 a、b、c，看参数怎样改变形状。</p>
      </section>

      <div class="card glass spec plot-card">
        <div class="card__label">函数</div>
        <div class="plot-expr-row">
          <span class="plot-eq">y =</span>
          <input class="plot-input" data-plot-expr type="text" inputmode="text"
                 autocomplete="off" autocapitalize="off" spellcheck="false"
                 aria-label="函数表达式" value="${esc(expr0)}" />
        </div>
        <p class="plot-err" data-plot-error role="status"></p>

        <div class="plot-presets">
          ${PRESETS.map(p => `<button type="button" class="plot-chip" data-plot-preset="${p.key}">${esc(p.label)}</button>`).join('')}
        </div>

        <div class="plot-canvaswrap" data-plot-svg-wrap>
          <svg class="plot-svg" data-plot-svg xmlns="http://www.w3.org/2000/svg"
               preserveAspectRatio="none" aria-label="函数图像" role="img">
            <g class="plot-grid" data-g-grid></g>
            <g class="plot-axis" data-g-axis></g>
            <path class="plot-curve" data-curve fill="none"></path>
            <g class="plot-hover" data-hover style="display:none">
              <line class="plot-guide" data-hx></line>
              <line class="plot-guide" data-hy></line>
              <circle class="plot-hdot" data-hdot r="4.5"></circle>
              <circle class="plot-hdot plot-hdot--curve" data-hcurve r="3.5" style="display:none"></circle>
            </g>
          </svg>
        </div>

        <div class="plot-readout" data-plot-readout>把手指（或鼠标）放在图上，读这一点的坐标</div>

        <div class="plot-sliders">
          <label class="plot-slider"><span class="plot-slider__k">a</span>
            <input type="range" data-plot-a min="-5" max="5" step="0.1" value="${param0.a}" aria-label="参数 a" />
            <output class="plot-slider__v" data-plot-a-val>${fmtNum(param0.a)}</output></label>
          <label class="plot-slider"><span class="plot-slider__k">b</span>
            <input type="range" data-plot-b min="-5" max="5" step="0.1" value="${param0.b}" aria-label="参数 b" />
            <output class="plot-slider__v" data-plot-b-val>${fmtNum(param0.b)}</output></label>
          <label class="plot-slider"><span class="plot-slider__k">c</span>
            <input type="range" data-plot-c min="-5" max="5" step="0.1" value="${param0.c}" aria-label="参数 c" />
            <output class="plot-slider__v" data-plot-c-val>${fmtNum(param0.c)}</output></label>
        </div>

        <div class="btn-row plot-tools">
          <button class="btn btn--ghost" data-plot-reset type="button">回到原点</button>
          <span class="plot-hint">滚轮 / 双指缩放，按住拖动平移</span>
        </div>
      </div>
    `;

    /* ---- 元素引用 ---- */
    const el = {
      expr:    root.querySelector('[data-plot-expr]'),
      err:     root.querySelector('[data-plot-error]'),
      wrap:    root.querySelector('[data-plot-svg-wrap]'),
      svg:     root.querySelector('[data-plot-svg]'),
      grid:    root.querySelector('[data-g-grid]'),
      axis:    root.querySelector('[data-g-axis]'),
      curve:   root.querySelector('[data-curve]'),
      hover:   root.querySelector('[data-hover]'),
      hx:      root.querySelector('[data-hx]'),
      hy:      root.querySelector('[data-hy]'),
      hdot:    root.querySelector('[data-hdot]'),
      hcurve:  root.querySelector('[data-hcurve]'),
      readout: root.querySelector('[data-plot-readout]'),
      reset:   root.querySelector('[data-plot-reset]'),
      sA:      root.querySelector('[data-plot-a]'),
      sB:      root.querySelector('[data-plot-b]'),
      sC:      root.querySelector('[data-plot-c]'),
      vA:      root.querySelector('[data-plot-a-val]'),
      vB:      root.querySelector('[data-plot-b-val]'),
      vC:      root.querySelector('[data-plot-c-val]'),
    };

    /* ---- 视图状态（世界坐标 ↔ 屏幕坐标） ---- */
    let W = 320, H = 300;
    let scale = 30;          // 每世界单位 = 多少屏幕像素
    let baseScale = 30;      // “回到原点”的基准缩放
    let cx = 0, cy = 0;      // 视图中心对应的世界坐标
    let fn = null;           // 编译出来的 f(x)
    let params = { a: param0.a, b: param0.b, c: param0.c };

    const toScreenX = x => W / 2 + (x - cx) * scale;
    const toScreenY = y => H / 2 - (y - cy) * scale;
    const toWorldX  = sx => cx + (sx - W / 2) / scale;
    const toWorldY  = sy => cy - (sy - H / 2) / scale;

    /* ---- 编译表达式 ---- */
    function setExpr(text, quiet) {
      const c = compile(text);
      if (c.ok) {
        fn = c.fn;
        el.err.textContent = '';
        el.expr.classList.remove('is-bad');
      } else {
        fn = null;
        el.expr.classList.add('is-bad');
        el.err.textContent = '式子看不懂：' + c.error;
      }
      if (!quiet) saveState();
      draw();
    }

    function saveState() {
      try {
        ctx.store.set('plot.state', {
          expr: el.expr.value.trim(),
          a: Number(el.sA.value), b: Number(el.sB.value), c: Number(el.sC.value),
        });
      } catch { /* 存不下也不影响使用 */ }
    }

    /* ---- 采样画曲线：屏幕每像素一个点 ---- */
    function buildPath() {
      if (!fn) return '';
      const LIM = H * 8;                 // 超出太多的坐标先夹住，别把 path 撑爆
      const off = v => v < 0 || v > H;   // 在可视带之外
      let d = '';
      let prevSy = null;
      for (let px = 0; px <= W; px++) {
        const wx = toWorldX(px);
        let y;
        try { y = fn(wx, params); } catch { y = NaN; }
        if (typeof y !== 'number' || !isFinite(y)) { prevSy = null; continue; }  // 断点：无定义处
        const sy = toScreenY(y);
        const csy = clamp(sy, -LIM, LIM);
        if (prevSy === null) {
          d += `M${px} ${csy.toFixed(1)} `;
        } else if (Math.abs(sy - prevSy) > H * 2 && (off(sy) || off(prevSy))) {
          d += `M${px} ${csy.toFixed(1)} `;   // 断在渐近线处（1/x、tan 等）
        } else {
          d += `L${px} ${csy.toFixed(1)} `;
        }
        prevSy = sy;
      }
      return d.trim();
    }

    /* ---- 重画整个坐标系 ---- */
    function draw() {
      if (!el.svg) return;
      el.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

      const step = niceStep(64 / scale);
      const wl = toWorldX(0), wr = toWorldX(W);
      const wb = toWorldY(H), wt = toWorldY(0);

      /* 网格 */
      let g = '';
      const xStart = Math.ceil(wl / step) * step;
      for (let x = xStart, n = 0; x <= wr + step * 1e-6 && n < 800; x += step, n++) {
        const sx = toScreenX(x).toFixed(1);
        g += `<line x1="${sx}" y1="0" x2="${sx}" y2="${H}"/>`;
      }
      const yStart = Math.ceil(wb / step) * step;
      for (let y = yStart, n = 0; y <= wt + step * 1e-6 && n < 800; y += step, n++) {
        const sy = toScreenY(y).toFixed(1);
        g += `<line x1="0" y1="${sy}" x2="${W}" y2="${sy}"/>`;
      }
      el.grid.innerHTML = g;

      /* 坐标轴 + 刻度 */
      const realAx = toScreenX(0), realAy = toScreenY(0);
      const ax = clamp(realAx, 30, W - 12);          // y 轴屏幕 x
      const ay = clamp(realAy, 16, H - 12);          // x 轴屏幕 y
      const xLabelY = (ay <= H - 24) ? ay + 16 : ay - 8;      // 轴贴到画面底部时，数字挪到轴上方
      const yAnchor = ax > 40 ? 'end' : 'start';              // 竖排数字放轴上边还是下边
      const yLabelX = ax > 40 ? ax - 7 : ax + 7;
      let a = `<line class="plot-axis-line" x1="0" y1="${ay.toFixed(1)}" x2="${W}" y2="${ay.toFixed(1)}"/>`
            + `<line class="plot-axis-line" x1="${ax.toFixed(1)}" y1="0" x2="${ax.toFixed(1)}" y2="${H}"/>`;
      for (let x = xStart, n = 0; x <= wr + step * 1e-6 && n < 800; x += step, n++) {
        if (Math.abs(x) < step * 1e-6) continue;                 // 0 单独画在原点
        const sxf = toScreenX(x), sx = sxf.toFixed(1);
        const anchor = sxf < 12 ? 'start' : (sxf > W - 12 ? 'end' : 'middle');
        a += `<line class="plot-tick" x1="${sx}" y1="${(ay - 4).toFixed(1)}" x2="${sx}" y2="${(ay + 4).toFixed(1)}"/>`
           + `<text class="plot-ticktext" x="${sx}" y="${xLabelY.toFixed(1)}" text-anchor="${anchor}">${fmtTick(x, step)}</text>`;
      }
      for (let y = yStart, n = 0; y <= wt + step * 1e-6 && n < 800; y += step, n++) {
        if (Math.abs(y) < step * 1e-6) continue;
        const sy = toScreenY(y).toFixed(1);
        a += `<line class="plot-tick" x1="${(ax - 4).toFixed(1)}" y1="${sy}" x2="${(ax + 4).toFixed(1)}" y2="${sy}"/>`
           + `<text class="plot-ticktext" x="${yLabelX.toFixed(1)}" y="${(Number(sy) + 3.6).toFixed(1)}" text-anchor="${yAnchor}">${fmtTick(y, step)}</text>`;
      }
      a += `<text class="plot-ticktext plot-origin" x="${yLabelX.toFixed(1)}" y="${xLabelY.toFixed(1)}" text-anchor="${yAnchor}">0</text>`;
      el.axis.innerHTML = a;

      /* 曲线 */
      el.curve.setAttribute('d', buildPath());
    }

    /* ---- 悬停 / 触摸读点 ---- */
    function hideHover() {
      el.hover.style.display = 'none';
      el.readout.textContent = '把手指（或鼠标）放在图上，读这一点的坐标';
    }
    function updateHover(clientX, clientY) {
      const r = el.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const sx = (clientX - r.left) * W / r.width;
      const sy = (clientY - r.top) * H / r.height;
      if (sx < 0 || sx > W || sy < 0 || sy > H) { hideHover(); return; }
      const wx = toWorldX(sx), wy = toWorldY(sy);

      el.hover.style.display = '';
      setAttr(el.hx, { x1: sx, y1: 0, x2: sx, y2: H });
      setAttr(el.hy, { x1: 0, y1: sy, x2: W, y2: sy });
      setAttr(el.hdot, { cx: sx, cy: sy });

      let line = `x = ${fmtNum(wx)}　y = ${fmtNum(wy)}`;
      if (fn) {
        let fy;
        try { fy = fn(wx, params); } catch { fy = NaN; }
        if (typeof fy === 'number' && isFinite(fy)) {
          const cyS = toScreenY(fy);
          el.hcurve.style.display = '';
          setAttr(el.hcurve, { cx: sx, cy: clamp(cyS, -20, H + 20) });
          line += `　曲线 y = ${fmtNum(fy)}`;
        } else {
          el.hcurve.style.display = 'none';
        }
      } else {
        el.hcurve.style.display = 'none';
      }
      el.readout.textContent = line;
    }
    function setAttr(node, o) {
      for (const k in o) node.setAttribute(k, Number(o[k]).toFixed(1));
    }

    /* ---- 缩放 / 平移 ---- */
    const MIN_SCALE = () => baseScale / 60;
    const MAX_SCALE = () => baseScale * 600;
    function zoomAt(clientX, clientY, factor) {
      const r = el.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const mx = (clientX - r.left) * W / r.width;
      const my = (clientY - r.top) * H / r.height;
      const before = { x: toWorldX(mx), y: toWorldY(my) };
      scale = clamp(scale * factor, MIN_SCALE(), MAX_SCALE());
      cx = before.x - (mx - W / 2) / scale;   // 让光标下的世界点保持不动
      cy = before.y + (my - H / 2) / scale;
      draw();
    }
    function panByClient(dxClient, dyClient) {
      const r = el.svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dx = dxClient * W / r.width;
      const dy = dyClient * H / r.height;
      cx -= dx / scale;
      cy += dy / scale;
      draw();
    }
    function resetView() {
      cx = 0; cy = 0; scale = baseScale;
      hideHover();
      draw();
    }

    /* 指针事件：单指拖动平移，双指捏合缩放，鼠标悬停读点 */
    const pointers = new Map();
    let last = null, pinch = null, moved = false;

    el.svg.addEventListener('pointerdown', e => {
      el.svg.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pointers.size === 1) {
        last = { x: e.clientX, y: e.clientY };
        pinch = null;
        el.svg.classList.add('is-grabbing');
        if (e.pointerType !== 'touch') updateHover(e.clientX, e.clientY);
      } else if (pointers.size === 2) {
        const p = [...pointers.values()];
        pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
                  mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
        el.hover.style.display = 'none';
      }
    });

    el.svg.addEventListener('pointermove', e => {
      const rec = pointers.get(e.pointerId);
      if (rec) { rec.x = e.clientX; rec.y = e.clientY; }

      if (pointers.size === 2 && pinch) {
        const p = [...pointers.values()];
        const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
        if (pinch.d > 0) zoomAt(mx, my, d / pinch.d);
        panByClient(mx - pinch.mx, my - pinch.my);
        pinch = { d, mx, my };
        moved = true;
        return;
      }

      if (rec && pointers.size === 1 && last) {
        panByClient(e.clientX - last.x, e.clientY - last.y);
        last = { x: e.clientX, y: e.clientY };
        moved = true;
        return;
      }

      // 没按下时移动（鼠标）：读点
      if (!pointers.size && e.pointerType !== 'touch') updateHover(e.clientX, e.clientY);
    });

    const endPointer = e => {
      const wasTouch = e.pointerType === 'touch';
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) { const p = [...pointers.values()][0]; last = { x: p.x, y: p.y }; }
      if (pointers.size === 0) { last = null; el.svg.classList.remove('is-grabbing'); }
      // 轻点一下（没拖动）也读一下那个点
      if (wasTouch && !moved && pointers.size === 0) updateHover(e.clientX, e.clientY);
    };
    el.svg.addEventListener('pointerup', endPointer);
    el.svg.addEventListener('pointercancel', endPointer);

    el.svg.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    el.svg.addEventListener('pointerleave', () => { if (!pointers.size) hideHover(); });

    /* ---- 控件绑定 ---- */
    let debounce = 0;
    el.expr.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => setExpr(el.expr.value, false), 90);
    });
    el.expr.addEventListener('change', () => { clearTimeout(debounce); setExpr(el.expr.value, false); });

    const syncSlider = (input, out) => { out.textContent = fmtNum(Number(input.value)); };
    const onSlider = () => {
      params = { a: Number(el.sA.value), b: Number(el.sB.value), c: Number(el.sC.value) };
      syncSlider(el.sA, el.vA); syncSlider(el.sB, el.vB); syncSlider(el.sC, el.vC);
      saveState();
      draw();
    };
    el.sA.addEventListener('input', onSlider);
    el.sB.addEventListener('input', onSlider);
    el.sC.addEventListener('input', onSlider);

    el.reset.addEventListener('click', resetView);

    root.querySelectorAll('[data-plot-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = PRESETS.find(p => p.key === btn.dataset.plotPreset);
        if (!pre) return;
        el.expr.value = pre.expr;
        el.sA.value = pre.p.a; el.sB.value = pre.p.b; el.sC.value = pre.p.c;
        params = { ...pre.p };
        syncSlider(el.sA, el.vA); syncSlider(el.sB, el.vB); syncSlider(el.sC, el.vC);
        setExpr(pre.expr, true);
        resetView();
        saveState();
      });
    });

    /* ---- 尺寸：先同步量一次，之后用 ResizeObserver 跟随 ---- */
    let inited = false;
    function measure() {
      const r = el.wrap.getBoundingClientRect();
      W = Math.max(220, Math.round(r.width || 320));
      H = Math.max(180, Math.round(r.height || r.width || 300));
      if (!inited) {
        inited = true;
        baseScale = clamp(W / 13, 8, 60);   // 初始视野约 ±6.5 个单位，刻度数字不会贴边
        scale = baseScale;
      }
    }
    measure();
    setExpr(expr0, true);
    if (typeof ResizeObserver !== 'undefined') {
      try {
        new ResizeObserver(() => {
          const ow = W, oh = H;
          measure();
          if (W !== ow || H !== oh) draw();
        }).observe(el.wrap);
      } catch { /* 忽略 */ }
    } else {
      window.addEventListener('resize', () => { measure(); draw(); });
    }
    // 首帧布局可能还没定下来，再量一次
    requestAnimationFrame(() => {
      const ow = W, oh = H;
      measure();
      if (W !== ow || H !== oh) draw();
      root.dataset.plotReady = '1';
    });
  },
};
