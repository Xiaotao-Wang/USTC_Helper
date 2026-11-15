// 经典脚本（内容脚本共享作用域），无 import/export。
// 依赖：content/util.js（bbParseDate/bbFmtDateTime/bbHumanDelta/bbDueStatus）
//       content/parser.js（bbParseCurrentCourses/bbParseGradeItems/bbLooksLikeLogin/bbSummarize）
// 作用：在 BB 首页主内容框内，直接展示作业面板（三个选项卡）：
//   1. 未完成作业（按 DDL 升序）
//   2. 已完成作业 = 已评分（按评分时间倒序，显示分数）
//   3. 已完成未评分 = 已提交待评分（按提交时间倒序）
// 复用当前已登录会话（同源 fetch 携带 Cookie），不后台、不弹窗、不定时。

(function () {
  'use strict';

  var PANEL_ID = 'bb-hw-checker';
  var CACHE_KEY = 'bbHwCache_v2';
  var CACHE_TTL = 10 * 60 * 1000; // 10 分钟内复用缓存，减少请求
  var SOON_HOURS = 24;

  var TABS = [
    { key: 'todo', label: '未完成作业' },
    { key: 'graded', label: '已完成作业' },
    { key: 'submitted', label: '已完成未评分' }
  ];

  // 只在首页主内容框注入：跳过 frameset 容器与导航/横幅框。
  function isHomeFrame() {
    if (window.__bbHwCheckerInjected) return false;
    if (document.querySelector('frameset')) return false;
    if (!document.body) return false;
    var href = location.href;
    var path = location.pathname;
    if (/\/webapps\/portal\/execute\/tabs\/tabAction/i.test(href)) return true;
    if (path === '/' || path === '') return true;
    if (/\/webapps\/portal\/frameset\.jsp/i.test(href)) return true;
    return false;
  }

  if (!isHomeFrame()) return;
  window.__bbHwCheckerInjected = true;

  var BB_BASE = location.origin;
  var PORTAL_TAB_URL = BB_BASE + '/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1';
  function myGradesUrl(id) {
    return BB_BASE + '/webapps/bb-mygrades-BBLEARN/myGrades?course_id=' +
      encodeURIComponent(id) + '&stream_name=mygrades';
  }
  function courseMainUrl(id) {
    return BB_BASE + '/webapps/blackboard/execute/courseMain?course_id=' + encodeURIComponent(id);
  }

  // ---------- 网络 ----------
  function fetchText(url) {
    return fetch(url, { credentials: 'include', redirect: 'follow' })
      .then(function (res) { return res.text().then(function (t) { return { html: t, url: res.url }; }); });
  }

  function resolveHref(href, courseId) {
    if (!href) return courseMainUrl(courseId);
    if (/^javascript:/i.test(href)) return courseMainUrl(courseId);
    try { return new URL(href, BB_BASE).href; }
    catch (e) { return courseMainUrl(courseId); }
  }

  // 有限并发，温和地复用会话
  function mapPool(list, limit, fn) {
    return new Promise(function (resolve) {
      var results = new Array(list.length);
      var idx = 0, active = 0, done = 0;
      if (!list.length) return resolve(results);
      function next() {
        while (active < limit && idx < list.length) {
          (function (i) {
            active++;
            Promise.resolve(fn(list[i], i)).then(function (r) {
              results[i] = r;
            }).catch(function () {
              results[i] = null;
            }).then(function () {
              active--; done++;
              if (done === list.length) resolve(results);
              else next();
            });
          })(idx++);
        }
      }
      next();
    });
  }

  function collect() {
    return fetchText(PORTAL_TAB_URL).then(function (tab) {
      if (bbLooksLikeLogin(tab.html, tab.url)) {
        return { login: true, courses: [], items: [], diag: null };
      }
      var courses = bbParseCurrentCourses(tab.html);
      if (!courses.length) {
        courses = bbParseCurrentCourses(document.documentElement.outerHTML);
      }
      var diag = { tab: bbSummarize(tab.html), grades: [] };
      return mapPool(courses, 3, function (c) {
        return fetchText(myGradesUrl(c.id)).then(function (g) {
          if (bbLooksLikeLogin(g.html, g.url)) return { login: true };
          var items = bbParseGradeItems(g.html, c);
          if (!items.length) diag.grades.push({ course: c.name, summary: bbSummarize(g.html) });
          return { course: c, items: items };
        }).catch(function () { return { course: c, items: [] }; });
      }).then(function (perCourse) {
        var login = false, all = [];
        perCourse.forEach(function (r) {
          if (!r) return;
          if (r.login) { login = true; return; }
          (r.items || []).forEach(function (it) { all.push(it); });
        });
        return { login: login, courses: courses, items: all, diag: diag };
      });
    });
  }

  // ---------- 选项卡过滤 / 排序 ----------
  // 归一化状态：graded（已评分）/ submitted（已提交待评分）/ upcoming（未完成）/ unknown
  function itemStatus(it) {
    if (it.status === 'graded' || it.status === 'submitted' || it.status === 'upcoming') return it.status;
    if (it.completed === true) {
      return (it.gradeText && /\d/.test(it.gradeText)) ? 'graded' : 'submitted';
    }
    if (it.completed === false) return 'upcoming';
    return 'unknown';
  }

  function tabItems(items, key) {
    var seen = {}, out = [];
    (items || []).forEach(function (it) {
      if (it.type === 'test') return;
      var st = itemStatus(it);
      var keep = false;
      if (key === 'todo') {
        keep = (st === 'upcoming') || (st === 'unknown' && it.type === 'assignment');
      } else if (key === 'graded') {
        keep = (st === 'graded') && it.type === 'assignment';
      } else if (key === 'submitted') {
        keep = (st === 'submitted') && it.type === 'assignment';
      }
      if (!keep) return;
      var k = it.courseId + '|' + it.name;
      if (seen[k]) return;
      seen[k] = true;
      out.push(it);
    });
    if (key === 'todo') {
      // DDL 升序，无截止日期排最后
      out.sort(function (a, b) {
        var ax = a.dueTs == null ? Infinity : a.dueTs;
        var bx = b.dueTs == null ? Infinity : b.dueTs;
        if (ax !== bx) return ax - bx;
        return (a.courseName || '').localeCompare(b.courseName || '');
      });
    } else {
      // 评分时间 / 提交时间倒序（最新在前），无时间排最后
      out.sort(function (a, b) {
        var ax = a.activityTs == null ? -Infinity : a.activityTs;
        var bx = b.activityTs == null ? -Infinity : b.activityTs;
        if (ax !== bx) return bx - ax;
        return (a.courseName || '').localeCompare(b.courseName || '');
      });
    }
    return out;
  }

  // 分数美化："10.00000/10" → "10/10"；"-0.00000/10" → "0/10"
  function fmtGrade(g) {
    if (!g) return '已评分';
    var m = String(g).match(/^\s*(-?\d+(?:\.\d+)?)\s*([\s\S]*)$/);
    if (!m) return String(g);
    var n = parseFloat(m[1]);
    if (isNaN(n)) return String(g);
    var v = Math.round(n * 100) / 100;
    if (v === 0) v = 0; // 归一化 -0
    return String(v) + (m[2] || '');
  }

  // ---------- 缓存 ----------
  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.ts) return null;
      if (Date.now() - obj.ts > CACHE_TTL) return null;
      return obj;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data })); }
    catch (e) {}
  }

  // ---------- UI ----------
  var panel, headerEl, bodyEl, listEl, tabsEl, headerCount, refreshBtn, refreshLabel;
  var tabButtons = {}, tabCounts = {};
  var collapsed = false;
  var loading = false;
  var activeTab = 'todo';
  var currentData = null; // 最近一次采集的全量数据（切换选项卡不重新请求）
  try { collapsed = localStorage.getItem('bbHwCollapsed') === '1'; } catch (e) {}
  try {
    var savedTab = localStorage.getItem('bbHwActiveTab');
    if (savedTab === 'todo' || savedTab === 'graded' || savedTab === 'submitted') activeTab = savedTab;
  } catch (e) {}

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
    panel = el('div', 'bb-hw-panel');
    panel.id = PANEL_ID;

    headerEl = el('div', 'bb-hw-header');
    headerEl.setAttribute('role', 'button');
    headerEl.tabIndex = 0;
    var titleWrap = el('div', 'bb-hw-titlewrap');
    var dot = el('span', 'bb-hw-logo');
    dot.textContent = 'BB';
    titleWrap.appendChild(dot);
    titleWrap.appendChild(el('span', 'bb-hw-title', '作业面板'));
    headerCount = el('span', 'bb-hw-headcount', '');
    titleWrap.appendChild(headerCount);
    headerEl.appendChild(titleWrap);

    var actions = el('div', 'bb-hw-actions');
    refreshBtn = el('button', 'bb-hw-btn bb-hw-refresh');
    refreshBtn.type = 'button';
    refreshBtn.innerHTML = '<svg class="bb-hw-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>';
    refreshLabel = el('span', 'bb-hw-refresh-label', '刷新');
    refreshBtn.appendChild(refreshLabel);
    refreshBtn.addEventListener('click', function (e) { e.stopPropagation(); refresh(); });
    actions.appendChild(refreshBtn);
    var chev = el('span', 'bb-hw-chevron');
    chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
    actions.appendChild(chev);
    headerEl.appendChild(actions);
    // 点击标题栏整行即可展开 / 收起，无需单独按钮
    headerEl.addEventListener('click', function () { toggleCollapse(); });
    headerEl.addEventListener('keydown', function (e) {
      if (e.target !== headerEl) return;
      if (e.key === 'Enter' || e.key === ' ') { toggleCollapse(); e.preventDefault(); }
    });
    panel.appendChild(headerEl);

    var collapseWrap = el('div', 'bb-hw-collapse');
    bodyEl = el('div', 'bb-hw-body');

    tabsEl = el('div', 'bb-hw-tabs');
    tabsEl.setAttribute('role', 'tablist');
    tabsEl.setAttribute('aria-label', '作业状态');
    TABS.forEach(function (t) {
      var btn = el('button', 'bb-hw-tab bb-hw-tab-' + t.key);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', 'bb-hw-list');
      btn.appendChild(el('span', 'bb-hw-tab-label', t.label));
      var cnt = el('span', 'bb-hw-tab-count', '');
      btn.appendChild(cnt);
      btn.addEventListener('click', function () { switchTab(t.key); });
      tabsEl.appendChild(btn);
      tabButtons[t.key] = btn;
      tabCounts[t.key] = cnt;
    });
    tabsEl.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var idx = -1;
      for (var i = 0; i < TABS.length; i++) if (TABS[i].key === activeTab) { idx = i; break; }
      var next = e.key === 'ArrowRight' ? (idx + 1) % TABS.length : (idx + TABS.length - 1) % TABS.length;
      switchTab(TABS[next].key);
      tabButtons[TABS[next].key].focus();
      e.preventDefault();
    });
    bodyEl.appendChild(tabsEl);

    listEl = el('div', 'bb-hw-list');
    listEl.id = 'bb-hw-list';
    listEl.setAttribute('role', 'tabpanel');
    listEl.setAttribute('aria-live', 'polite');
    bodyEl.appendChild(listEl);
    collapseWrap.appendChild(bodyEl);
    panel.appendChild(collapseWrap);

    document.body.insertBefore(panel, document.body.firstChild);
    applyCollapse();
    updateTabUI();
    return panel;
  }

  function toggleCollapse() {
    collapsed = !collapsed;
    try { localStorage.setItem('bbHwCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    applyCollapse();
  }

  function applyCollapse() {
    if (!panel) return;
    panel.classList.toggle('bb-hw-collapsed', collapsed);
    if (headerEl) {
      headerEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      headerEl.title = collapsed ? '点击展开作业面板' : '点击收起作业面板';
    }
  }

  function updateTabUI() {
    TABS.forEach(function (t) {
      var btn = tabButtons[t.key];
      if (!btn) return;
      var on = t.key === activeTab;
      btn.classList.toggle('bb-hw-tab-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    });
  }

  function switchTab(key) {
    if (activeTab === key) return;
    activeTab = key;
    try { localStorage.setItem('bbHwActiveTab', key); } catch (e) {}
    updateTabUI();
    // 读取中不渲染旧数据，避免与正在进行的刷新冲突
    if (!loading && currentData && !currentData.login) renderTab();
  }

  function setTabCounts(lists) {
    TABS.forEach(function (t) {
      var cnt = tabCounts[t.key];
      if (!cnt) return;
      var n = lists && lists[t.key] ? lists[t.key].length : 0;
      cnt.textContent = n ? String(n) : '';
    });
    // 标题栏常驻「未完成」数：收起时也能一眼看到还有多少要交
    if (headerCount) {
      var pending = lists && lists.todo ? lists.todo.length : 0;
      headerCount.textContent = pending ? String(pending) : '';
    }
  }

  function clearList() { while (listEl.firstChild) listEl.removeChild(listEl.firstChild); }

  function setLoading(on) {
    if (!panel) return;
    loading = !!on;
    panel.classList.toggle('bb-hw-loading', !!on);
    if (refreshBtn) refreshBtn.disabled = !!on;
    if (refreshLabel) refreshLabel.textContent = on ? '读取中…' : '刷新';
  }

  function skeletonRow() {
    var row = el('div', 'bb-hw-skeleton');
    row.appendChild(el('div', 'bb-hw-sk bb-hw-sk-badge'));
    var main = el('div', 'bb-hw-sk-main');
    main.appendChild(el('div', 'bb-hw-sk bb-hw-sk-name'));
    main.appendChild(el('div', 'bb-hw-sk bb-hw-sk-course'));
    row.appendChild(main);
    row.appendChild(el('div', 'bb-hw-sk bb-hw-sk-due'));
    return row;
  }

  function renderLoading() {
    buildPanel();
    clearList();
    setTabCounts(null);
    panel.classList.remove('bb-hw-has-overdue');
    setLoading(true);
    for (var i = 0; i < 3; i++) listEl.appendChild(skeletonRow());
  }

  function renderLogin() {
    buildPanel();
    clearList();
    setTabCounts(null);
    panel.classList.remove('bb-hw-has-overdue');
    setLoading(false);
    var note = el('div', 'bb-hw-note bb-hw-warn');
    note.appendChild(document.createTextNode('登录已失效，请重新登录 BB 后点「刷新」。'));
    listEl.appendChild(note);
  }

  function statusLabel(st) {
    if (st === 'overdue') return '逾期';
    if (st === 'soon') return '临近';
    if (st === 'normal') return '待交';
    return '无截止';
  }

  // 未完成作业行：状态徽章 + 名称/课程 + DDL/倒计时
  function todoRow(it, now) {
    var st = bbDueStatus(it.dueTs, now, SOON_HOURS);
    var row = el('div', 'bb-hw-item bb-hw-' + st);
    row.appendChild(el('span', 'bb-hw-badge', statusLabel(st)));

    var main = el('div', 'bb-hw-main');
    var name = el('a', 'bb-hw-name', it.name);
    name.href = resolveHref(it.href, it.courseId);
    name.target = '_blank';
    name.rel = 'noopener';
    name.title = it.name;
    main.appendChild(name);
    if (it.courseName) main.appendChild(el('div', 'bb-hw-course', it.courseName));
    row.appendChild(main);

    var due = el('div', 'bb-hw-due');
    due.appendChild(el('div', 'bb-hw-ddl', it.dueTs ? bbFmtDateTime(it.dueTs) : '无截止日期'));
    if (it.dueTs) due.appendChild(el('div', 'bb-hw-delta', bbHumanDelta(it.dueTs, now)));
    row.appendChild(due);
    return row;
  }

  // 已评分 / 待评分行：分数（或待评分）徽章 + 名称/课程 + 评分/提交时间
  function doneRow(it, kind) {
    var row = el('div', 'bb-hw-item bb-hw-' + kind);
    var badgeText = kind === 'graded' ? fmtGrade(it.gradeText) : '待评分';
    row.appendChild(el('span', 'bb-hw-badge bb-hw-badge-' + kind, badgeText));

    var main = el('div', 'bb-hw-main');
    var name = el('a', 'bb-hw-name', it.name);
    name.href = resolveHref(it.href, it.courseId);
    name.target = '_blank';
    name.rel = 'noopener';
    name.title = it.name;
    main.appendChild(name);
    if (it.courseName) main.appendChild(el('div', 'bb-hw-course', it.courseName));
    row.appendChild(main);

    var due = el('div', 'bb-hw-due');
    due.appendChild(el('div', 'bb-hw-ddl', it.activityTs ? bbFmtDateTime(it.activityTs) : '时间未知'));
    due.appendChild(el('div', 'bb-hw-delta', kind === 'graded' ? '评分时间' : '提交时间'));
    row.appendChild(due);
    return row;
  }

  var EMPTY_NOTE = {
    todo: '暂无未完成的作业。',
    graded: '暂无已评分的作业。',
    submitted: '暂无待评分的作业。'
  };

  function renderTab() {
    buildPanel();
    clearList();
    setLoading(false);
    var items = (currentData && currentData.items) || [];
    var lists = {
      todo: tabItems(items, 'todo'),
      graded: tabItems(items, 'graded'),
      submitted: tabItems(items, 'submitted')
    };
    setTabCounts(lists);
    var now = Date.now();
    var active = lists[activeTab] || [];
    var hasOverdue = activeTab === 'todo' && active.some(function (it) {
      return bbDueStatus(it.dueTs, now, SOON_HOURS) === 'overdue';
    });
    panel.classList.toggle('bb-hw-has-overdue', hasOverdue);
    if (!active.length) {
      listEl.appendChild(el('div', 'bb-hw-note' + (activeTab === 'todo' ? ' bb-hw-ok' : ''), EMPTY_NOTE[activeTab]));
      return;
    }
    active.forEach(function (it) {
      if (activeTab === 'todo') listEl.appendChild(todoRow(it, now));
      else listEl.appendChild(doneRow(it, activeTab));
    });
  }

  function renderCalibration(data) {
    // 未解析到任何结构时的校准态（与「暂无未完成作业」区分开）
    buildPanel();
    clearList();
    setLoading(false);
    setTabCounts(null);
    panel.classList.remove('bb-hw-has-overdue');
    var wrap = el('div', 'bb-hw-calib');
    wrap.appendChild(el('div', 'bb-hw-note',
      '未解析到作业，可能是页面结构与预期不同。可导出结构用于校准。'));
    var btn = el('button', 'bb-hw-btn', '导出页面结构');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      try {
        var blob = new Blob([JSON.stringify(data.diag || {}, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'bb-hw-structure.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      } catch (e) {}
    });
    wrap.appendChild(btn);
    listEl.appendChild(wrap);
  }

  function render(data) {
    currentData = data;
    if (!data || data.login) { renderLogin(); return; }
    var nothingParsed = (!data.courses || !data.courses.length) || !(data.items || []).length;
    if (nothingParsed) { renderCalibration(data); return; }
    renderTab();
  }

  function refresh() {
    if (loading) return;
    renderLoading();
    collect().then(function (data) {
      writeCache(data);
      render(data);
    }).catch(function (err) {
      buildPanel();
      clearList();
      setLoading(false);
      setTabCounts(null);
      panel.classList.remove('bb-hw-has-overdue');
      listEl.appendChild(el('div', 'bb-hw-note bb-hw-warn', '读取失败：' + (err && err.message ? err.message : err)));
    });
  }

  function start() {
    var cached = readCache();
    if (cached && cached.data) { render(cached.data); return; }
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();