// 合规审查引擎：CTA 黑名单逐字扫描 + 四种诱导互动 + 极限词/敏感词硬阻断
// 命中任何 🔴 红线 → 直接拦截，不得发布
// 设计原则：红线只收「明确违规形态」，正常表达（价格 10元/20元、"第一天"、"最佳拍照点"）不误拦。
// 词表项支持 string（includes 匹配）或 [label, RegExp]（精确形态匹配）。

const CTA_BLACKLIST = {
  // 「0元/零元」用负向后行断言：排除 "10元/100元" 等正常价格
  免费利益: ['免费', '白嫖', ['0元', /(?<![0-9])0元/], ['零元', /(?<![0-9])零元/], '不花钱', ['送你', /送你.{0,4}(资料|福利|模板|课程|礼包|礼物|优惠券)/], '白给'],
  利益交换: ['帮你免费', '评论送', '评论抽', '评论领', '扣1领取', '私信送', '扣1领', '评论区领', '评论区送', '评论区抽', '点赞送', '点赞领'],
  // 「解锁福利」收紧自「解锁」（"解锁新技能"为正常表达）；「彩蛋」「接住」因误报率高移除
  惊喜悬念: ['有惊喜', ['解锁', /解锁(福利|彩蛋|领取)/], '隐藏福利', '不看后悔', '点开有'],
  玄学诱导: ['接好运', '去霉运', '祈福', '许愿', '保佑', '转发有好运'],
  指令互动: ['评论区发', '评论区扣', '评论区告诉我', '私信我领取', '私信我获取', '评论区留言领取'],
  服务承诺: ['帮你诊断', '帮你分析账号', '帮你免费看', '帮你评估', '帮你优化'],
};

// 极限词（广告法）：单字会误拦（"第一天/唯一的问题/最佳拍照点/最好的朋友"）→ 收紧为明确违规形态
const EXTREME_WORDS = [
  ['全网最', /全网最/], ['史上最', /史上最/],
  ['第一（排名）', /(销量|排名|行业|口碑|人气|性价比)第一/],
  ['唯一（排他）', /唯一(的)?(选择|途径|方法|推荐|标准|解药)/],
  ['最好（排他）', /(全网|史上|年度|行业|公认的?)?最好(的)?(选择|方法|方式|推荐)/],
  ['最佳（排他）', /(全网|史上|年度|行业)最佳/],
  ['保证（承诺）', /保证.{0,4}(有效|成功|赚钱|瘦|白|通过|不复发|永久)/],
  '100%', '百分之百', '绝对', '国家级', '世界级', '顶级', '独家',
];
// 「月入/日入」收紧为收益承诺形态（"月入过万/月入3万"），排除"月入住率/日入住"等正常子串
const RICH_WORDS = [
  ['月入（收益承诺）', /月入[0-9零一二三四五六七八九十百千万过+]/], ['日入（收益承诺）', /日入[0-9零一二三四五六七八九十百千万过+]/],
  '躺赚', '暴富', '躺赢', '财富自由', '翻倍赚', '轻松赚', '稳赚',
];
// 导流分级：明确带联系方式/扫码的硬导流 = 红线；疑似（vx、链接、公众号名）= warning
const DRAIN_HARD = [/加微信[:：]?\s*[\w-]{3,}/, /微信号[:：]/, /二维码|扫码|扫一扫/, /私信我.{0,6}(微信|电话|手机)/];
const DRAIN_SOFT = [/加微信/i, /wx号|微信号|vx/i, /公众号[:：]/, /(www|http|\.com|\.cn)/i];

export function analyzeCompliance(content) {
  const redLines = [];
  const warnings = [];

  // Step 1: CTA 黑名单扫描（string=includes，[label,re]=正则形态）
  for (const [category, words] of Object.entries(CTA_BLACKLIST)) {
    for (const w of words) {
      const hit = Array.isArray(w) ? w[1].test(content) : content.includes(w);
      const label = Array.isArray(w) ? w[0] : w;
      if (hit) {
        redLines.push({ category: 'CTA黑名单', word: label, level: 'error', msg: `命中「${category}」黑名单词：${label} → 平台限流/违规高风险，必须删除` });
      }
    }
  }
  // 致命模式：帮你 + 明确服务性动词（"做/看/改/测"等单字误报率高，已排除）
  const fatal = content.match(/帮你[^，。！？\n]{0,6}(诊断|分析|评估|优化|免费看|测算|规划)/);
  if (fatal) redLines.push({ category: 'CTA黑名单', word: fatal[0], level: 'error', msg: `致命模式「${fatal[0]}」（帮你+服务动词）→ 换成「你怎么看？评论区聊聊」类安全模板` });

  // Step 2: 四种诱导互动
  const inducements = [
    { type: '利益交换型', re: /(评论|私信|扣1|点赞|关注).{0,8}(送|领|抽|优惠|福利|资料|诊断|评估)/ },
    { type: '悬念惊喜型', re: /(点赞|关注|评论).{0,8}(惊喜|解锁|彩蛋|秘密)/ },
    { type: '玄学诱导型', re: /(点赞|转发|关注).{0,8}(好运|霉运|祈福|保佑|许愿)/ },
    { type: '无意义问答型', re: /(你是什么星座|扣1看看|有多少人|举个小手)/ },
  ];
  for (const { type, re } of inducements) {
    const m = content.match(re);
    if (m) redLines.push({ category: '诱导互动', word: m[0], level: 'error', msg: `「${type}」诱导互动：${m[0]} → 限流高风险` });
  }

  // Step 3: 极限词（广告法，已收紧为明确违规形态）
  for (const w of EXTREME_WORDS) {
    const hit = Array.isArray(w) ? w[1].test(content) : content.includes(w);
    const label = Array.isArray(w) ? w[0] : w;
    if (hit) redLines.push({ category: '极限词', word: label, level: 'error', msg: `广告法极限词「${label}」→ 删除或改具体描述` });
  }

  // Step 4: 暴富词（已收紧为收益承诺形态）
  for (const w of RICH_WORDS) {
    const hit = Array.isArray(w) ? w[1].test(content) : content.includes(w);
    const label = Array.isArray(w) ? w[0] : w;
    if (hit) redLines.push({ category: '收益违规', word: label, level: 'error', msg: `收益承诺词「${label}」→ 平台重点治理，必须删除` });
  }

  // Step 5: 导流信息（硬导流=红线；疑似=warning）
  for (const re of DRAIN_HARD) {
    const m = content.match(re);
    if (m) redLines.push({ category: '导流风险', word: m[0], level: 'error', msg: `检测到站外导流「${m[0]}」→ 平台硬打击，必须删除` });
  }
  for (const re of DRAIN_SOFT) {
    const m = content.match(re);
    if (m) warnings.push({ category: '导流风险', word: m[0], level: 'warn', msg: `检测到疑似站外导流「${m[0]}」→ 若在图片/文案中出现会被限流` });
  }

  // Step 6: AI 声明提示
  if (!/#AI辅助创作|AI辅助|AI 创作/.test(content)) {
    warnings.push({ category: 'AI声明', level: 'warn', msg: '未检测到 #AI辅助创作 标签 → AI 参与创作建议加上，不加可能被降权' });
  }

  return { redLines, warnings, blocked: redLines.length > 0 };
}
