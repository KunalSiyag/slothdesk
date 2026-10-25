import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { classify, personalInText, scrub } from './sensitive.mjs';
import { FOLDERS, LOCAL_MODEL, PROMPT_VERSION, describeByName, describeImage, describeText, pdfText } from './gemma.mjs';

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const TEXT = new Set(['.txt', '.md', '.csv', '.json', '.log']);
const IN_PROGRESS = /\.(crdownload|part|partial|download)$/i;

export const stateDir = dir => join(dir, '.slothdesk');

export function readJSON(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function writeJSON(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function dayOf(name, mtime) {
  const m = name.match(/(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(mtime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const slugify = s => String(s || 'untitled').replace(/\[(number|id|email|link|amount)\]/g, '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 7).join('-') || 'untitled';

function kindOf(name) {
  const ext = extname(name).toLowerCase();
  if (IMAGE.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (TEXT.has(ext)) return 'text';
  return 'other';
}

async function describe(path, name, kind, size, day) {
  if (kind === 'image') return describeImage(path, day);
  if (kind === 'pdf') {
    const text = pdfText(path);
    if (!text) return describeByName(name, size, day); // scanned PDF with no text layer
    const d = await describeText(name, text, day);
    const hit = personalInText(text);
    if (hit) { d.personal = true; d.personalWhy = hit; }
    return d;
  }
  if (kind === 'text') return describeText(name, readFileSync(path, 'utf8'), day);
  return describeByName(name, size, day);
}

export async function scan(dir, { limit = Infinity, out = 'sorted', log = console.log } = {}) {
  const sd = stateDir(dir);
  const cache = readJSON(join(sd, 'cache.json'), {});
  const files = readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && !IN_PROGRESS.test(e.name))
    .map(e => ({ name: e.name, t: statSync(join(dir, e.name)).mtimeMs }))
    // Oldest first, then shortest name, so "Resume.pdf" is the original and "Resume (1).pdf" the copy.
    .sort((a, b) => a.t - b.t || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .map(e => e.name).slice(0, limit);

  const plan = { dir, out, model: LOCAL_MODEL, scannedAt: new Date().toISOString(), files: [] };
  const taken = new Set();
  const seen = new Map();
  const t0 = Date.now();
  let modelCalls = 0;

  for (const [i, name] of files.entries()) {
    const path = join(dir, name);
    const st = statSync(path);
    const kind = kindOf(name);
    const gate = classify(path);
    const hash = sha(path);
    const day = dayOf(name, st.mtimeMs);
    const ext = extname(name).toLowerCase();
    const f = { id: `f${i + 1}`, from: name, size: st.size, kind, day, sha256: hash, level: gate.level, why: gate.why };

    if (seen.has(hash)) {
      const orig = seen.get(hash);
      Object.assign(f, { duplicateOf: orig.id, folder: '_duplicates', slug: orig.slug, level: orig.level, why: orig.why });
    } else if (gate.level === 'secret') {
      // Never opened. Keeps its own name, moves somewhere you will notice it.
      Object.assign(f, { folder: '_lock-this-up', slug: null, summary: `a ${gate.why} file`, dates: [], actions: [] });
    } else {
      const key = `${hash}:${LOCAL_MODEL}:v${PROMPT_VERSION}`;
      const t = Date.now();
      let d = cache[key];
      if (!d) {
        try { d = await describe(path, name, kind, st.size, day); modelCalls++; }
        catch (err) { d = { slug: basename(name, ext), folder: 'misc', summary: 'could not be read', error: String(err.message || err) }; }
        d.seconds = +((Date.now() - t) / 1000).toFixed(1);
        cache[key] = d;
        writeJSON(join(sd, 'cache.json'), cache);
      }
      const personal = gate.level === 'personal' || d.personal === true;
      Object.assign(f, d.secret === true
        // The local model saw a secret inside the file. Treat it like a named secret from here on.
        ? { level: 'secret', why: 'secret shown inside the file', folder: '_lock-this-up', slug: 'secret-on-screen',
            summary: 'a file that shows a secret', dates: [], actions: [], seconds: d.seconds }
        : {
            level: personal ? 'personal' : 'ordinary',
            why: gate.why || d.personalWhy || (personal ? 'private details' : null),
            slug: slugify(scrub(d.slug)),
            folder: FOLDERS.includes(d.folder) ? d.folder : 'misc',
            summary: scrub(d.summary),
            dates: (d.dates || []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x?.date)).map(x => ({ date: x.date, what: scrub(x.what) })),
            actions: (d.actions || []).map(scrub).filter(Boolean).slice(0, 3),
            seconds: d.seconds,
          });
      seen.set(hash, f);
    }

    const stem = f.slug ? `${day}-${f.slug}${f.duplicateOf ? '-copy' : ''}` : basename(name, ext);
    let to = join(out, f.folder, `${stem}${ext}`);
    for (let n = 2; taken.has(to) || existsSync(join(dir, to)); n++) to = join(out, f.folder, `${stem}-${n}${ext}`);
    taken.add(to);
    f.to = to;
    plan.files.push(f);
    log(`[${String(i + 1).padStart(String(files.length).length)}/${files.length}] ${f.level === 'secret' ? 'LOCKED ' : ''}${name}\n      -> ${to}`);
  }

  plan.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  plan.modelCalls = modelCalls;
  writeJSON(join(sd, 'plan.json'), plan);
  return plan;
}
