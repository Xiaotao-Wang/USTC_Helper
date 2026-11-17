// ==UserScript==
// @name         USTC 课表自动回传 → 小桃课表
// @namespace    tao-table
// @version      3.2.1
// @description  登录科大教务后全自动：自动进课表页、自动读表、自动跳回「小桃课表」导入。不读取账号密码。
// @match        *://jw.ustc.edu.cn/*
// @match        *://mis.teach.ustc.edu.cn/*
// @match        *://*.ustc.edu.cn/*
// @match        https://xiaotao-wang.github.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  var APP = 'https://xiaotao-wang.github.io/USTC_Helper/';
  if (location.hostname === 'xiaotao-wang.github.io') {
    try { localStorage.setItem('tao-script-ready', JSON.stringify({ v: '3.2.1', t: Date.now() })); } catch (e) {}
    return;
  }
  function dayish(t) { return /(星期|周|礼拜)[一二三四五六日天]/.test(t || ''); }
  function score(tb) {
    var rows = tb.rows; if (!rows || rows.length < 2) return 0;
    var txt = tb.textContent || '';
    if (txt.indexOf('日期时间地点人员') >= 0) return 1000000 + rows.length;
    var head = rows[0], days = 0, cells = 0, i, r;
    for (i = 0; i < head.cells.length; i++) if (dayish(head.cells[i].textContent)) days++;
    for (r = 0; r < rows.length; r++) cells += rows[r].cells.length;
    if (days >= 2) return days * 1000 + cells;
    if (/课程|教师|教室|节次|周次/.test(txt) && cells > 30) return cells;
    return 0;
  }
  function findTables() {
    var all = [].slice.call(document.querySelectorAll('table'));
    try {
      [].slice.call(document.querySelectorAll('iframe')).forEach(function (f) {
        var d = f.contentDocument; if (d) all = all.concat([].slice.call(d.querySelectorAll('table')));
      });
    } catch (e) {}
    return all.map(function (tb) { return { tb: tb, s: score(tb) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; });
  }
  function toast(msg) {
    var d = document.createElement('div'); d.textContent = msg;
    d.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483647;background:#232C4E;color:#F4EEE2;padding:12px 18px;border-radius:12px;font:14px/1.6 system-ui,sans-serif;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:center';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 4200);
  }
  function pageMeta() {
    var meta = {};
    var sels = [].slice.call(document.querySelectorAll('select'));
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i]; if (s.selectedIndex < 0 || !s.options[s.selectedIndex]) continue;
      var t = s.options[s.selectedIndex].textContent.trim();
      if (/\d{4}.*学期|学年|秋季|春季/.test(t)) { meta.semesterName = t; break; }
    }
    var bt = document.body.innerText || '';
    var m = bt.match(/起始日期[:：]\s*(\d{4}-\d{2}-\d{2})/); if (m) meta.startDate = m[1];
    var w = bt.match(/总周数[:：]\s*(\d+)/); if (w) meta.totalWeeks = parseInt(w[1], 10);
    return meta;
  }
  function cleanHTML(h) {
    return h.replace(/\s(?:style|class|width|height|align|valign|bgcolor)="[^"]*"/gi, '').replace(/>\s+</g, '><');
  }
  function b64url(bytes) {
    var s = '', i;
    for (i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')))
      .arrayBuffer().then(function (buf) { return new Uint8Array(buf); }, function () { return null; });
  }
  function download(text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ustc-timetable.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } catch (e) {}
  }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function hasList() {
    return findTables().some(function (x) { return (x.tb.textContent || '').indexOf('日期时间地点人员') >= 0; });
  }
  function findListSwitch() {
    var els = [].slice.call(document.querySelectorAll('a,button,li,span,div'));
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].textContent || '').trim();
      if (t.length <= 6 && /^(列表|列表视图|课表列表|列表模式)$/.test(t) && els[i].offsetParent !== null) return els[i];
    }
    return null;
  }
  function switchRecent() { var t = +ssGet('taoListSwitch') || 0; return Date.now() - t < 60000; }
  function tryListView() {
    if (hasList() || switchRecent()) return false;
    var sw = findListSwitch();
    if (!sw) return false;
    ssSet('taoListSwitch', String(Date.now()));
    sw.click();
    return true;
  }
  function returnNow() {
    if (tryListView()) { toast('已切到列表视图，正在读取课表…'); setTimeout(returnNow, 1800); return; }
    var list = findTables();
    if (!list.length) { alert('未在本页检测到课表表格。\n请先打开「我的课表 / 选课结果 / 课表查询」页面，等表格显示后再点本按钮。'); return; }
    var html = cleanHTML(list.slice(0, 3).map(function (x) { return x.tb.outerHTML; }).join('\n'));
    var p = JSON.stringify({ format: 'tao-ustc-html', title: document.title, url: location.href, html: html, meta: pageMeta() });
    if (!isIOS()) download(p);
    var bytes = new TextEncoder().encode(p);
    deflate(bytes).then(function (dz) {
      var hash = dz ? '#tao=' + b64url(dz) : '#tao64=' + b64url(bytes);
      ssSet('taoAutoRet', String(Date.now()));
      if (hash.length > 60000) {
        download(p);
        toast('课表较大：已下载 ustc-timetable.json。到小桃课表 → 导入 → 上传文件 选它一次即可。');
        setTimeout(function () { location.href = APP + '#taoFile=1'; }, 1500);
        return;
      }
      toast('读取完成，正在跳回小桃课表…');
      setTimeout(function () { location.href = APP + hash; }, 700);
    });
  }
  var lastMut = Date.now();
  function autoTick() {
    var has = findTables().length > 0;
    if (has) {
      if (tryListView()) return;
      var last = +ssGet('taoAutoRet') || 0;
      if (Date.now() - last < 300000) return;
      if (Date.now() - lastMut < 1200) { setTimeout(autoTick, 1300); return; }
      toast('已登录，自动读取课表并回传小桃课表…');
      returnNow();
      return;
    }
    if (location.hostname === 'jw.ustc.edu.cn' && location.pathname.indexOf('/for-std/course-table') !== 0 && !ssGet('taoAutoNav')) {
      ssSet('taoAutoNav', '1');
      location.replace('https://jw.ustc.edu.cn/for-std/course-table');
    }
  }
  function refresh() {
    var b = document.getElementById('tao-export-btn');
    if (!b) return;
    var has = findTables().length > 0;
    var label = has ? '一键回传小桃课表' : '打开我的课表';
    if (b.textContent !== label) b.textContent = label;
    b.onclick = has ? returnNow : function () { location.href = 'https://jw.ustc.edu.cn/for-std/course-table'; };
  }
  function addButton() {
    if (document.getElementById('tao-export-btn') || !document.body) return;
    var b = document.createElement('button'); b.id = 'tao-export-btn';
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#E8930C;color:#1A2140;border:0;border-radius:99px;padding:12px 18px;font:700 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(232,147,12,.5)';
    document.body.appendChild(b); refresh();
  }
  var rt = null;
  function queue() { clearTimeout(rt); rt = setTimeout(function () { refresh(); autoTick(); }, 700); }
  addButton();
  setTimeout(autoTick, 1500);
  if (window.MutationObserver) new MutationObserver(function () { lastMut = Date.now(); addButton(); queue(); }).observe(document.documentElement, { childList: true, subtree: true });
})();