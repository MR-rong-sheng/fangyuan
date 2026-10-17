/* ==========================================================================
   方圆 · app.js —— 启动装配
   想加模块？写一个 js/views/xxx.js 导出 {id,name,icon,mount}，
   在这里 import 并放进 ROUTES 即可，导航会自动生成。
   管理模块只在管理员登录后才动态加载（见文件末尾）。
   ========================================================================== */
import { define, start, render, buildNav, prefs, go, $, toast, session, openDrawer, closeDrawer,
         esc, stamp, ic, currentId, visibleRoutes } from './core.js';
import { me, logout, changePassword } from './api.js';
import { initActivity, flushNow } from './activity.js';

import today    from './views/today.js?v=20261011b';
import drill    from './views/drill.js?v=20261011b';
import bank     from './views/bank.js?v=20261011b';
import papers   from './views/papers.js?v=20261011b';
import formulas from './views/formulas.js?v=20261011b';
import plot     from './views/plot.js?v=20261011b';
import notebook from './views/notebook.js?v=20261011b';
import streak   from './views/streak.js?v=20261011b';
import settings from './views/settings.js?v=20261011b';

/* 顺序就是导航顺序：先做题（今日/练习），再找题与成卷（题库/组卷），然后工具，最后设置 */
const ROUTES = [today, drill, bank, papers, formulas, plot, notebook, streak, settings];
ROUTES.forEach(define);

prefs.apply();

/* 顶栏：日夜切换 + 设置 */
const themeBtn = $('#btn-theme');
function paintThemeBtn() {
  const dark = prefs.data.theme === 'dark';
  /* 三档主题：日间 ⇄ 夜间 ⇄ 赛博 */
  const T = { light: { icon: 'moon', tip: '切到夜间' },
              dark: { icon: 'bolt', tip: '切到赛博' },
              cyber: { icon: 'sun', tip: '切到日间' } }[prefs.data.theme] || { icon: 'moon', tip: '切换主题' };
  themeBtn.innerHTML = `<svg class="ic"><use href="#i-${T.icon}"/></svg>`;
  themeBtn.title = T.tip;
}
themeBtn.addEventListener('click', () => {
  prefs.toggleTheme();
  paintThemeBtn();
  toast({ light: '已切到日间', dark: '已切到夜间', cyber: '已切到赛博' }[prefs.data.theme] || '已切换主题');
});
paintThemeBtn();

$('#btn-settings').addEventListener('click', () => go('settings'));

/* 先把外壳同步渲染出来：首屏不依赖任何网络往返（之前改成“等 /api/me 回来再渲染”，
   结果是白屏一瞬、自检也等不到；401 的真根因在服务端身份缓存，与渲染顺序无关）。
   身份相关的顶栏/导航/后台，仍然在下面问过 /api/me 之后再补。 */
start();

/* 品牌名点回今日 */
$('.brand').addEventListener('click', e => { e.preventDefault(); go('today'); });

/* ==========================================================================
   账号：问一次服务端「我是谁」，再决定顶栏、导航和管理模块
   （页面本身已被 serve.py 挡在登录之后，这里主要是拿名字与权限）
   ========================================================================== */
const back = encodeURIComponent(location.pathname + location.search + location.hash);
let bootInfo = { user: null, setup: false };
try {
  bootInfo = await me();
} catch (err) {
  toast('读取账号状态失败：' + (err.message || err));
}

if (!bootInfo.user) {
  /* 会话过期，或还没建管理员 —— 回登录页 */
  location.replace(bootInfo.setup ? '/login.html' : '/login.html?next=' + back);
} else {
  session.set(bootInfo.user);

  /* 身份已确认：给自检/自动化一个确定性信号（属性 + 事件，事件不受虚拟时间快进影响） */
  document.documentElement.dataset.ready = '1';
  window.dispatchEvent(new CustomEvent('fangyuan:ready'));
  render();                          /* 顶栏账号、按角色过滤导航都确定下来了，重画一次 */

  /* 行为存档：确认登录后开采集；顺便把「已经渲染好的当前页」补报一次 */
  initActivity(id => {
    const r = visibleRoutes().find(x => x.id === id);
    return r ? r.name : id;
  });
  window.dispatchEvent(new CustomEvent('fangyuan:view', { detail: { id: currentId() } }));

  if (session.isAdmin()) {
    try {
      const mod = await import('./views/admin.js');
      define(mod.default);
      buildNav();                    /* 管理项是在确认了身份之后才登记的，导航要重画一次 */
      if (location.hash === '#/admin') render();      /* 直接开后台也能进 */
    } catch (err) {
      console.warn('管理模块没加载出来：', err);
      toast('后台模块加载失败，先看看别的页面');
    }
  }
}

/* 顶栏账号按钮 → 账号抽屉 */
$('#btn-user').addEventListener('click', () => {
  const u = session.user || { name: '—', role: '', last_login: null };
  const isAdmin = u.role === 'admin';
  openDrawer({
    title: u.name,
    sub: isAdmin ? '管理员账号' : '普通账号',
    html: `
      <div class="kv"><b>账号</b><span>${esc(u.name)}</span></div>
      <div class="kv"><b>权限</b><span>${isAdmin ? '管理员（可进后台）' : '普通（只能看前台）'}</span></div>
      <div class="kv"><b>上次登录</b><span>${u.last_login ? stamp(u.last_login * 1000) : '这是第一次'}</span></div>
      <div class="kv"><b>站点版本</b><span>方圆 v${esc(bootInfo.version || '2.0')}</span></div>
      <hr class="hr" />
      <p style="font-size:12.5px;color:var(--ink-3);margin:12px 0">改密码后所有设备都要重新登录。</p>
      <label class="field" style="margin-bottom:10px">原密码
        <input id="pw-old" type="password" autocomplete="current-password" /></label>
      <label class="field">新密码
        <input id="pw-new" type="password" autocomplete="new-password" /></label>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn--primary" id="pw-save">${ic('key')}改密码</button>
      </div>`,
    actions: [
      ...(isAdmin ? [{ label: '后台管理', icon: 'shield', onClick: () => { closeDrawer(); go('admin'); } }] : []),
      { label: '退出登录', icon: 'out', onClick: async () => { await flushNow(); logout(); } },
    ],
  });

  const saveBtn = $('#pw-save');
  if (!saveBtn) return;
  saveBtn.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const oldPw = $('#pw-old').value;
    const newPw = $('#pw-new').value;
    if (!oldPw || !newPw) return toast('两个密码都要填');
    if (newPw.length < 6) return toast('新密码至少 6 位');
    btn.disabled = true;
    btn.textContent = '正在保存…';
    try {
      await changePassword(oldPw, newPw);
      toast('已改密码，请用新密码重新登录');
      setTimeout(() => location.replace('/login.html'), 900);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = ic('key') + '改密码';
      toast(err.message || '改密码失败');
    }
  });
});
