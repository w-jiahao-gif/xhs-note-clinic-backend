// 标题诊断引擎：五维评分（每维 20 分，满分 100）+ 硬约束 + 废词黑名单
// 移植自小红书内容方法论（标题诊断师 + 标题写作五条硬约束）

const WASTE_WORDS = ['干货', '实录', '指南', '一则', '纯干货', '来了', '必看', '揭秘', '天花板', '封神', 'yyds', '必去', '不去后悔', '绝了', '后悔没早看'];
const PAIN_WORDS = ['焦虑', '没效果', '没人看', '踩坑', '亏', '错', '怎么办', '卡在', '翻车', '后悔', '晚了', '难', '痛点', '踩雷', '劝退', '失败', '白忙', '无效', '踩过'];
const EMOTION_WORDS = ['救命', '疯了', '撑不住', '没想到', '居然', '竟然', '其实', '千万别', '别再', '小心', '注意', '‼️', '❗', '❓', '？', '?'];
const BENEFIT_WORDS = ['省', '赚', '回本', '搞定', '学会', '避坑', '翻倍', '攻略', '直接用', '亲测', '实测', '闭眼', '抄作业', '拿走', '包会', '有效'];
const BAD_OPENERS = ['随着', '近年来', '在当今', '今天给大家', '今天分享'];

// emoji 判定（常见 emoji 区段）
function countEmoji(s) {
  const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  return (s.match(re) || []).length;
}

function extractDigits(s) {
  return (s.match(/\d+/g) || []).map(Number);
}

// 维度1：语义清晰度（具体信息 > 空洞口号）
function scoreClarity(title) {
  let score = 16;
  const reasons = [];
  const hasNum = /\d/.test(title);
  const hasConcrete = /(省|市|县|路|店|镇|村|山|湖|海|岛|街|巷|馆|店|班|课|房|菜|家|人|块|元|月|天|周|小时|分钟|公里|米|℃|°|℃)/.test(title);
  if (!hasNum) { score -= 4; reasons.push('无具体数字，信息密度低'); }
  if (!hasConcrete) { score -= 3; reasons.push('缺具体名词（地点/事物/单位），偏口号'); }
  const waste = WASTE_WORDS.filter(w => title.includes(w));
  if (waste.length) { score -= 6; reasons.push(`命中废词黑名单：${waste.join('、')}（零搜索量，纯占字数）`); }
  if (/必去的?\d*个?理由|总览|大盘点(?!.*\d)/.test(title)) { score = Math.min(score, 7); reasons.push('通用模板句式（如"XX必去的N个理由/总览"），一眼划走'); }
  if (title.length < 6) { score = Math.min(score, 10); reasons.push('标题过短，信息不足'); }
  if (!reasons.length) reasons.push('具体信息充分，一眼可懂');
  return { score: Math.max(0, Math.min(20, score)), reasons };
}

// 维度2：痛点/利益关联
function scorePain(title) {
  let score = 8;
  const reasons = [];
  const hits = PAIN_WORDS.filter(w => title.includes(w));
  if (hits.length >= 2) { score = 18; reasons.push(`多重痛点词：${hits.slice(0, 3).join('、')}`); }
  else if (hits.length === 1) { score = 16; reasons.push(`命中痛点词：${hits[0]}`); }
  else if (/\d.{0,6}(个|天|月|年|次|块|元|%|％)/.test(title)) { score = 12; reasons.push('有量化信息但未直击痛点'); }
  else { reasons.push('未命中痛点词，跟读者处境关联弱'); }
  return { score, reasons };
}

