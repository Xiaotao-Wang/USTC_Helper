// 经典脚本（内容脚本共享作用域），无 import/export。
// 依赖同作用域的 bbParseDate / bbFmtDateTime（来自 content/util.js）。
// 已针对中科大 BB (Blackboard Learn 9.1) 真实页面校准。

// ---------- 通用工具 ----------
function bbText(el) {
  if (!el) return '';
  return (el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function bbStripDates(s) {
  return String(s || '')
    .replace(/\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g, ' ')
    .replace(/\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    .replace(/[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}/g, ' ')
    .replace(/\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}/g, ' ');
}

// 课程名缩短："CS2502A.01.2026FA: 数据结构A" → "数据结构A"
function bbShortCourseName(name) {
  var m = (name || '').match(/^[A-Z0-9.]+\s*[:：]\s*(.+)/i);
  return m ? m[1].trim() : (name || '').trim();
}

// ---------- 课程列表解析 ----------
var BB_COURSE_SKIP = /^(帮助课程|课程目录|更多|返回|登录|logout|我的成绩|课程|管理|折叠|收起)$/;

// 从门户页解析所有课程（去重）。
function bbParseCourses(html) {
  var doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch (e) { return []; }
  return bbExtractCoursesFromDoc(doc);
}

function bbExtractCoursesFromDoc(doc) {
  var out = [], seen = {};
  var anchors = doc.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var href = a.getAttribute('href') || '';
    var id = null;
    var m = href.match(/course_id=(_\d+_1)/i);
    if (m) id = m[1];
    if (!id) {
      m = href.match(/[?&]id=(_\d+_1)/i);
      if (m && /type=Course/i.test(href)) id = m[1];
    }
    if (!id || seen[id]) continue;
    var name = bbText(a) || (a.getAttribute('title') || '').trim();
    if (!name && a.parentElement) name = bbText(a.parentElement);
    name = (name || '').trim();
    if (!name || BB_COURSE_SKIP.test(name)) continue;
    seen[id] = true;
    out.push({ id: id, name: bbShortCourseName(name) });
  }
  return out;
}

// 优先解析「当前学期课程」模块（减少请求量）；找不到则回退全部。
function bbParseCurrentCourses(html) {
  var doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch (e) { return []; }
  var headings = doc.querySelectorAll('h2');
  var target = null;
  for (var i = 0; i < headings.length; i++) {
    if (/当前学期课程/.test(bbText(headings[i]))) { target = headings[i]; break; }
  }
  if (!target) return bbExtractCoursesFromDoc(doc);
  var portlet = target.closest('.portlet') || target.parentElement;
  if (!portlet) return bbExtractCoursesFromDoc(doc);
  var anchors = portlet.querySelectorAll('a[href]');
  var out = [], seen = {};
  for (var j = 0; j < anchors.length; j++) {
    var a = anchors[j];
    var href = a.getAttribute('href') || '';
    var m = href.match(/[?&]id=(_\d+_1)/i);
    if (!m || !/type=Course/i.test(href)) continue;
    var id = m[1];
    if (seen[id]) continue;
    var name = bbText(a) || (a.getAttribute('title') || '').trim();
    if (!name || BB_COURSE_SKIP.test(name)) continue;
    seen[id] = true;
    out.push({ id: id, name: bbShortCourseName(name) });
  }
  return out.length ? out : bbExtractCoursesFromDoc(doc);
}

// ---------- 成绩/作业页解析（真实校准版） ----------
// 真实结构：div.sortable_item_row[duedate] > .cell.gradable > a[onclick] / text
//           + .itemCat（类型）+ .cell.activity .activityType（状态）+ .cell.grade .grade（分数）
// 行类名：graded_item_row / submitted_item_row / upcoming_item_row / calculatedRow

var BB_TEST_CAT = /测试|测验|考试|quiz|test|exam|问卷|survey/i;
var BB_ASSIGN_CAT = /作业|assignment|实验|报告|论文|大作业|homework|project|lab/i;
var BB_MAX_LONG = '9223372036854775807';

function bbParseGradeItems(html, course) {
  var doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch (e) { return []; }
  var courseId = (course && course.id) || '';
  var courseName = (course && course.name) || '';

  // 优先使用真实校准的 row-based 解析
  var rows = doc.querySelectorAll('.sortable_item_row');
  if (rows.length) return bbParseGradeRows(rows, courseId, courseName);

  // 兜底：旧版 anchor-based（兼容其他 BB 布局）
  return bbParseGradeItemsFallback(doc, courseId, courseName);
}

function bbParseGradeRows(rows, courseId, courseName) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var cls = row.className || '';
    if (/calculatedRow/i.test(cls)) continue; // 跳过汇总行

    // 类型
    var catEl = row.querySelector('.itemCat');
    var cat = catEl ? bbText(catEl) : '';
    if (cat && BB_TEST_CAT.test(cat)) continue; // 排除测试
    var type = 'assignment';
    if (cat && !BB_ASSIGN_CAT.test(cat)) type = 'other';

    // 名称 + 链接
    var name = '', href = '';
    var nameEl = row.querySelector('.cell.gradable a');
    if (nameEl) {
      name = bbText(nameEl);
      var onclick = nameEl.getAttribute('onclick') || '';
      var m = onclick.match(/loadContentFrame\(\s*'([^']+)'\s*\)/);
      if (m) href = m[1];
    } else {
      var gradable = row.querySelector('.cell.gradable');
      if (gradable) {
        var clone = gradable.cloneNode(true);
        var kids = clone.querySelectorAll('*');
        for (var j = 0; j < kids.length; j++) kids[j].parentNode.removeChild(kids[j]);
        name = bbText(clone);
      }
    }
    if (!name || name.length < 2) continue;
    if (/^(加权总计|总计|Total|Weighted Total)$/i.test(name)) continue;

    // 截止日期：优先 duedate 属性（ms 时间戳）；属性明确为 0/max-long 时即「无截止」，不再回退文本
    var dueTs = null, dueText = '';
    var dueAttr = row.getAttribute('duedate');
    var attrSaysNoDue = false;
    if (dueAttr != null && dueAttr !== '') {
      if (dueAttr === '0' || dueAttr === BB_MAX_LONG) attrSaysNoDue = true;
      else {
        var ts = parseInt(dueAttr, 10);
        if (!isNaN(ts) && ts > 0 && ts < 9000000000000) dueTs = ts;
      }
    }
    if (dueTs != null) {
      dueText = bbFmtDateTime(dueTs);
    } else if (!attrSaysNoDue) {
      // 兜底：文本日期（仅在属性缺失/不可解析时）
      var dueEl = row.querySelector('.cell.gradable .activityType');
      if (dueEl) {
        var dt = bbText(dueEl);
        var dm = dt.match(/到期日期[：:]\s*(.+)/);
        if (dm) { dueText = dm[1].trim(); dueTs = bbParseDate(dueText); }
        else { dueTs = bbParseDate(dt); if (dueTs) dueText = dt; }
      }
    }

    // 完成状态：行类名为主（细分 graded / submitted / upcoming）
    var completed = null;
    var status = 'unknown';
    if (/graded_item_row/i.test(cls)) { completed = true; status = 'graded'; }
    else if (/submitted_item_row/i.test(cls)) { completed = true; status = 'submitted'; }
    else if (/upcoming_item_row/i.test(cls)) { completed = false; status = 'upcoming'; }
    else {
      var actEl = row.querySelector('.cell.activity .activityType');
      var actText = actEl ? bbText(actEl) : '';
      if (/已评分|graded/i.test(actText)) { completed = true; status = 'graded'; }
      else if (/已提交|submitted/i.test(actText)) { completed = true; status = 'submitted'; }
      else if (/尚未评分|未提交|进行中|not submitted|in progress/i.test(actText)) { completed = false; status = 'upcoming'; }
    }

    // 活动时间戳（评分时间 / 提交时间）
    var activityTs = null;
    var laAttr = row.getAttribute('lastactivity') || '';
    if (laAttr && laAttr !== '0') {
      var la = parseInt(laAttr, 10);
      if (!isNaN(la) && la > 0 && la < 9000000000000) activityTs = la;
    }
    if (activityTs == null) {
      var laEl = row.querySelector('.lastActivityDate');
      if (laEl) activityTs = bbParseDate(bbText(laEl));
    }

    // 成绩文本
    var gradeText = '';
    var gradeSpan = row.querySelector('.cell.grade .grade');
    var pointsSpan = row.querySelector('.cell.grade .pointsPossible');
    if (gradeSpan) {
      gradeText = bbText(gradeSpan);
      if (pointsSpan) gradeText += bbText(pointsSpan);
    }

    out.push({
      courseId: courseId,
      courseName: courseName,
      name: name,
      href: href,
      type: type,
      dueTs: dueTs,
      dueText: dueText,
      completed: completed,
      status: status,
      activityTs: activityTs,
      gradeText: gradeText,
      raw: bbText(row).slice(0, 200)
    });
  }
  return out;
}

