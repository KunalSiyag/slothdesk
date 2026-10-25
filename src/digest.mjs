// Writes the two-minute note. By default the writer is the local Gemma too, so nothing
// leaves the laptop. With --cloud it is Ultramarine, which only ever sees a scrubbed list
// of the pile, never a file. Either way the writer can ask about one file through
// ask_local: the local model reads the file and the answer is scrubbed before it is
// passed on. Every request is written to .slothdesk/outbound/ so you can read exactly
// what the writer saw.

import OpenAI from 'openai';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { LOCAL_MODEL, OLLAMA, answer, pdfText } from './gemma.mjs';
import { readJSON, stateDir, writeJSON } from './scan.mjs';
import { scrub } from './sensitive.mjs';

export const CLOUD_MODEL = process.env.SLOTHDESK_CLOUD_MODEL || 'ultramarine-1-flash';
// USD per million tokens, from Paper Instruments' price card (checked 2026-10-24).
const PRICE = { input: 0.15, cached: 0.03, output: 0.5 };
const MAX_TOOL_CALLS = 12;

export function manifest(plan) {
  return plan.files.map(f => {
    const row = { id: f.id, folder: f.folder, name: basename(f.to), kind: f.kind, day: f.day };
    if (f.duplicateOf) return { ...row, duplicateOf: f.duplicateOf };
    if (f.level === 'secret') return { ...row, name: f.slug ? basename(f.to) : scrub(f.from), secret: f.why };
    if (f.level === 'personal') row.private = f.why;
    else row.summary = f.summary;
    if (f.dates?.length) row.dates = f.dates;
    if (f.actions?.length) row.actions = f.actions;
    if (f.size > 50e6) row.sizeMB = Math.round(f.size / 1e6);
    return row;
  });
}

const SYSTEM = `You are slothdesk, a lazy person's assistant. A messy Downloads folder was just sorted. You get the upcoming dates, the files that hold secrets, and a scrubbed list of the whole pile. You never see the files themselves.

Your job is to pick the three things the owner should deal with first, and say why in one line each. Favour the soonest deadlines, money that is owed, and anything with a late fee or penalty.
Before you pick, check anything whose status is unclear with ask_local: for example whether a bill or fine is already paid, or whether something still has to be signed or returned. A small local model reads that file and answers. Ask at most four questions, one file each.

Then reply with only this, in Markdown:
## Start here
1. **what to do** by when, in a few words. Why it matters, in one short sentence. \`file name\`
2. ...
3. ...

Use only facts from the list and from ask_local answers. Never repeat personal data.`;

const ASK_LOCAL = {
  name: 'ask_local',
  description: 'Ask the local model one question about one file. It reads the file on the owner\'s laptop and answers in at most two scrubbed sentences. Secret files cannot be asked about.',
  parameters: {
    type: 'object',
    properties: { file_id: { type: 'string' }, question: { type: 'string' } },
    required: ['file_id', 'question'],
  },
};

async function askLocal(plan, { file_id, question }) {
  const f = plan.files.find(x => x.id === file_id);
  if (!f) return 'no such file';
  if (f.level === 'secret') return 'refused: this file is secret and is never opened';
  if (f.duplicateOf) return `duplicate of ${f.duplicateOf}; ask about that one`;
  const moved = join(plan.dir, f.to);
  const p = existsSync(moved) ? moved : join(plan.dir, f.from);
  const reply = f.kind === 'image' ? await answer(question, { imagePath: p })
    : f.kind === 'pdf' ? await answer(question, { text: pdfText(p, 4) })
    : f.kind === 'text' ? await answer(question, { text: readFileSync(p, 'utf8') })
    : `only the name is known for this ${extname(p) || 'file'}`;
  return scrub(reply);
}

const within = (d, today, days) => d >= today && (Date.parse(d) - Date.parse(today)) / 864e5 <= days;
const LOCK_KINDS = /identity|bank|tax|employment|health|secret/;
// Dates about the file itself, not about something the owner has to do.
const NOT_A_TASK = /creat|publi|download|modif|upload|taken|snapshot|statement|period|start date|issued/i;

