function blockPageHtml(title, message) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background:#f5f5f7; color:#1d1d1f;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { text-align:center; max-width:420px; padding:32px; }
  h1 { font-size:24px; font-weight:600; margin:0 0 8px; }
  p { font-size:15px; color:#7a7a7a; margin:0; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

module.exports = { blockPageHtml };