// 兜底解析（anchor-based，兼容非 USTC 布局）
var BB_ASSIGNMENT_HREF = /assignment|uploadAssignment|bb-assignment|execute\/assignment/i;
var BB_TEST_HREF = /assessment|execute\/test|takeAssessment|survey|bb-assessment/i;
var BB_NOT_SUBMITTED_RE = /未提交|尚未提交|未开始|无提交|未作答|not submitted|no submission|未交/i;
var BB_SUBMITTED_RE = /已提交|已评分|已批改|已完成|待评分|待批改|需要评分|submitted|graded|needs grading|completed/i;
var BB_GRADE_RE = /(\d+(?:\.\d+)?)\s*(?:分|\/|points?|pts?)/i;
var BB_GRADE_ONLY = /^[\d.,\s]+(?:分|\/\s*[\d.]+|points?|pts?|%)?$/i;
var BB_STATUS_ONLY = /^(未提交|尚未提交|未开始|无提交|未作答|未交|已提交|已评分|已批改|已完成|待评分|待批改|需要评分|not submitted|no submission|submitted|graded|needs grading|completed|--|—|n\/a|无)$/i;
var BB_HEADER_ONLY = /^(名称|标题|状态|成绩|分数|得分|截止日期|截止时间|提交日期|评分|操作|查看|更多|排序|项目|活动|名称\/状态)$/i;

