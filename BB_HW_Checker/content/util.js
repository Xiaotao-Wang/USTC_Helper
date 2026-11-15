// 经典脚本（内容脚本共享作用域），无 import/export
function bbParseDate(text) {
  if (!text) return null;
  let s = String(text).replace(/\u00a0/g, ' ').trim();
  if (!s) return null;
  let hourOffset = 0;
  const periodMatch = s.match(/(凌晨|早上|上午|中午|下午|晚上|晚间|夜里|AM|PM|am|pm)/);
  if (periodMatch) {
    const p = periodMatch[1];
    if (/下午|晚上|晚间|夜里|PM|pm|中午/.test(p)) hourOffset = 12; else hourOffset = 0;
  }
  let year = null, month = null, day = null, hour = 0, minute = 0, second = 0;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) { year = +m[1]; month = +m[2]; day = +m[3]; }
  else {
    m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) { year = +m[1]; month = +m[2]; day = +m[3]; }
  }
  if (year == null) {
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { month = +m[1]; day = +m[2]; year = +m[3]; if (year < 100) year += 2000; }
  }
  if (year == null) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && months[m[1].slice(0,3).toLowerCase()]) { month = months[m[1].slice(0,3).toLowerCase()]; day = +m[2]; year = +m[3]; }
    else {
      m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
      if (m && months[m[2].slice(0,3).toLowerCase()]) { day = +m[1]; month = months[m[2].slice(0,3).toLowerCase()]; year = +m[3]; }
    }
  }
  if (year == null || month == null || day == null) return null;
  const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (tm) {
    hour = +tm[1]; minute = +tm[2]; second = tm[3] ? +tm[3] : 0;
    if (hourOffset === 12 && hour < 12) hour += 12;
    if (hourOffset === 0 && /凌晨/.test(s) && hour === 12) hour = 0;
  } else {
    const hm = s.match(/(上午|下午|晚上|凌晨|中午)?\s*(\d{1,2})\s*[点时]/);
    if (hm) { hour = +hm[2]; if (/下午|晚上|中午/.test(hm[1] || '') && hour < 12) hour += 12; }
    else if (periodMatch) { hour = hourOffset === 12 ? 23 : 8; minute = hourOffset === 12 ? 59 : 0; }
    else { hour = 23; minute = 59; }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const d = new Date(year, month - 1, day, hour, minute, second);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function bbFmtDateTime(ts) {
  if (!ts) return '无截止日期';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function bbHumanDelta(ts, now = Date.now()) {
  if (!ts) return '';
  let diff = ts - now; const overdue = diff < 0; diff = Math.abs(diff);
  const min = Math.floor(diff / 60000);
  const days = Math.floor(min / 1440), hours = Math.floor((min % 1440) / 60), mins = min % 60;
  const core = days > 0 ? `${days}天${hours}小时` : (hours > 0 ? `${hours}小时${mins}分` : `${mins}分钟`);
  return overdue ? `已逾期 ${core}` : `剩 ${core}`;
}

function bbDueStatus(ts, now = Date.now(), soonHours = 24) {
  if (!ts) return 'nodue';
  if (ts < now) return 'overdue';
  if (ts - now <= soonHours * 3600 * 1000) return 'soon';
  return 'normal';
}