import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJSON, stateDir, writeJSON } from './scan.mjs';

export function apply(dir, { log = console.log } = {}) {
  const sd = stateDir(dir);
  const plan = readJSON(join(sd, 'plan.json'), null);
  if (!plan) throw new Error('no plan yet: run `slothdesk scan` first');

  const moves = [];
  for (const f of plan.files) {
    const from = join(dir, f.from);
    const to = join(dir, f.to);
    if (!existsSync(from)) { log(`skip  ${f.from} (gone)`); continue; }
    if (statSync(from).size !== f.size) { log(`skip  ${f.from} (changed since scan)`); continue; }
    if (existsSync(to)) { log(`skip  ${f.from} (${f.to} already exists)`); continue; }
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    moves.push({ from: f.from, to: f.to });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeJSON(join(sd, 'journal', `${stamp}.json`), { at: new Date().toISOString(), moves });
  log(`moved ${moves.length} of ${plan.files.length} files. Undo with: slothdesk undo ${dir}`);
  return moves;
}

export function undo(dir, { log = console.log } = {}) {
  const jd = join(stateDir(dir), 'journal');
  const last = existsSync(jd) && readdirSync(jd).filter(n => n.endsWith('.json') && !n.includes('.undone')).sort().pop();
  if (!last) throw new Error('nothing to undo');

  const { moves } = readJSON(join(jd, last));
  let back = 0;
  for (const m of [...moves].reverse()) {
    const from = join(dir, m.to);
    const to = join(dir, m.from);
    if (!existsSync(from) || existsSync(to)) { log(`skip  ${m.to}`); continue; }
    renameSync(from, to);
    back++;
    // Tidy up folders that apply created and that are now empty.
    for (let d = dirname(from); d.startsWith(dir + '/') && existsSync(d) && !readdirSync(d).length; d = dirname(d)) rmdirSync(d);
  }
  renameSync(join(jd, last), join(jd, last.replace('.json', '.undone.json')));
  log(`put back ${back} of ${moves.length} files.`);
  return back;
}
