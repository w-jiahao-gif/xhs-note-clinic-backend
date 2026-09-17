// 封面策略引擎：类型推荐 + 大字报文案生成 + 封面文字检查清单

const COVER_TYPES = [
  { key: 'big_text', name: '大字报', fit: '干货/观点/教程', rule: '核心信息放大，≤8 个字，强对比色' },
  { key: 'contrast', name: '对比图', fit: '改造/测评/案例', rule: '左右或上下对比，差异肉眼可见' },
  { key: 'photo_text', name: '实景+文字叠加', fit: '种草/探店/攻略', rule: '实拍图为主，叠加 1 行关键信息' },
  { key: 'data_card', name: '数据卡片', fit: '案例/行业分析', rule: '核心数字放大占 50% 面积' },
];

function pickCoverType(formatName, track) {
  if (formatName === '案例故事' || formatName === '清单/教程') return 'data_card';
  if (['景区', '民宿', '餐饮', '花店', '手作'].includes(track)) return 'photo_text';
  if (formatName === '痛点+方法') return 'big_text';
  return 'big_text';
}

export function analyzeCover({ title, content, track, coverText = '', formatName = '' }) {
  const typeKey = pickCoverType(formatName, track);
  const type = COVER_TYPES.find(t => t.key === typeKey);

  // 大字报候选：从正文提取核心数字/结果
  const numMatch = content.match(/(\d+(?:\.\d+)?)\s*(%|％|倍|万|块|元|天|个月|小时|公里)/);
  const suggestions = [];
  if (numMatch) suggestions.push(`${type.name}：核心数字「${numMatch[0]}」放大占画面 50%`);
  const painMatch = content.match(/(别再|千万别|选错|做错)[^，。！？\n]{2,10}/);
  if (painMatch) suggestions.push(`大字报备选：「${painMatch[0]}」（≤8 字强对比色）`);
  suggestions.push(`封面文字 ≠ 标题文字：标题说结果 → 封面说场景，互补不重复`);
  if (!numMatch && !painMatch) suggestions.push('正文中没找到可放大的数字/结论 → 先补硬信息，再选封面主文案');

  const issues = [];
  if (coverText) {
    if (coverText.trim() === title.trim()) issues.push({ level: 'error', msg: '封面文字与标题完全重复 → 互补才不打架' });
    for (const w of ['最', '第一', '100%', '唯一', '免费', '送', '限时', '扫码', '抢']) {
      if (coverText.includes(w)) issues.push({ level: 'error', msg: `封面含风险词「${w}」` });
    }
    if (/微信|二维码|电话|公众号/.test(coverText)) issues.push({ level: 'error', msg: '封面含导流信息（微信/二维码/手机号）→ 限流' });
    if (Array.from(coverText).length > 12) issues.push({ level: 'warn', msg: '封面文字偏长，手机预览可能看不清' });
  }

  return {
    recommended: { ...type, reason: `匹配「${formatName || '当前'}」格式${track ? ` + ${track}赛道` : ''}` },
    all_types: COVER_TYPES,
    suggestions,
    issues,
    material_advice: '素材分级：自拍原图 > 商家未发布素材 > 已发布素材（必须改造：裁剪/调色/叠信息层）> 网图（查重风险）❌AI图（权重最低）',
  };
}
