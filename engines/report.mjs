// 报告组装器：汇总五个引擎的结果，产出结构化体检报告 + 判定 + 修复简报

import { analyzeTitle } from './title-engine.mjs';
import { analyzeContent } from './content-engine.mjs';
import { analyzeCompliance } from './compliance-engine.mjs';
import { classifyFormat, estimateCES, publishTimeAdvice } from './ces-engine.mjs';
import { analyzeCover } from './cover-engine.mjs';

export const TRACKS = ['景区', '民宿', '餐饮', '花店', '教培', '健身', '美容', '手作', '电商', '职场', '其他'];

export function buildReport({ title, content, track = '其他', cover_text = '' }) {
  const titleRes = analyzeTitle(title, track);
  const contentRes = analyzeContent(content);
  const complianceRes = analyzeCompliance(`${title}\n${content}`);
  const { format, profile } = classifyFormat(title, content);
  const cesRes = estimateCES({
    profile,
    titleScore: titleRes.total,
    contentPassed: contentRes.passed,
    contentTotal: contentRes.total,
    blocked: complianceRes.blocked,
    hardInfoCount: contentRes.checks.find(c => c.name === '硬信息点 ≥3')?.count ?? 0,
    aiTraceErrors: contentRes.ai_traces.filter(t => t.level === 'error').length,
  });
  Object.assign(cesRes, { format, format_tip: profile.tip }); // estimateCES 由 profile 计算
  const coverRes = analyzeCover({ title, content, track, coverText: cover_text, formatName: profile.name });
  const timeRes = publishTimeAdvice();

  // 判定
  let verdict, verdict_reason;
  if (complianceRes.blocked) {
    verdict = 'BLOCKED';
    verdict_reason = `命中 ${complianceRes.redLines.length} 条合规红线 —— 现在发布有被限流/违规风险，先修复合规问题`;
  } else if (titleRes.total < 70 || contentRes.passed < contentRes.total - 1) {
    verdict = 'FIX_FIRST';
    verdict_reason = `标题 ${titleRes.total}/100${titleRes.total < 70 ? '（<70 需重写）' : ''}，正文快检 ${contentRes.passed}/${contentRes.total} —— 修复后发布效果明显更好`;
  } else {
    verdict = 'PASS';
    verdict_reason = `标题 ${titleRes.total}/100，正文快检 ${contentRes.passed}/${contentRes.total}，无合规红线 —— 可以发布`;
  }

  // 修复优先级（给 agent 的修复简报）
  const fix_brief = [];
  if (complianceRes.blocked) fix_brief.push({ priority: 1, what: '合规红线', how: complianceRes.redLines.map(r => r.msg) });
  if (titleRes.total < 70) fix_brief.push({ priority: 2, what: '标题重写', how: [titleRes.suggestion.tip, ...titleRes.issues.map(i => i.msg)] });
  const failedChecks = contentRes.checks.filter(c => !c.pass);
  if (failedChecks.length) fix_brief.push({ priority: 3, what: '正文快检未过项', how: failedChecks.map(c => `${c.name}：${c.detail}`) });
  if (contentRes.ai_traces.length) fix_brief.push({ priority: 4, what: 'AI痕迹清除', how: contentRes.ai_traces.map(t => `${t.type}：${t.detail}`) });
  if (coverRes.issues.length) fix_brief.push({ priority: 5, what: '封面文案风险', how: coverRes.issues.map(i => i.msg) });

  return {
    verdict, verdict_reason,
    title: titleRes,
    content: contentRes,
    compliance: complianceRes,
    ces: cesRes,
    cover: coverRes,
    publish_time: timeRes,
    fix_brief,
    meta: { track, format: profile.name, generated_at: new Date().toISOString() },
  };
}
