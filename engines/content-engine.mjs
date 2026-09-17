// 正文体检引擎：8 项质量快检（≥7 项通过才能发）+ AI 痕迹扫描 + 硬信息密度
// 移植自内容评分卡 + 写作硬信息注入法则 + 去AI痕迹检查清单

const AI_TRANSITIONS = ['然而', '值得注意的是', '值得一提的是', '首先', '其次', '最后', '总而言之', '总的来说', '除此之外', '不仅', '还', '综上所述'];
const BAD_OPENERS = ['随着', '近年来', '在当今', '当今社会', '随着社会', '随着互联网', '今天给大家分享', '今天分享'];
const PAIN_OPEN_HINTS = ['你是不是', '你有没有', '你是不是也', '先说结果', '上周', '去年', '今年', '昨天', '前天', '上个月', '上个月'];
const CTA_SAFE_PATTERNS = ['你怎么看', '你怎么解决', '你有什么', '你觉得', '你们', '聊聊', '交流', '说说', '遇到过吗', '试过吗', '卡在哪'];
const UNIT_RE = /(\d+(?:\.\d+)?)\s*(块|元|万|千|亿|人|天|月|年|次|篇|条|个|步|小时|分钟|公里|米|平|㎡|%|％|倍|℃|°|度|分|单|客|粉|赞|评|转)/g;

function isEmojiChar(ch) {
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(ch);
}

// 前 40 字钩子检查
function checkOpening(content) {
  const head = Array.from(content.replace(/\s+/g, '')).slice(0, 40).join('');
  const badOpener = BAD_OPENERS.find(o => head.startsWith(o));
  if (badOpener) return { pass: false, name: '前40字钩子', detail: `开头是背景铺垫（「${badOpener}…」）→ 删掉铺垫，用具体的人+具体的麻烦+具体的数字开场` };
  const hasTime = /(去年|今年|上周|上个月|昨天|周[一二三四五六日]|前天|\d+月|\d+年前)/.test(head);
  const hasPerson = /(老板|闺蜜|朋友|我|我们|客户|读者|姐妹|家人们|阿姨|同事|邻居|宝妈)/.test(head);
  const hasNumber = /\d/.test(head);
  const hasPainHook = PAIN_OPEN_HINTS.some(p => head.includes(p));
  const score = (hasTime ? 1 : 0) + (hasPerson ? 1 : 0) + (hasNumber ? 1 : 0) + (hasPainHook ? 1 : 0);
  if (score >= 2) return { pass: true, name: '前40字钩子', detail: '开头有具体场景/人物/数字，能留住人' };
  return { pass: false, name: '前40字钩子', detail: '开头缺具体场景（时间+人物+困境），像背景介绍 → 用户会划走' };
}

function checkFirstPerson(content) {
  const pass = /我|我们/.test(content);
  return { pass, name: '第一人称叙事', detail: pass ? '有「我」，有真人感' : '全文无「我」→ 没有真人感，加第一人称经历/视角' };
}

function checkUnexpected(content) {
  const hasPit = /(踩坑|踩雷|翻车|没想到|居然|意外|坑爹|劝退|错了|失败|走了弯路|交了?学费)/.test(content);
  const hasData = /\d+\s*(%|％|倍|万)/.test(content);
  const pass = hasPit || hasData;
  return { pass, name: '意外数据/踩坑', detail: pass ? '有「出乎意料的数据」或「踩过的坑」' : '缺「意外/踩坑」——这是人味的来源，补一个预期外的转折' };
}

function checkLength(content) {
  const len = content.replace(/\s+/g, '').length;
  const pass = len >= 400 && len <= 800;
  let detail;
  if (len < 400) detail = `正文 ${len} 字偏短（目标 550-650）→ 硬信息不够，逐段补`;
  else if (len > 800) detail = `正文 ${len} 字偏长（目标 550-650）→ 干货类可放宽到 1000，超出部分考虑拆篇`;
  else detail = `正文 ${len} 字，在 550-650 黄金区间${len >= 550 && len <= 650 ? '' : '附近'}`;
  return { pass, name: '正文字数', detail };
}

