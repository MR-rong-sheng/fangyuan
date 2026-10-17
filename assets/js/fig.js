/* ==========================================================================
   方圆 · fig.js —— 题图（SVG）渲染
   --------------------------------------------------------------------------
   题库里的图形是**自己按题干条件画的原创 SVG**（规范见 tools/FIG.md），
   文件在 content/bank/fig/<题目 id>.svg，题目对象用 fig 字段指路。

   为什么取回文本后**内联**而不是用 <img src>：
   图里所有线条用 currentColor，内联才能继承页面文字色 —— 日间/夜间/赛博三个主题下自动跟着变，
   不用为每种主题各画一套。

   安全：只渲染我们自己目录里的 SVG；校验器已禁止 <script> 与 on*= 属性，
   这里再兜一层（文本必须以 <svg 开头、且不含 <script>）。取不到图就默默移除容器，不留空框。
   ========================================================================== */
const cache = new Map();

/** 取回一张题的 SVG 文本（带缓存）；拿不到返回空串 */
export async function loadFig(path) {
  const key = String(path || '').trim();
  if (!key) return '';
  if (cache.has(key)) return cache.get(key);
  let txt = '';
  try {
    const url = '/' + key.replace(/^\/+/, '');
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) {
      const t = await res.text();
      if (/<svg[\s>]/i.test(t) && !/<script/i.test(t) && !/\son[a-z]+\s*=/i.test(t)) txt = t;
    }
  } catch (e) {
    txt = '';
  }
  cache.set(key, txt);
  return txt;
}

/** 把 root 下所有带 data-fig 的容器填上图；返回处理的容器数 */
export async function mountFigs(root) {
  const scope = root || document;
  const els = [...scope.querySelectorAll('[data-fig]')];
  await Promise.all(els.map(async el => {
    const path = el.getAttribute('data-fig');
    if (!path) { el.remove(); return; }
    const txt = await loadFig(path);
    if (!txt) { el.remove(); return; }
    el.innerHTML = txt;
    el.classList.add('fig--on');
    el.setAttribute('role', 'img');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', '题图');
  }));
  return els.length;
}

export default { loadFig, mountFigs };
