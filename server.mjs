// 小红书笔记发布前体检 —— Pay Skill 后端（Node http 入口）
// 零依赖：Node 18+ 直接 `node server.mjs`，无需 npm install。
// 业务逻辑见 app.mjs（与 Netlify Function 共用同一 handler）。

import http from 'node:http';
import { createApp } from './app.mjs';
import { createBilling } from './billing/index.mjs';

const handler = createApp();
const billing = createBilling();
const PORT = Number(process.env.PORT || 8787);

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const body = await readBody(req);
    const request = new Request(`http://${host}${req.url}`, {
      method: req.method,
      headers: new Headers(req.headers),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal Error', message: e.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[xhs-clinic] listening on :${PORT} | billing=${billing.mode} | price=¥${(billing.priceFen / 100).toFixed(2)}`);
});
