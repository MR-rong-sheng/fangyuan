/* ==========================================================================
   方圆 · lib/mathfmt.js —— 极简数学标记渲染器（零依赖）
   --------------------------------------------------------------------------
   把 content/formulas.json 里的自制标记渲染成 HTML：
     a^2 / a^{m+n}       → <sup>
     x_1 / x_{n+1}       → <sub>
     \frac{分子}{分母}    → 上下堆叠的分式（分子 / 细线 / 分母）
     √(b^2-4ac)          → 带上方横线的根号
   规则：**先整体 HTML 转义，再按标记替换**。转义之后正文里已经不含
   任何 < > " ' &（都变成了实体），后面的解析只输出我们自己写的标签，
   所以数据里的 <script> 永远不会变成 DOM。
   ========================================================================== */
import { esc } from '../core.js';

/** 把一段标记文本渲染成可安全插入 innerHTML 的 HTML 字符串 */
export function renderMath(text) {
  return build(esc(text == null ? '' : text));
}

/* 从 open 处读一个配对的括注（支持嵌套），返回 { inner, next }；不配对返回 null */
function readGroup(s, i, open, close) {
  if (s[i] !== open) return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close) {
      depth--;
      if (depth === 0) return { inner: s.slice(i + 1, j), next: j + 1 };
    }
  }
  return null;               // 括号没闭合，交回上层当普通字符处理
}

/* ^、_ 后面的参数：{...} 或单个字符 */
function readScript(s, i) {
  if (s[i] === '{') return readGroup(s, i, '{', '}');
  if (i < s.length) return { inner: s[i], next: i + 1 };
  return null;
}

/* √ 后面的被开方部分：(...) / {...} 或单个原子 */
function readRadical(s, i) {
  if (s[i] === '(') return readGroup(s, i, '(', ')');
  if (s[i] === '{') return readGroup(s, i, '{', '}');
  if (i < s.length) return { inner: s[i], next: i + 1 };
  return null;
}

function frac(n, d) {
  return `<span class="fx-frac"><span class="fx-frac__n">${n}</span>`
       + `<span class="fx-frac__d">${d}</span></span>`;
}
function radical(n) {
  return `<span class="fx-rad"><span class="fx-rad__sign">√</span>`
       + `<span class="fx-rad__body">${n}</span></span>`;
}

/* 递归扫描：内容会嵌套（分式里套根号、根号里套上标），所以逐字符走、遇标记才递归 */
function build(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\' && src.startsWith('\\frac', i)) {
      const a = readGroup(src, i + 5, '{', '}');
      const b = a ? readGroup(src, a.next, '{', '}') : null;
      if (a && b) { out += frac(build(a.inner), build(b.inner)); i = b.next; continue; }
    }
    if (ch === '^') {
      const g = readScript(src, i + 1);
      if (g) { out += `<sup>${build(g.inner)}</sup>`; i = g.next; continue; }
    }
    if (ch === '_') {
      const g = readScript(src, i + 1);
      if (g) { out += `<sub>${build(g.inner)}</sub>`; i = g.next; continue; }
    }
    if (ch === '√') {
      const g = readRadical(src, i + 1);
      if (g) { out += radical(build(g.inner)); i = g.next; continue; }
    }

    out += ch;               // 普通字符（已在入口转义过）原样透出
    i++;
  }
  return out;
}

export default renderMath;
