// 小红书笔记发布前体检 —— 与运行时无关的请求处理核心（Web Fetch API 风格）
// server.mjs（Node http）与 Netlify Function 共用这一个 handler。
//
// 402 流程（支付宝 AI 按量付费协议）：
//   ① 请求无 Payment-Proof 头
//        → 生成账单 + 落库 PENDING → 402 + Payment-Needed 头（Base64URL 账单）
//   ② Agent 引导用户支付后，携 Payment-Proof（+ X-Out-Trade-No）重试
//        → verify 验付（active / out_trade_no / resource_id / amount / trade_no 防重复履约）
//        → 验付失败 → 重新出账单 402
//        → 验付成功 → markPaid → 生成报告 → markFulfilled → 异步履约回执 → 200 报告
//   ③ 幂等保障：
//        - 同内容 10 分钟内已完成 → 直接返回，不重复扣费
//        - 订单已 FULFILLED 再请求 → 返回已存报告
//        - 同一 trade_no 只履约一次

import { createBilling } from './billing/index.mjs';
import { OrderStore, hashRequest, newResourceId } from './order-store.mjs';
import { buildReport, TRACKS } from './engines/report.mjs';

export function createApp() {
  const billing = createBilling();
  const store = new OrderStore(process.env.ORDERS_FILE || './data/orders.json');

  function jsonResponse(status, obj, headers = {}) {
    return new Response(JSON.stringify(obj, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        ...headers,
      },
    });
  }

  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  // 从重试请求定位订单：优先 X-Out-Trade-No 头；否则尝试从 proof 解出（mock）；最后兜底最近未完成订单
  function resolveOutTradeNo(proofHeader, fromHeader) {
    if (fromHeader) return fromHeader;
    try {
      const proof = JSON.parse(Buffer.from(proofHeader, 'base64url').toString('utf8'));
      const m = /^MOCKPAY_(.+)$/.exec(proof?.protocol?.payment_proof || '');
      if (m) return m[1];
    } catch { /* ignore */ }
    return store.findLatestUnfinished();
  }

  function issue402(input) {
    const { title, content, track, cover_text } = input;
    const resourceId = newResourceId();
    const { bill, outTradeNo } = billing.createBill(resourceId);
    store.create({ outTradeNo, resourceId, amount: bill.protocol.amount, requestHash: hashRequest({ title, content, track, cover_text }) });
    const instructions = billing.mode === 'mock'
      ? `沙箱模式：无需真实支付。以 {"protocol":{"payment_proof":"MOCKPAY_${outTradeNo}","trade_no":"MOCKTRADE_${outTradeNo}"},"method":{"client_session":"sandbox"}} 做 Base64URL 编码，作为 Payment-Proof 头、X-Out-Trade-No: ${outTradeNo} 头重试本请求。`
      : '请通过支付宝 AI 付完成支付（读取 Payment-Needed 头中的账单），支付成功后携带 Payment-Proof 头与 X-Out-Trade-No 头重试本请求。';
    return jsonResponse(402, {
      error: 'Payment Needed',
      message: `请先支付 ${bill.protocol.amount} CNY 获取小红书笔记发布前体检报告`,
      out_trade_no: outTradeNo,
      resource_id: resourceId,
      amount: bill.protocol.amount,
      currency: bill.protocol.currency,
      pay_before: bill.protocol.pay_before,
      instructions,
      billing_mode: billing.mode,
    }, { 'Payment-Needed': b64url(bill) });
  }

  // 输入：Web Request；输出：Web Response
  return async function handler(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS 预检（便于浏览器联调；Skill 脚本为 Node fetch，无需 CORS）
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Payment-Proof, X-Out-Trade-No',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      });
    }

    // 健康检查（部署探活 / SkillPay 注册校验）
    if (method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, {
        ok: true,
        service: billing.serviceName,
        billing_mode: billing.mode,
        price: `¥${(billing.priceFen / 100).toFixed(2)}`,
        orders: store.stats(),
      });
    }

    // 服务元信息（免费 probe：让 Agent 在付费前了解服务能力与价格）
    if (method === 'GET' && url.pathname === '/api/xhs/clinic/meta') {
      return jsonResponse(200, {
        service: billing.serviceName,
        price_per_check: `¥${(billing.priceFen / 100).toFixed(2)}`,
        billing_mode: billing.mode,
        endpoint: 'POST /api/xhs/clinic',
        input_schema: {
          title: 'string 必填，笔记标题（建议 ≤20 字）',
          content: 'string 必填，笔记正文',
          track: 'string 可选，赛道：' + TRACKS.join('/'),
          cover_text: 'string 可选，封面上的文字',
        },
        output: '标题五维评分（100分制）/ 正文8项快检 / 合规红线扫描 / 封面策略 / CES互动分预估 / 发布时间建议 / 修复优先级简报',
        payment_flow: '首次请求返回 402 + Payment-Needed 账单；支付后携 Payment-Proof 重试获得报告',
      });
    }

    // 核心付费端点
    if (method === 'POST' && url.pathname === '/api/xhs/clinic') {
      const raw = await request.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch { return jsonResponse(400, { error: 'Bad Request', message: '请求体必须是 JSON' }); }

      const { title, content, track = '其他', cover_text = '' } = payload || {};
      if (typeof title !== 'string' || !title.trim()) return jsonResponse(400, { error: 'Bad Request', message: '缺少 title（笔记标题，必填）' });
      if (typeof content !== 'string' || !content.trim()) return jsonResponse(400, { error: 'Bad Request', message: '缺少 content（笔记正文，必填）' });
      if (title.length > 100) return jsonResponse(400, { error: 'Bad Request', message: 'title 过长（>100 字）' });
      if (content.length > 20000) return jsonResponse(400, { error: 'Bad Request', message: 'content 过长（>20000 字）' });
      if (!TRACKS.includes(track)) return jsonResponse(400, { error: 'Bad Request', message: `track 无效，可选值：${TRACKS.join('/')}` });

      // 幂等：同内容 10 分钟内已出报告 → 免费直接返回
      const reqHash = hashRequest({ title, content, track, cover_text });
      const cached = store.findFulfilledByHash(reqHash);
      if (cached) return jsonResponse(200, { ...cached.report, cached: true, out_trade_no: cached.outTradeNo });

      const proofHeader = request.headers.get('payment-proof');
      const orderHeader = request.headers.get('x-out-trade-no');

      // ① 无凭证 → 出账单 402
      if (!proofHeader) return issue402({ title, content, track, cover_text });

      // ② 有凭证 → 定位订单并验付
      const outTradeNo = resolveOutTradeNo(proofHeader, orderHeader);
      const order = outTradeNo && store.get(outTradeNo);
      if (!order) return issue402({ title, content, track, cover_text }); // 订单不存在/已过期 → 重新出账单

      // 已履约 → 幂等返回
      if (order.status === 'FULFILLED') return jsonResponse(200, { ...order.report, cached: true, out_trade_no: outTradeNo });

      const verifyRes = await billing.verify({
        paymentProofHeader: proofHeader,
        expectOutTradeNo: outTradeNo,
        expectResourceId: order.resourceId,
        expectAmount: order.amount,
      });
      if (!verifyRes.ok) return issue402({ title, content, track, cover_text }); // 验付失败 → 重新出账单

      // 防重复履约：同一支付宝 trade_no 只交付一次
      const dup = store.findByTradeNo(verifyRes.tradeNo);
      if (dup && dup.outTradeNo !== outTradeNo) return issue402({ title, content, track, cover_text });

      await store.markPaid(outTradeNo, verifyRes.tradeNo);
      const report = buildReport({ title, content, track, cover_text });
      await store.markFulfilled(outTradeNo, report);

      // 异步履约回执（失败不影响交付，可重试）
      billing.fulfill({ tradeNo: verifyRes.tradeNo }).catch(e => console.error('[fulfill]', e.message));

      return jsonResponse(200, { ...report, out_trade_no: outTradeNo });
    }

    return jsonResponse(404, { error: 'Not Found', message: '可用端点：GET /health、GET /api/xhs/clinic/meta、POST /api/xhs/clinic' });
  };
}
