// 订单存储：JSON 文件 + 原子写 + 进程内串行化。
// 满足平台幂等要求：同一 out_trade_no 只履约一次；订单状态可恢复。
// 生产高并发场景可替换为 SQLite/MySQL（接口不变）。

import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';

export class OrderStore {
  constructor(file = './data/orders.json') {
    this.file = path.resolve(file);
    this.queue = Promise.resolve();
    if (!fs.existsSync(path.dirname(this.file))) fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify({ orders: {} }));
  }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { orders: {} }; }
  }
  _save(db) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, this.file);
  }
  _tx(fn) {
    this.queue = this.queue.then(() => {
      const db = this._load();
      fn(db);
      this._save(db);
    }).catch(e => { console.error('[OrderStore]', e.message); });
    return this.queue;
  }

  async create({ outTradeNo, resourceId, amount, requestHash }) {
    await this._tx(db => {
      db.orders[outTradeNo] = {
        status: 'PENDING', outTradeNo, resourceId, amount, requestHash,
        createdAt: new Date().toISOString(),
      };
    });
  }

  get(outTradeNo) {
    return this._load().orders[outTradeNo] || null;
  }

  async markPaid(outTradeNo, tradeNo) {
    await this._tx(db => {
      const o = db.orders[outTradeNo];
      if (o && o.status === 'PENDING') { o.status = 'PAID'; o.tradeNo = tradeNo; o.paidAt = new Date().toISOString(); }
    });
  }

  async markFulfilled(outTradeNo, report) {
    await this._tx(db => {
      const o = db.orders[outTradeNo];
      if (o && o.status !== 'FULFILLED') { o.status = 'FULFILLED'; o.fulfilledAt = new Date().toISOString(); o.report = report; }
    });
  }

  // 幂等取回：按请求内容哈希找最近已完成订单（同内容重复请求不重复扣费思路的辅助索引）
  findFulfilledByHash(requestHash, withinMs = 10 * 60 * 1000) {
    const db = this._load();
    const now = Date.now();
    return Object.values(db.orders)
      .filter(o => o.status === 'FULFILLED' && o.requestHash === requestHash && now - Date.parse(o.fulfilledAt) < withinMs)
      .sort((a, b) => Date.parse(b.fulfilledAt) - Date.parse(a.fulfilledAt))[0] || null;
  }

  // 重试兜底：最近一张未完成（PENDING/PAID）订单，15 分钟内有效
  findLatestUnfinished(withinMs = 15 * 60 * 1000) {
    const db = this._load();
    const now = Date.now();
    return Object.values(db.orders)
      .filter(o => o.status !== 'FULFILLED' && now - Date.parse(o.createdAt) < withinMs)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
  }

  // 防重复履约：按支付宝交易号查已支付订单
  findByTradeNo(tradeNo) {
    if (!tradeNo) return null;
    return Object.values(this._load().orders).find(o => o.tradeNo === tradeNo) || null;
  }

  stats() {
    const orders = Object.values(this._load().orders);
    return { total: orders.length, paid: orders.filter(o => o.status !== 'PENDING').length, fulfilled: orders.filter(o => o.status === 'FULFILLED').length };
  }
}

export function hashRequest(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
export const newResourceId = () => `RES_CLINIC_${Date.now()}_${randomUUID().slice(0, 8)}`;
