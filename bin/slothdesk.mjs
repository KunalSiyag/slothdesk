#!/usr/bin/env node
import { resolve } from 'node:path';
import { scan } from '../src/scan.mjs';
import { apply, undo } from '../src/apply.mjs';
import { digest } from '../src/digest.mjs';

const HELP = `slothdesk: sort a messy folder with a local Gemma, then get a two-minute note about it.

  slothdesk scan   <dir> [--limit N]   look at every file locally and write a plan (nothing moves)
  slothdesk plan   <dir>               show the plan
  slothdesk apply  <dir>               move files into <dir>/sorted/ as planned
  slothdesk undo   <dir>               put the last apply back
  slothdesk digest <dir> [--dry-run]   write the two-minute note with the local model
  slothdesk digest <dir> --cloud [--effort low|high|max]
                                       let Ultramarine write it from a scrubbed list instead

Local model: SLOTHDESK_MODEL (default gemma4:e4b) via Ollama; SLOTHDESK_DIGEST_MODEL for the note.
Cloud model: PAPERINSTRUMENTS_API_KEY, only for digest --cloud.`;

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    flags[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  } else pos.push(rest[i]);
}
const dir = resolve(pos[0] || '.');

try {
  if (cmd === 'scan') {
    const plan = await scan(dir, { limit: flags.limit ? +flags.limit : Infinity });
    const n = plan.files.length;
    const locked = plan.files.filter(f => f.level === 'secret').length;
    const priv = plan.files.filter(f => f.level === 'personal').length;
    const dupes = plan.files.filter(f => f.duplicateOf).length;
    console.log(`\nplanned ${n} files in ${plan.seconds}s (${plan.modelCalls} new local model calls). ` +
      `${locked} secret, ${priv} private, ${dupes} duplicates. Nothing has moved yet.\n` +
      `look: slothdesk plan ${pos[0] || '.'}    do it: slothdesk apply ${pos[0] || '.'}`);
  } else if (cmd === 'plan') {
    const { readJSON, stateDir } = await import('../src/scan.mjs');
    const plan = readJSON(`${stateDir(dir)}/plan.json`, null);
    if (!plan) throw new Error('no plan yet: run `slothdesk scan` first');
    for (const f of plan.files) console.log(`${f.level === 'secret' ? '🔒' : f.level === 'personal' ? '👤' : f.duplicateOf ? '⧉ ' : '  '} ${f.from}\n     -> ${f.to}`);
  } else if (cmd === 'apply') apply(dir);
  else if (cmd === 'undo') undo(dir);
  else if (cmd === 'digest') {
    const r = await digest(dir, { cloud: !!flags.cloud, dryRun: !!flags['dry-run'], effort: flags.effort || 'high' });
    if (r.note) console.log(`\n${r.note}\nsaved to ${r.notePath}\nwhat the writer saw: ${r.outbound}`);
  } else console.log(HELP);
} catch (err) {
  console.error(`slothdesk: ${err.message}`);
  process.exit(1);
}