// The parts of the note that code can get exactly right.
export function facts(plan, today) {
  const name = f => basename(f.to);
  const byId = Object.fromEntries(plan.files.map(f => [f.id, f]));
  const upcoming = plan.files.filter(f => !f.duplicateOf)
    .flatMap(f => (f.dates || []).filter(x => within(x.date, today, 45) && !NOT_A_TASK.test(x.what)).map(x => ({ ...x, id: f.id, file: name(f) })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const lock = plan.files.filter(f => !f.duplicateOf && (f.level === 'secret' || (f.level === 'personal' && LOCK_KINDS.test(f.why || ''))))
    .map(f => ({ id: f.id, file: name(f), why: f.why }));
  const old = f => (Date.parse(today) - Date.parse(f.day)) / 864e5;
  const deletable = [
    ...plan.files.filter(f => f.duplicateOf).map(f => ({ file: name(f), why: `identical copy of \`${name(byId[f.duplicateOf])}\`` })),
    ...plan.files.filter(f => f.folder === 'installers' && old(f) > 14).map(f => ({ file: name(f), why: `installer downloaded ${Math.round(old(f))} days ago` })),
  ];
  const counts = {};
  for (const f of plan.files) counts[f.folder] = (counts[f.folder] || 0) + 1;
  return { upcoming, lock, deletable, counts };
}

const fmtDay = d => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function render(fx) {
  const out = [];
  if (fx.upcoming.length) out.push('## Coming up', ...fx.upcoming.map(x => `- **${fmtDay(x.date)}**: ${x.what.charAt(0).toUpperCase()}${x.what.slice(1)} \`${x.file}\``));
  if (fx.lock.length) out.push('', '## Lock these up',
    'These should not live in Downloads. Move keys, codes and secrets into a password manager; keep ID and money documents in an encrypted folder.',
    ...fx.lock.map(x => `- \`${x.file}\`: ${x.why}`));
  if (fx.deletable.length) out.push('', '## Probably safe to delete', ...fx.deletable.map(x => `- \`${x.file}\`: ${x.why}`));
  out.push('', '## What was in the pile', Object.entries(fx.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
  return out.join('\n');
}

export function cost(u) {
  const cached = u.cached || 0;
  return ((u.input - cached) * PRICE.input + cached * PRICE.cached + u.output * PRICE.output) / 1e6;
}

// Two writers behind one shape: { content, calls: [{ id, name, args }], usage }.
function localWriter(model) {
  return {
    model,
    where: 'local',
    async complete(messages, withTools) {
      const res = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false, think: false, keep_alive: '30m',
          options: { temperature: 0.3, num_ctx: 16384 },
          ...(withTools && { tools: [{ type: 'function', function: ASK_LOCAL }] }),
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      const r = await res.json();
      const calls = (r.message.tool_calls || []).map((c, i) => ({ id: `call_${i}`, name: c.function.name, args: c.function.arguments || {} }));
      return {
        content: r.message.content || '',
        calls,
        echo: { role: 'assistant', content: r.message.content || '', ...(r.message.tool_calls && { tool_calls: r.message.tool_calls }) },
        toolMessage: (call, out) => ({ role: 'tool', tool_name: call.name, content: out }),
        usage: { input: r.prompt_eval_count || 0, output: r.eval_count || 0 },
      };
    },
  };
}

function cloudWriter(model, effort) {
  const key = process.env.PAPERINSTRUMENTS_API_KEY;
  if (!key) throw new Error('set PAPERINSTRUMENTS_API_KEY for --cloud (or leave it off to write the note locally)');
  const client = new OpenAI({ apiKey: key, baseURL: process.env.PAPERINSTRUMENTS_BASE_URL || 'https://api.paperinstruments.com/v1' });
  return {
    model,
    where: 'cloud',
    async complete(messages, withTools) {
      const res = await client.chat.completions.create({
        model, messages, reasoning_effort: effort, max_completion_tokens: 8192,
        ...(withTools && { tools: [{ type: 'function', function: ASK_LOCAL }] }),
      });
      const msg = res.choices[0].message;
      const u = res.usage || {};
      return {
        content: msg.content || '',
        calls: (msg.tool_calls || []).map(c => {
          let args = {};
          try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
          return { id: c.id, name: c.function.name, args };
        }),
        echo: { role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls && { tool_calls: msg.tool_calls }) },
        toolMessage: (call, out) => ({ role: 'tool', tool_call_id: call.id, content: out }),
        usage: {
          input: u.prompt_tokens || 0, cached: u.prompt_tokens_details?.cached_tokens || 0,
          output: u.completion_tokens || 0, reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
        },
      };
    },
  };
}

export async function digest(dir, { cloud = false, dryRun = false, effort = 'high', log = console.log } = {}) {
  const sd = stateDir(dir);
  const plan = readJSON(join(sd, 'plan.json'), null);
  if (!plan) throw new Error('no plan yet: run `slothdesk scan` first');

  const today = new Date().toLocaleDateString('en-CA');
  const fx = facts(plan, today);
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Today is ${today}.\nUpcoming dates: ${JSON.stringify(fx.upcoming)}\n` +
      `Secret or private files: ${JSON.stringify(fx.lock)}\nThe whole pile: ${JSON.stringify(manifest(plan))}` },
  ];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outbound = join(sd, 'outbound', `${stamp}.json`);
  const model = cloud ? CLOUD_MODEL : (process.env.SLOTHDESK_DIGEST_MODEL || LOCAL_MODEL);
  const audit = { model, where: cloud ? 'cloud' : 'local', sent: [structuredClone(messages)], toolCalls: [] };

  if (dryRun) {
    writeJSON(outbound, audit);
    log(`dry run: nothing sent. This is everything the writer would see:\n${outbound}`);
    return { outbound };
  }

  const writer = cloud ? cloudWriter(model, effort) : localWriter(model);
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0, requests: 0 };
  const t0 = Date.now();
  let note = '';
  for (;;) {
    const r = await writer.complete(messages, audit.toolCalls.length < MAX_TOOL_CALLS);
    usage.requests++;
    for (const k of ['input', 'cached', 'output', 'reasoning']) usage[k] += r.usage[k] || 0;
    messages.push(r.echo);
    if (!r.calls.length) { note = r.content; break; }

    for (const call of r.calls) {
      const t = Date.now();
      const out = audit.toolCalls.length >= MAX_TOOL_CALLS ? 'tool budget used up; write the note now'
        : await askLocal(plan, call.args).catch(e => `error: ${e.message}`);
      audit.toolCalls.push({ ...call.args, answer: out, localSeconds: +((Date.now() - t) / 1000).toFixed(1) });
      log(`  ask_local ${call.args.file_id}: ${call.args.question}\n    -> ${out}`);
      messages.push(r.toolMessage(call, out));
    }
  }

  const run = { at: new Date().toISOString(), where: writer.where, model, ...(cloud && { effort }), files: plan.files.length,
    toolCalls: audit.toolCalls.length, seconds: +((Date.now() - t0) / 1000).toFixed(1), ...usage,
    usd: cloud ? +cost(usage).toFixed(6) : 0 };
  audit.run = run;
  writeJSON(outbound, audit);
  mkdirSync(sd, { recursive: true });
  appendFileSync(join(sd, 'costs.jsonl'), JSON.stringify(run) + '\n');

  const footer = `\n\n---\n<sub>${run.files} files · ${run.toolCalls} local look-ups · written by ${model} ` +
    `${cloud ? `in the cloud · ${run.input.toLocaleString()} tokens in, ${run.output.toLocaleString()} out · $${run.usd.toFixed(4)}`
      : `on this laptop in ${run.seconds}s · nothing left the machine`}</sub>\n`;
  const full = `${note.trim()}\n\n${render(fx)}${footer}`;
  const notePath = join(sd, `digest-${today}.md`);
  writeFileSync(notePath, full);
  return { note: full, notePath, run, outbound };
}