function checkHardInfo(content) {
  const matches = [...content.matchAll(UNIT_RE)];
  const count = matches.length;
  const pass = count >= 3;
  return {
    pass, name: '硬信息点 ≥3',
    detail: pass ? `检测到 ${count} 处量化信息（数字+单位）` : `仅 ${count} 处量化信息（数字+单位）→ 收藏率的根因：每 90 字至少 1 个（价格/时间/步骤/数据）`,
    count,
  };
}

function checkCTA(content) {
  const tail = Array.from(content).slice(-80).join('');
  const hasQuestion = /[？?]/.test(tail);
  const safeHit = CTA_SAFE_PATTERNS.some(p => tail.includes(p));
  const pass = hasQuestion && safeHit;
  return { pass, name: 'CTA 开放提问', detail: pass ? '结尾是真诚的开放讨论邀请' : '结尾缺二选一/开放式提问 → 用「你卡在哪一步？」「你怎么看？」类安全模板（禁止利益交换词）' };
}

function checkValueWithoutCTA(content) {
  const noCta = content.replace(/[#\s]*(你|您)[^。！？\n]{0,20}[？?][^。！？\n]{0,10}$/u, '');
  const len = noCta.replace(/\s+/g, '').length;
  const pass = len >= 380;
  return { pass, name: '去CTA仍有价值', detail: pass ? '去掉 CTA 后正文依然完整有价值' : '正文主体太薄，价值全靠结尾互动撑着 → 先补硬信息' };
}

// AI 痕迹扫描（去AI味检查清单）
function aiTrace(content) {
  const traces = [];
  const transitionHits = AI_TRANSITIONS.filter(w => content.includes(w));
  const heavy = ['然而', '值得注意的是', '值得一提的是', '总而言之', '总的来说', '综上所述', '除此之外'];
  const heavyHits = heavy.filter(w => content.includes(w));
  if (heavyHits.length) traces.push({ type: 'AI高频词', detail: `命中 ${heavyHits.join('、')} → 删掉或换口语连接`, level: 'error' });
  if (/首先[\s\S]{0,200}其次[\s\S]{0,200}最后/.test(content)) traces.push({ type: '结构雷同', detail: '「首先…其次…最后」三段式 → 换时间线（第一个月…第二个月…）', level: 'warn' });

  const paragraphs = content.split(/\n+/).filter(p => p.trim());
  const emojiPerPara = paragraphs.map(p => Array.from(p).filter(isEmojiChar).length);
  const stacked = /(🔥|✅|❗|‼️|👍|⭐|💡|📍|✨)\1/.test(content);
  if (stacked) traces.push({ type: 'emoji堆叠', detail: '出现 🔥🔥🔥 式堆叠 → 禁止', level: 'error' });
  const overEmoji = emojiPerPara.filter(c => c > 1).length;
  if (overEmoji >= 2) traces.push({ type: 'emoji密度', detail: `${overEmoji} 个段落 emoji 超过 1 个 → 每段最多 1 个`, level: 'warn' });

  if (paragraphs.length >= 4) {
    const lens = paragraphs.map(p => p.length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance = lens.reduce((a, b) => a + (b - avg) ** 2, 0) / lens.length;
    if (variance < 400) traces.push({ type: '段落节奏', detail: '各段长度过于整齐 → 打散：一段长一段短，偶尔一句话成段', level: 'warn' });
  }

  const adjPile = /(优美|清新|宜人|心旷神怡|美不胜收|流连忘返)/.test(content);
  if (adjPile) traces.push({ type: '形容词堆砌', detail: '伪信息（风景优美/令人心旷神怡）→ 换具体数字/价格/时间', level: 'warn' });

  return traces;
}

export function analyzeContent(content) {
  const checks = [
    checkOpening(content),
    checkFirstPerson(content),
    checkUnexpected(content),
    checkLength(content),
    checkHardInfo(content),
    checkCTA(content),
    checkValueWithoutCTA(content),
    { pass: aiTrace(content).filter(t => t.level === 'error').length === 0, name: '无明显AI痕迹', detail: '' },
  ];
  const passed = checks.filter(c => c.pass).length;
  const traces = aiTrace(content);
  return { checks, passed, total: checks.length, ai_traces: traces };
}
