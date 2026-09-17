// CES 预估引擎：格式判定 + 互动量分段预估 + 发布时间建议
// CES = 点赞×1 + 收藏×1 + 评论×4 + 转发×4 + 关注×8

const FORMAT_PROFILES = {
  case_story: { name: '案例故事', base: [30, 60], top: 80, signals: /(我|我们).{0,30}(做了|干了|试了|发了|从)/, tip: 'CES 最高格式：困境→尝试→意外→数字结果→可复用经验' },
  pain_solution: { name: '痛点+方法', base: [17, 32], top: 50, signals: /(你是不是|为什么|怎么办|其实|原因)/, tip: '结构：你是不是也这样 → 原因拆解 → 可操作步骤 → 变化' },
  opinion: { name: '互动观点', base: [10, 20], top: 40, signals: /(我觉得|我认为|说实话|讲真|真的)/, tip: '短观点+提问，互动率最高但收藏弱' },
  list_tutorial: { name: '清单/教程', base: [5, 12], top: 20, signals: /(步骤|清单|第一|1\.|①|✅|❌)/, tip: 'CES 天花板最低（收藏率≈0），建议改写成案例故事' },
};

export function classifyFormat(title, content) {
  const text = title + '\n' + content;
  const scores = {};
  for (const [key, p] of Object.entries(FORMAT_PROFILES)) {
    let s = 0;
    if (p.signals.test(text)) s += 2;
    if (key === 'case_story') {
      if (/(去年|今年|上个月|\d+月).{0,40}(我|我们)/.test(text)) s += 2;
      if (/\d+\s*(%|％|倍|万|个)/.test(text)) s += 1;
    }
    if (key === 'pain_solution') {
      if (/(第一步|第二步|1\.|①)/.test(text)) s += 1;
    }
    if (key === 'list_tutorial') {
      const bullets = (text.match(/(1\.|2\.|3\.|①|②|③|✅|❌|- \*)/g) || []).length;
      if (bullets >= 3) s += 3;
    }
    scores[key] = s;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return { format: best, profile: FORMAT_PROFILES[best], all_scores: scores };
}

export function estimateCES({ profile, titleScore, contentPassed, contentTotal, blocked, hardInfoCount, aiTraceErrors }) {
  if (blocked) {
    return { band: '被拦截', estimate: 0, drivers: ['命中合规红线：平台限流，互动量趋近 0 —— 先修复再谈流量'] };
  }
  let [lo, hi] = profile.base;
  // 标题质量修正（0.7 ~ 1.3）
  const titleFactor = 0.7 + (titleScore / 100) * 0.6;
  // 内容通过率修正（0.75 ~ 1.15）
  const passFactor = 0.75 + (contentPassed / contentTotal) * 0.4;
  // 硬信息加成
  const infoBonus = hardInfoCount >= 5 ? 1.1 : hardInfoCount >= 3 ? 1.0 : 0.85;
  // AI 痕迹惩罚
  const aiPenalty = aiTraceErrors > 0 ? 0.85 : 1.0;

  const estLo = Math.round(lo * titleFactor * passFactor * infoBonus * aiPenalty);
  const estHi = Math.round(hi * titleFactor * passFactor * infoBonus * aiPenalty);
  const mid = Math.round((estLo + estHi) / 2);

  const drivers = [
    `格式基线（${profile.name}：CES ${profile.base[0]}-${profile.base[1]}）`,
    `标题 ${titleScore}/100 → ×${titleFactor.toFixed(2)}`,
    `正文快检 ${contentPassed}/${contentTotal} → ×${passFactor.toFixed(2)}`,
    hardInfoCount >= 3 ? `硬信息 ${hardInfoCount} 处 → 收藏驱动充足` : `硬信息不足（${hardInfoCount} 处）→ 收藏率是短板`,
  ];
  if (aiTraceErrors > 0) drivers.push(`存在 ${aiTraceErrors} 类 AI 痕迹 → ×0.85（平台对模板化内容降权）`);
  if (profile.name === '清单/教程') drivers.push('⚠️ 清单/教程格式 CES 天花板仅 20，改写成案例故事可到 30-60');

  return { band: `${estLo}-${estHi}`, estimate: mid, drivers, ceiling: profile.top };
}

export function publishTimeAdvice() {
  return {
    best: '周四 20:00（实测数据最佳）',
    alt: ['周二 20:00（备选）', '周六 10:00（周末休闲流量）'],
    avoid: '周一（用户忙，划走率高）',
    sop: [
      '发布前 5 分钟：写好置顶评论草稿（30 字+，补充正文没说的实用信息）',
      '发布后 0-5 分钟：立即发置顶评论 + 分享朋友圈（配钩子话，别只说"发新笔记了"）+ 分享 1-2 个精准群',
      '发布后 5-30 分钟：找 2-3 人在评论区问具体问题（不是"写得好"）+ 认真回复每一条评论',
      '实测：跳过冷启动曝光约 23，执行冷启动曝光约 500-600，差 20 倍',
    ],
  };
}
