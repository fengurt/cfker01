const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>cfker01: cloud status</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root { color-scheme: dark light; --bg:#0e1116; --card:#161b22; --fg:#e6edf3; --muted:#8b949e; --ok:#3fb950; --warn:#d29922; --err:#f85149; --line:#30363d; }
    body{margin:0;font:14px/1.5 -apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--fg)}
    main{max-width:960px;margin:0 auto;padding:24px 16px}
    h1{font-weight:600;font-size:18px;margin:0 0 16px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
    .card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
    .ok{background:var(--ok)} .err{background:var(--err)} .warn{background:var(--warn)}
    .meta{color:var(--muted);font-size:12px;margin-top:4px}
    .row{display:flex;justify-content:space-between;align-items:center}
    .err{color:var(--err)}
    input,button{padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:#0b0f14;color:var(--fg)}
    .toolbar{display:flex;gap:8px;margin-bottom:16px}
    pre{white-space:pre-wrap;background:#0b0f14;border:1px solid var(--line);padding:8px;border-radius:6px;font-size:12px}
  </style>
</head>
<body>
<main>
  <h1>cfker01: cloud status</h1>
  <div class="toolbar">
    <input id="key" type="password" placeholder="X-Api-Key" />
    <button id="save">Save</button>
    <button id="refresh">Refresh</button>
    <span id="status" class="meta"></span>
  </div>
  <div id="grid" class="grid"></div>
</main>
<script>
  const KEY = localStorage.getItem('cfker01_key') || '';
  document.getElementById('key').value = KEY;
  document.getElementById('save').onclick = () => {
    localStorage.setItem('cfker01_key', document.getElementById('key').value.trim());
    load();
  };
  document.getElementById('refresh').onclick = load;

  async function load() {
    const k = document.getElementById('key').value.trim();
    localStorage.setItem('cfker01_key', k);
    const status = document.getElementById('status');
    const grid = document.getElementById('grid');
    if (!k) {
      status.textContent = 'Enter an API key to load status.';
      grid.innerHTML = '';
      return;
    }
    status.textContent = 'Loading...';
    try {
      const r = await fetch('/v1/status', { headers: { 'X-Api-Key': k } });
      if (!r.ok) { status.textContent = 'Error: ' + r.status; return; }
      const body = await r.json();
      render(body);
      status.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      status.textContent = 'Network error';
    }
  }

  function render(body) {
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    for (const item of body.sources || []) {
      const snap = item.snapshot || {};
      const dotCls = snap.ok ? 'ok' : 'err';
      const title = (item.source && item.source.label) || item.source;
      const fetched = item.fetchedAt ? new Date(item.fetchedAt).toLocaleString() : '-';
      const card = document.createElement('div');
      card.className = 'card';
      const preview = JSON.stringify(snap.payload || {}, null, 2).slice(0, 240);
      card.innerHTML =
        '<div class="row"><strong><span class="dot ' + dotCls + '"></span>' + escapeHtml(title) + '</strong>' +
        '<span class="meta">' + escapeHtml(fetched) + '</span></div>' +
        (snap.error ? '<div class="err">' + escapeHtml(String(snap.error)) + '</div>' : '') +
        '<pre>' + escapeHtml(preview) + '</pre>';
      grid.appendChild(card);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  setInterval(load, 60000);
  load();
</script>
</body>
</html>`;

export function handleStatusPage(): Response {
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
