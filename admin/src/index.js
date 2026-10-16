// admin.withchris.uk — private, behind Cloudflare Access (set up in the dashboard).
// Nothing secret here yet; Access is what keeps everyone but Chris out.

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Admin</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
           font: 600 2.5rem system-ui, sans-serif; background: #fafaf7; color: #1a1a1a; }
    @media (prefers-color-scheme: dark) { body { background: #151515; color: #eee; } }
  </style>
</head>
<body>Hi Chris 👋</body>
</html>`;

export default {
  async fetch() {
    return new Response(page, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  },
};
