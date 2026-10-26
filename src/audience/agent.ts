/** Audience agent (Super, thinking on): names the segments. It never emits a percentage (BUILD_PLAN §3.2). */
import { chat } from '../llm.js';
import { SegmentProposal, AGE_BANDS } from '../schemas/persona.js';

export interface AudienceInput { postA: string; postB: string; goal: string; place: string; business: string }

export async function proposeSegments(inp: AudienceInput, tag: string): Promise<{ proposal: SegmentProposal; served_by: string; fallback: boolean }> {
  const system = `You are the Audience agent in Dry Run, a tool that tests social posts on simulated crowds.
Name who a local business's Instagram post is aimed at (the core segment) and who else will see it anyway (spillover).
Rules:
- Define the core segment only by age bands chosen from: ${AGE_BANDS.join(', ')}, plus behaviour or interests tied to the product.
- Never use race, ethnicity, nationality, religion or gender to define a segment.
- Never give percentages or sizes; population shares are computed from Census and Pew data, not by you.`;
  const user = `Business: ${inp.business}
Location: ${inp.place}
Goal: ${inp.goal}
Version A: ${inp.postA}
Version B: ${inp.postB}`;
  try {
    const r = await chat({ role: 'reason', system, user, schema: SegmentProposal, schemaName: 'SegmentProposal', tag, maxTokens: 500 });
    if (r.ok && r.data) return { proposal: r.data, served_by: r.served_by, fallback: false };
  } catch { /* provider down: deterministic fallback below */ }
  return {
    proposal: {
      core: { name: 'daily Instagram users 18-34 nearby', age_bands: ['18-24', '25-34'], why: 'Default core for a local consumer post; edit to match your target.' },
      spillover: { name: 'other Instagram-using adults nearby', why: 'Paid local reach also lands outside the target.' },
      interests: [],
    },
    served_by: 'fallback',
    fallback: true,
  };
}