// 维度3：搜索词前置（前 10 字含核心搜索词）
function scoreSearch(title, keyword) {
  const reasons = [];
  const head = Array.from(title).slice(0, 10).join('');
  let kw = keyword;
  if (!kw) {
    // 无赛道关键词时，退化用标题中的具体名词判断
    const m = title.match(/[\u4e00-\u9fa5]{2,4}(?=(攻略|推荐|避坑|测评|体验|打卡|指南))/);
    kw = m ? m[0] : null;
  }
  if (!kw) return { score: 8, reasons: ['未提供赛道关键词，无法精确判定搜索词位置（建议传入赛道）'] };
  if (head.includes(kw)) { return { score: 18, reasons: [`核心搜索词「${kw}」在前 10 字，搜索权重最高`], keyword: kw }; }
  if (title.includes(kw)) { return { score: 11, reasons: [`搜索词「${kw}」在后半段，前 10 字权重浪费`], keyword: kw }; }
  return { score: 4, reasons: [`标题不含赛道核心搜索词「${kw}」`], keyword: kw };
}

// 维度4：情绪钩子
function scoreEmotion(title) {
  let score = 8;
  const reasons = [];
  const nums = extractDigits(title);
  const hasContrast = nums.length >= 2 || /\d+\s*(%|％|倍|万|块|元)/.test(title);
  const emoHits = EMOTION_WORDS.filter(w => title.includes(w));
  if (hasContrast) { score += 5; reasons.push('有数字/反差信息'); }
  if (emoHits.length) { score += 4; reasons.push(`情绪词：${emoHits.slice(0, 2).join('、')}`); }
  if (/怎么选|怎么做|如何/.test(title)) { score -= 4; reasons.push('「怎么选/怎么做」句式弱于「选错了/做错了」否定句式'); }
  if (!reasons.length) reasons.push('平淡陈述，缺情绪起伏');
  return { score: Math.max(0, Math.min(20, score)), reasons };
}

// 维度5：利益承诺
function scoreBenefit(title) {
  let score = 8;
  const reasons = [];
  const hits = BENEFIT_WORDS.filter(w => title.toLowerCase().includes(w));
  if (hits.length) { score = 17; reasons.push(`利益承诺词：${hits.slice(0, 3).join('、')}`); }
  else if (/\d+(个|步|条|天|招)/.test(title)) { score = 13; reasons.push('有可量化获得感（N个/N步）'); }
  else reasons.push('看完标题不知道能得到什么');
  return { score, reasons };
}

// 硬约束检查（发布前必须过）
function hardConstraints(title, keyword) {
  const issues = [];
  const len = Array.from(title).length;
  if (len > 20) issues.push({ level: 'error', msg: `标题 ${len} 字超限（≤20 字，emoji 算 1 字），信息流会被截断` });
  const waste = WASTE_WORDS.filter(w => title.includes(w));
  if (waste.length) issues.push({ level: 'error', msg: `废词黑名单命中：${waste.join('、')} → 删除（零搜索量）` });
  const emojiCount = countEmoji(title);
  if (emojiCount === 0) issues.push({ level: 'warn', msg: '标题无 emoji：建议 emoji 开头做信息流视觉锚点（每篇换不同 emoji）' });
  else if (countEmoji(Array.from(title).slice(0, 2).join('')) === 0) issues.push({ level: 'warn', msg: 'emoji 不在开头，视觉锚点作用减半' });
  if (/怎么选|怎么做|如何选/.test(title)) issues.push({ level: 'warn', msg: '「怎么选/怎么做」→ 改否定句式「选错了/做错了」，点击率更高' });
  return issues;
}

export function analyzeTitle(title, keyword = '') {
  const dims = [
    { name: '语义清晰度', ...scoreClarity(title) },
    { name: '痛点关联', ...scorePain(title) },
    { name: '搜索词前置', ...scoreSearch(title, keyword) },
    { name: '情绪钩子', ...scoreEmotion(title) },
    { name: '利益承诺', ...scoreBenefit(title) },
  ];
  const total = dims.reduce((s, d) => s + d.score, 0);
  const issues = hardConstraints(title, keyword);
  const suggestion = total < 70
    ? { rewrite: true, tip: '得分 <70：按「数字+结果」>「具体痛点锁定」>「反常识提问」公式重写，前 10 字放赛道搜索词，≤20 字' }
    : { rewrite: false, tip: '达标，可保留' };
  return { total, dims, issues, suggestion };
}
