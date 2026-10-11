// ══════════════════════════════════════════
// common.js — index.html 與 sak7@dm.html 共用
// （兩頁原本各寫一份、邏輯相同的部分；改這裡兩頁一起生效）
// ══════════════════════════════════════════
const AUTH_API = 'https://tkskworker.pnyuki159.workers.dev';

// ══════════════════════════════════════════
// AUTH — Google Login
// ══════════════════════════════════════════
function doLogin(isAdmin) {
  window.location.href = AUTH_API + '/auth/login' + (isAdmin ? '?admin=1' : '');
}

// 處理 Google 登入導回的網址 hash，回傳 token（沒有則 null）
//   #token=xxx   → 存進 localStorage（storageKey：前台 'auth_token'、後台 'admin_auth_token'）
//   #login_error → 顯示錯誤訊息
function initToken(storageKey) {
  var hash = location.hash || '';
  if (hash.indexOf('#token=') === 0) {
    localStorage.setItem(storageKey, hash.slice(7));
    history.replaceState(null, '', location.pathname + location.search);
  } else if (hash === '#login_error') {
    document.getElementById('login-error').textContent = 'Google 登入失敗，請重試';
    history.replaceState(null, '', location.pathname + location.search);
    return null;
  }
  return localStorage.getItem(storageKey) || null;
}

// ══════════════════════════════════════════
// WORKER API — 所有對 Worker 的呼叫都走這支
// 自動帶 token、解析 JSON；回傳 { ok, status, data }，連不到伺服器時 status = 0
// ══════════════════════════════════════════
async function callApi(path, token, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
  try {
    var r = await fetch(AUTH_API + path, opts);
    var data = await r.json().catch(function() { return null; });
    return { ok: r.ok, status: r.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

// 把 callApi 失敗的結果轉成看得懂的訊息（Worker 回的 error / GitHub 狀態碼）
function apiErrorText(res) {
  if (!res.status) return '連不到伺服器';
  var d = res.data || {};
  var msg = 'HTTP ' + res.status + (d.error ? ' ' + d.error : '');
  if (d.status) msg += '（GitHub ' + d.status + (d.status === 401 ? '，token 可能過期' : '') + '）';
  return msg;
}

// ══════════════════════════════════════════
// UI
// ══════════════════════════════════════════
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  window.scrollTo(0, 0);
}
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), type === 'error' ? 5000 : 2200);   // 錯誤訊息較長，多留一點時間
}

// ══════════════════════════════════════════
// 圖片來源
// data.json 存的是 GitHub raw 網址（Worker 靠它對照 repo 檔案加 ?v= 版本號，所以資料不動），
// 顯示時才把 org/ 底下的圖換成本站（Cloudflare Pages）的網址：Pages 組建時會把 org/ 一起發布，
// 走 Cloudflare 節點，而且跟網頁同網域，可以共用同一條連線
// 其他路徑（例如後台上傳的 uploads/）Pages 沒發布，維持 raw
// 想退回全部走 GitHub raw：把 IMG_BASE 改成 RAW_ORG
// ══════════════════════════════════════════
const RAW_ORG  = 'https://raw.githubusercontent.com/septusg/t-ki/cmc/org/';
const IMG_BASE = '/org/';
function imgUrl(u) {
  return u && u.indexOf(RAW_ORG) === 0 ? IMG_BASE + u.slice(RAW_ORG.length) : u;
}

// 沒封面時的佔位字：取標題第一個文字（跳過 🔞、《 這類符號；Array.from 避免把 emoji 切成半個）
function firstChar(title) {
  return Array.from((title || '').replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '?';
}

// ══════════════════════════════════════════
// 爆雷標記 ||xxx|| 與圖片行判斷
// ══════════════════════════════════════════
// 回傳 { url: 去掉 || 後的內容, spoiler: 是否爆雷 }
function splitSpoiler(s) {
  var t = (s || '').trim();
  var m = /^\|\|(.*)\|\|$/.exec(t);
  return m ? { url: m[1], spoiler: true } : { url: t, spoiler: false };
}

// 判斷一行是不是圖片：整行（可包 ||）以 http(s):// 開頭就是圖片，網址允許含空白（例如 pg (1).jpg）
// parseMd 顯示、savePost 收集圖片都用這一條規則，兩邊才不會認定不同
// 回傳 { url, spoiler } 或 null
function mdImageLine(line) {
  var sp = splitSpoiler(line);
  return /^https?:\/\//i.test(sp.url) ? sp : null;
}

// ══════════════════════════════════════════
// MARKDOWN PARSER（前台閱讀、後台預覽共用）
// deferImg = true：圖片輸出成 data-src，由呼叫端依序載入（前台用）
// ══════════════════════════════════════════
function parseMd(text, deferImg) {
  if (!text) return '';
  var lines = text.split('\n');
  var html = '';
  var inCode = false;
  var codeBuf = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // code block fence
    if (/^```/.test(line.trim())) {
      if (!inCode) {
        inCode = true;
        codeBuf = '';
      } else {
        html += '<pre><code>' + esc(codeBuf) + '</code></pre>';
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeBuf += (codeBuf ? '\n' : '') + line;
      continue;
    }

    var t = line.trim();

    // empty line
    if (!t) { continue; }

    // horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(t)) { html += '<hr>'; continue; }

    // image line: URL / ||URL||（爆雷圖片，點擊才顯示）
    var img = mdImageLine(t);
    if (img) {
      var tag = '<img ' + (deferImg ? 'data-src' : 'src') + '="' + esc(imgUrl(img.url)) + '">';
      html += img.spoiler
        ? '<div class="spoiler-img" onclick="this.classList.toggle(\'revealed\')">' + tag + '<div class="spoiler-cover">點擊顯示</div></div>'
        : '<div class="post-block-img">' + tag + '</div>';
      continue;
    }

    // unordered list
    if (/^[-*] /.test(t)) { html += '<ul><li>' + inlineMd(t.replace(/^[-*] /, '')) + '</li></ul>'; continue; }

    // ordered list
    if (/^\d+\. /.test(t)) { html += '<ol><li>' + inlineMd(t.replace(/^\d+\. /, '')) + '</li></ol>'; continue; }

    // headers
    if (/^### /.test(t)) { html += '<h3>' + inlineMd(t.slice(4)) + '</h3>'; continue; }
    if (/^## /.test(t))  { html += '<h2>' + inlineMd(t.slice(3)) + '</h2>'; continue; }
    if (/^# /.test(t))   { html += '<h1>' + inlineMd(t.slice(2)) + '</h1>'; continue; }

    // paragraph
    html += '<p>' + inlineMd(t) + '</p>';
  }

  if (inCode) { html += '<pre><code>' + esc(codeBuf) + '</code></pre>'; }

  // merge consecutive <ul>/<ol> tags
  html = html.replace(/<\/ul><ul>/g, '');
  html = html.replace(/<\/ol><ol>/g, '');

  return html;
}

function inlineMd(text) {
  var s = esc(text);
  // inline code (handle first to protect contents)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic *text*
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // strikethrough ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // spoiler text ||text||
  s = s.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler-text" onclick="this.classList.toggle(\'revealed\')">$1</span>');
  return s;
}