function bbParseGradeItemsFallback(doc, courseId, courseName) {
  var out = [], seen = {};
  var anchors = doc.querySelectorAll('a[href]');
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var name = bbText(a) || (a.getAttribute('title') || '').trim();
    if (!name || name.length < 2) continue;
    if (BB_COURSE_SKIP.test(name) || BB_GRADE_ONLY.test(name) || BB_STATUS_ONLY.test(name) || BB_HEADER_ONLY.test(name)) continue;
    var href = a.getAttribute('href') || '';
    var container = a.closest('tr') || a.closest('li') ||
      a.closest('[class*="item"]') || a.closest('[class*="row"]') ||
      a.closest('[class*="grade"]') || a.parentElement;
    var raw = bbText(container);
    var key = courseId + '|' + name;
    if (seen[key]) continue;
    seen[key] = true;
    var type = 'other';
    if (BB_ASSIGNMENT_HREF.test(href)) type = 'assignment';
    else if (BB_TEST_HREF.test(href)) continue;
    else if (BB_TEST_CAT.test(name)) continue;
    else if (BB_ASSIGN_CAT.test(name)) type = 'assignment';
    var gradeCell = container.querySelector('td.grade,th.grade,.grade,[class*="grade"]:not(table):not([class*="gradeTable"])');
    var gradeTxt = gradeCell ? bbText(gradeCell) : '';
    var hasScore = /\d/.test(bbStripDates(gradeTxt)) || !!bbStripDates(raw).match(BB_GRADE_RE);
    var completed = null;
    if (BB_NOT_SUBMITTED_RE.test(raw)) completed = false;
    else if (BB_SUBMITTED_RE.test(raw) || hasScore) completed = true;
    var status = 'unknown';
    if (completed === false) status = 'upcoming';
    else if (completed === true) {
      status = (hasScore || /已评分|已批改|graded/i.test(raw)) ? 'graded' : 'submitted';
    }
    var activityTs = null;
    var actEl = container.querySelector('.lastActivityDate,[class*="activityDate"],[class*="submitDate"],[class*="lastActivity"]');
    if (actEl) activityTs = bbParseDate(bbText(actEl));
    if (activityTs == null) {
      var am = raw.match(/(提交日期|提交时间|最后活动|评分日期|评分时间|Last Activity|Submitted)[：:\s]*([^|]{4,40})/i);
      if (am) activityTs = bbParseDate(am[2]);
    }
    var dueTs = null, dueText = '';
    var dueEl = container.querySelector('[class*="due"],[class*="date"],[class*="deadline"]');
    if (dueEl) { dueText = bbText(dueEl); dueTs = bbParseDate(dueText); }
    if (dueTs == null) {
      var lm = raw.match(/(截止日期|截止时间|截止|到期|Due|Deadline)[：:\s]*([^|]{4,40})/i);
      if (lm) { dueText = lm[2].trim(); dueTs = bbParseDate(dueText); }
    }
    if (dueTs == null) { dueTs = bbParseDate(raw); if (dueTs != null) dueText = raw; }
    out.push({ courseId: courseId, courseName: courseName, name: name, href: href, type: type, dueTs: dueTs, dueText: dueText, completed: completed, status: status, activityTs: activityTs, gradeText: hasScore ? gradeTxt : '', raw: raw });
  }
  return out;
}

// ---------- 登录检测 ----------
function bbLooksLikeLogin(html, finalUrl) {
  if (finalUrl && /\/webapps\/login|id\.ustc\.edu\.cn|passport\.ustc\.edu\.cn|cas\/login/i.test(finalUrl)) return true;
  var head = (html || '').slice(0, 6000);
  return /统一身份认证登录/.test(head) && /name="username"|id="normalLoginForm"|id="login"/.test(head);
}

// ---------- 诊断摘要 ----------
function bbSummarize(html) {
  var doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch (e) { return { error: String(e) }; }
  var bodyText = bbText(doc.body).slice(0, 2000);
  var rows = doc.querySelectorAll('.sortable_item_row');
  var rowSample = [];
  for (var i = 0; i < rows.length && i < 5; i++) {
    rowSample.push({ cls: rows[i].className, duedate: rows[i].getAttribute('duedate'), text: bbText(rows[i]).slice(0, 120) });
  }
  var links = [];
  var anchors = doc.querySelectorAll('a[href]');
  for (var j = 0; j < anchors.length && links.length < 40; j++) {
    links.push({ text: bbText(anchors[j]).slice(0, 60), href: anchors[j].getAttribute('href') });
  }
  return { title: doc.title || '', tables: doc.querySelectorAll('table').length, gradeRows: rows.length, rowSample: rowSample, links: links, bodyText: bodyText };
}