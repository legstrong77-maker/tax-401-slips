// 401 繳款書中繼站：財政部 etax 不接受跨網域呼叫，GitHub Pages 網頁透過這裡轉送。
// 只轉送 etax 繳款書頁面本來就會呼叫的 4 個 API，也只接受白名單網域來的請求。

const ETAX = 'https://www.etax.nat.gov.tw/etwmain/api/functions/etw144w/';
const ALLOWED = [/^https:\/\/legstrong77-maker\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const UPSTREAM_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-TW,zh;q=0.9',
  origin: 'https://www.etax.nat.gov.tw',
  referer: 'https://www.etax.nat.gov.tw/etwmain/etw144w/401',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
};

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

async function forward(path, init, cors) {
  const resp = await fetch(ETAX + path, init);
  return new Response(resp.body, {
    status: resp.status,
    headers: { ...cors, 'content-type': resp.headers.get('content-type') || 'application/octet-stream' }
  });
}

export default {
  async fetch(req) {
    const origin = req.headers.get('origin') || '';
    if (!ALLOWED.some((re) => re.test(origin))) return new Response('forbidden', { status: 403 });
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const bad = (msg) => new Response(msg, { status: 400, headers: cors });

    if (req.method === 'GET' && url.pathname === '/info') {
      const ban = url.searchParams.get('ban') || '';
      if (!/^\d{8}$/.test(ban)) return bad('統編要 8 碼數字');
      return forward('ETW144GetPulicInfo?ban=' + ban, { headers: UPSTREAM_HEADERS }, cors);
    }
    if (req.method === 'GET' && url.pathname === '/hsn') {
      return forward('ETW144GetHsn', { headers: UPSTREAM_HEADERS }, cors);
    }
    if (req.method === 'GET' && url.pathname === '/dst') {
      const hsn = url.searchParams.get('hsn') || '';
      if (!/^[A-Z]$/.test(hsn)) return bad('縣市代碼不對');
      return forward('ETW144GetDst?hsnCd=' + hsn, { headers: UPSTREAM_HEADERS }, cors);
    }
    if (req.method === 'POST' && url.pathname === '/401') {
      let body;
      try {
        body = await req.json();
      } catch {
        return bad('body 不是 JSON');
      }
      if (!String(body.payTypeName || '').startsWith('401') || !/^\d{8}$/.test(body.uniformCode || '')) {
        return bad('只支援 401 繳款書');
      }
      return forward('401', {
        method: 'POST',
        headers: { ...UPSTREAM_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }, cors);
    }
    return new Response('not found', { status: 404, headers: cors });
  }
};
