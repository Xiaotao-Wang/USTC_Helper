// ==UserScript==
// @name         USTC 课表导出 → 小桃课表
// @namespace    tao-table
// @version      1.1.0
// @description  在科大教务系统课表页面一键导出课表表格，导入「小桃课表」离线使用。不读取账号密码。
// @match        *://jw.ustc.edu.cn/*
// @match        *://mis.teach.ustc.edu.cn/*
// @match        *://*.ustc.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
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
  function exportNow() {
    var list = findTables();
    if (!list.length) { alert('未在本页检测到课表表格。\n请先打开「我的课表 / 选课结果 / 课表查询」页面，等表格显示后再点本按钮。'); return; }
    var html = list.slice(0, 3).map(function (x) { return x.tb.outerHTML; }).join('\n');
    var payload = JSON.stringify({ format: 'tao-ustc-html', title: document.title, url: location.href, html: html, meta: pageMeta() });
    try {
      var blob = new Blob([payload], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ustc-timetable.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    } catch (e) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(
        function () { toast('已复制课表并下载 ustc-timetable.json。打开「小桃课表」→ 导入 → 粘贴即可。'); },
        function () { toast('已下载 ustc-timetable.json。打开「小桃课表」→ 导入 → 上传文件即可。'); }
      );
    } else { toast('已下载 ustc-timetable.json。打开「小桃课表」→ 导入 → 上传文件即可。'); }
  }
  function addButton() {
    if (document.getElementById('tao-export-btn') || !document.body) return;
    var b = document.createElement('button'); b.id = 'tao-export-btn'; b.textContent = '导出课表 → 小桃';
    b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#E8930C;color:#1A2140;border:0;border-radius:99px;padding:12px 18px;font:700 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(232,147,12,.5)';
    b.onclick = exportNow; document.body.appendChild(b);
  }
  addButton();
  if (window.MutationObserver) new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
})();