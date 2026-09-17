// Netlify Functions v2 入口：所有请求经 netlify.toml 的 200 rewrite 进入本函数。
// 与 Node 直跑（server.mjs）共用 app.mjs，行为保持一致。
// 注意：Netlify 函数实例文件系统只读，可写目录为 /tmp，订单文件通过
// 环境变量 ORDERS_FILE=/tmp/xhs-orders.json 指向（幂等在单个暖实例内有效）。

import { createApp } from '../../app.mjs';

const handler = createApp();

export default async (request, context) => {
  try {
    return await handler(request);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Internal Error', message: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
};

export const config = {
  path: '/*',
};
