// 计费层：支付宝 AI 按量付费（402 协议）
// 协议流程：
//   1) 请求无 Payment-Proof 头 → 402 + Payment-Needed 头（Base64URL 账单，含 RSA2 商家签名）
//   2) 买家 Agent 支付后携 Payment-Proof 重试 → 服务端调 alipay.aipay.agent.payment.verify 验付
//   3) 验付通过 → 返回资源，异步调 alipay.aipay.agent.fulfillment.confirm 履约回执
// BILLING_MODE=mock 时启用本地沙箱（不产生真实扣款），用于联调与自测。

import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

export function createBilling(env = process.env) {
  const mode = env.BILLING_MODE || 'mock';
  if (mode === 'alipay') return createAlipayBilling(env);
  return createMockBilling(env);
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function parseB64url(s) {
  try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; }
}

// ---------- 沙箱 Mock：完整走 402 流程，但不接真钱 ----------
function createMockBilling(env) {
  const priceFen = Number(env.PRICE_FEN || 1); // 沙箱默认 0.01 元
  return {
    mode: 'mock',
    priceFen,
    serviceName: '小红书笔记发布前体检（沙箱）',
    // 生成 402 账单
    createBill(resourceId) {
      const outTradeNo = `MOCK_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const bill = {
        protocol: {
          out_trade_no: outTradeNo,
          amount: (priceFen / 100).toFixed(2),
          currency: 'CNY',
          resource_id: resourceId,
          pay_before: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          seller_signature: 'MOCK_SANDBOX_SIGNATURE',
          seller_sign_type: 'RSA2',
          seller_unique_id: 'mock_seller_2088',
        },
        method: {
          seller_name: '沙箱商家',
          seller_id: 'mock_seller_2088',
          seller_app_id: 'mock_app',
          goods_name: '小红书笔记发布前体检',
          seller_unique_id_key: 'seller_id',
          service_id: 'api_mock_service_id',
        },
      };
      return { bill, outTradeNo };
    },
    // 验付：mock 接受固定格式的 proof（MOCk_PAY_<outTradeNo>），模拟已支付
    async verify({ paymentProofHeader, expectOutTradeNo, expectResourceId, expectAmount }) {
      const proof = parseB64url(paymentProofHeader);
      if (!proof || proof.protocol?.payment_proof !== `MOCKPAY_${expectOutTradeNo}`) {
        return { ok: false, reason: '凭证无效（沙箱要求 payment_proof = MOCKPAY_<out_trade_no>）' };
      }
      return {
        ok: true,
        tradeNo: `MOCKTRADE_${expectOutTradeNo}`,
        outTradeNo: expectOutTradeNo,
        amount: (priceFen / 100).toFixed(2),
        active: true,
      };
    },
    async fulfill() { return { ok: true, mocked: true }; },
  };
}

// ---------- 支付宝真实实现 ----------
function createAlipayBilling(env) {
  const required = ['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY', 'ALIPAY_SELLER_ID', 'ALIPAY_SERVICE_ID'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) {
    throw new Error(`BILLING_MODE=alipay 缺少配置：${missing.join(', ')}（见 .env.example 与部署指南）`);
  }
  const appId = env.ALIPAY_APP_ID;
  const privateKey = env.ALIPAY_PRIVATE_KEY.replace(/\\n/g, '\n');
  const alipayPublicKey = env.ALIPAY_PUBLIC_KEY.replace(/\\n/g, '\n');
  const sellerId = env.ALIPAY_SELLER_ID; // 2088 开头
  const serviceId = env.ALIPAY_SERVICE_ID; // API_ 开头
  const gateway = env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
  const sellerName = env.SELLER_NAME || '笔记体检站';
  const priceFen = Number(env.PRICE_FEN || 199);

  // RSA2 商家签名：账单关键字段按字典序拼 key=value& 后 SHA256withRSA
  function signBill(fields) {
    const content = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('&');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(content, 'utf8');
    return signer.sign(privateKey, 'base64');
  }

  // 支付宝网关签名请求（OpenAPI 规范：公共参数 + 业务参数，RSA2）
  async function callAlipay(method, bizContent) {
    const params = {
      app_id: appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
      version: '1.0',
      nonce: randomUUID().replace(/-/g, ''),
      biz_content: JSON.stringify(bizContent),
    };
    const signContent = Object.keys(params).filter(k => k !== 'sign').sort().map(k => `${k}=${params[k]}`).join('&');
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signContent, 'utf8');
    params.sign = signer.sign(privateKey, 'base64');

    const body = new URLSearchParams(params).toString();
    const res = await fetch(gateway, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body });
    const data = await res.json();
    const respKey = method.replace(/\./g, '_') + '_response';
    const resp = data[respKey];
    if (!resp || resp.code !== '10000') {
      throw new Error(`支付宝接口 ${method} 失败：${JSON.stringify(data).slice(0, 500)}`);
    }
    return resp;
  }

  return {
    mode: 'alipay',
    priceFen,
    serviceName: '小红书笔记发布前体检',
    createBill(resourceId) {
      const outTradeNo = `CLINIC_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const amount = (priceFen / 100).toFixed(2);
      const payBefore = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const goodsName = '小红书笔记发布前体检报告';
      const signFields = { amount, currency: 'CNY', goods_name: goodsName, out_trade_no: outTradeNo, pay_before: payBefore, resource_id: resourceId, seller_id: sellerId, service_id: serviceId };
      const bill = {
        protocol: {
          out_trade_no: outTradeNo,
          amount,
          currency: 'CNY',
          resource_id: resourceId,
          pay_before: payBefore,
          seller_signature: signBill(signFields),
          seller_sign_type: 'RSA2',
          seller_unique_id: sellerId,
        },
        method: {
          seller_name: sellerName,
          seller_id: sellerId,
          seller_app_id: appId,
          goods_name: goodsName,
          seller_unique_id_key: 'seller_id',
          service_id: serviceId,
        },
      };
      return { bill, outTradeNo };
    },
    async verify({ paymentProofHeader, expectOutTradeNo, expectResourceId, expectAmount }) {
      const proof = parseB64url(paymentProofHeader);
      if (!proof?.protocol?.payment_proof || !proof?.protocol?.trade_no || !proof?.method?.client_session) {
        return { ok: false, reason: 'Payment-Proof 格式无效（需 protocol.payment_proof/trade_no + method.client_session）' };
      }
      let resp;
      try {
        resp = await callAlipay('alipay.aipay.agent.payment.verify', {
          payment_proof: proof.protocol.payment_proof,
          trade_no: proof.protocol.trade_no,
          client_session: proof.method.client_session,
        });
      } catch (e) {
        return { ok: false, reason: `验付接口调用失败：${e.message}` };
      }
      const amountMatch = Number(resp.amount) === Number(expectAmount);
      if (!resp.active) return { ok: false, reason: '凭证已失效（active=false），需重新支付' };
      if (resp.out_trade_no !== expectOutTradeNo) return { ok: false, reason: '订单号不匹配（out_trade_no）' };
      if (resp.resource_id !== expectResourceId) return { ok: false, reason: '资源标识不匹配（resource_id）' };
      if (!amountMatch) return { ok: false, reason: `金额不符：账单 ${resp.amount}，本单 ${expectAmount}` };
      return { ok: true, tradeNo: resp.trade_no, outTradeNo: resp.out_trade_no, amount: resp.amount, active: true };
    },
    async fulfill({ tradeNo }) {
      try {
        await callAlipay('alipay.aipay.agent.fulfillment.confirm', { trade_no: tradeNo });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message }; // 履约失败可重试，不影响交付
      }
    },
  };
}
