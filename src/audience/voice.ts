/**
 * One-line voices (Lightning, thinking off, 25 per call). The model gets the numbers first and writes only
 * the voice. Gender is not shown to the model, and voices that lean on identity traits are rejected.
 */
import { chat } from '../llm.js';
import { VoiceBatch, type Persona } from '../schemas/persona.js';

const FORBIDDEN = /\b(white|black|asian|latin[oax]?|hispanic|african|indian|chinese|mexican|korean|japanese|arab|jewish|muslim|christian|immigrant|girl|guy|bro|dude|lady|gal|mom|dad|mother|father|wife|husband|boyfriend|girlfriend|feminine|masculine|nerd|basic)\b/i;

function describe(p: Omit<Persona, 'voice'>) {
  const habit = p.customer ? `already a customer (${p.customer.visits_per_month} visits/month, $${p.customer.avg_ticket} avg)` : 'not a customer yet';
  return `${p.id}: age ${p.age}, ${p.education}, household income ${p.income_band}, Instagram ${p.daily_minutes} min/day, price sensitivity ${p.price_sensitivity}, ad skepticism ${p.skepticism}, ${habit}`;
}

export function fallbackVoice(p: Omit<Persona, 'voice'>): string {
  const price = p.price_sensitivity > 0.65 ? 'counts every dollar' : p.price_sensitivity < 0.35 ? 'pays for quality without much thought' : 'will pay for something good';
  const skept = p.skepticism > 0.65 ? 'rolls their eyes at most ads' : p.skepticism < 0.4 ? 'open to trying what shows up in the feed' : 'needs a reason before clicking';
  const scroll = p.daily_minutes > 60 ? 'scrolls a lot' : p.daily_minutes < 20 ? 'checks Instagram briefly' : 'scrolls most evenings';
  return `${p.age}, ${scroll}, ${price}, ${skept}`;
}

export async function writeVoices(personas: Omit<Persona, 'voice'>[], context: string, tag: string, onBatch?: (done: number) => void): Promise<{ voices: Map<string, string>; fallbacks: number; rejected: number }> {
  const voices = new Map<string, string>();
  let fallbacks = 0, rejected = 0;
  const system = `You write one-line voices for simulated people in a market-research crowd. Each voice is a short, specific,
human description in third person of how this person lives and shops (under 18 words), consistent with their numbers.
Never mention gender, race, ethnicity, nationality, religion or family roles. No stereotypes, no slang caricatures.
Make every voice different in rhythm and content.`;
  const batches: Omit<Persona, 'voice'>[][] = [];
  for (let i = 0; i < personas.length; i += 25) batches.push(personas.slice(i, i + 25));
  let done = 0;
  await Promise.all(batches.map(async (batch) => {
    const user = `Context: ${context}\nPeople:\n${batch.map(describe).join('\n')}\n\nReturn {"voices":[{"id":..., "voice":...}]} with one entry per person.`;
    try {
      const r = await chat({ role: 'voice', system, user, schema: VoiceBatch, schemaName: 'VoiceBatch', tag, maxTokens: 60 * batch.length });
      if (r.ok && r.data) for (const v of r.data.voices) {
        if (FORBIDDEN.test(v.voice)) { rejected++; continue; }
        voices.set(v.id, v.voice.trim());
      }
    } catch { /* fallback below */ }
    done += batch.length;
    onBatch?.(done);
  }));
  for (const p of personas) if (!voices.has(p.id)) { voices.set(p.id, fallbackVoice(p)); fallbacks++; }
  return { voices, fallbacks, rejected };
}
