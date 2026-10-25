// Local model calls through Ollama. Nothing in this file talks to the internet.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
export const LOCAL_MODEL = process.env.SLOTHDESK_MODEL || 'gemma4:e4b';

export const FOLDERS = ['code', 'chat', 'dashboard', 'docs', 'web', 'design', 'finance', 'identity',
  'work', 'travel', 'learning', 'social', 'games', 'apps', 'media', 'archives', 'installers', 'misc'];
export const PROMPT_VERSION = 5;

async function chat(content, { images, json = true } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_MODEL,
      stream: false,
      think: false,
      ...(json && { format: 'json' }),
      keep_alive: '30m',
      options: { temperature: 0.2, num_ctx: 6144 },
      messages: [{ role: 'user', content, ...(images && { images }) }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const out = (await res.json()).message.content;
  if (!json) return out.trim();
  try { return JSON.parse(out); } catch { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); }
}

// Downscale to a 1024px JPEG so a 4 GB GPU keeps up. GIFs and WebPs come out as their first frame.
function imageB64(path) {
  const dir = mkdtempSync(join(tmpdir(), 'slothdesk-'));
  try {
    const out = join(dir, 'x.jpg');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path, '-frames:v', '1',
      '-vf', "scale='min(1024,iw)':-2", out]);
    return readFileSync(out).toString('base64');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function pdfText(path, pages = 2) {
  try {
    return execFileSync('pdftotext', ['-l', String(pages), path, '-'], { maxBuffer: 8 << 20 })
      .toString().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch { return ''; }
}

const shape = day => `The file is from ${day}. If a date in it has no year, use the first such date on or after ${day}.
Folders: finance = bills, bank statements, fines, receipts, tax. identity = ID cards and documents. travel = tickets and bookings.
work = resumes, offer letters, work documents. docs = other documents and papers. web = articles and web pages. social = social media posts.
games = games and game development. apps = app or software screens that fit nothing else. Use misc only as a last resort.
Reply with JSON only:
{
  "slug": "3-6 lowercase words joined by hyphens saying what this is. Only include a year if the content is about that year, as digits. No personal names, account or id numbers",
  "folder": one of ${FOLDERS.map(f => `"${f}"`).join(', ')},
  "summary": "one plain sentence about what it is. No personal names, emails, numbers, ids or amounts",
  "dates": [{"date": "YYYY-MM-DD", "what": "a deadline, due date, event or appointment the owner must act on or attend. Not when the file was made, published or covers"}],
  "actions": ["something the owner may need to do because of this file, short"],
  "personal": true if it shows an identity document, bank, tax, salary, medical, travel booking with a passenger name, or private chat details,
  "secret": true if it shows a password, a recovery or seed phrase, backup or 2FA codes, an API key, token or private key
}
Use [] when there are no dates or actions. Only list dates that are clearly in the file. A clock time like 10:30 is not a date.`;

export function describeImage(path, day) {
  return chat(`Describe what this image itself shows, so it can be given a good file name.\n${shape(day)}`,
    { images: [imageB64(path)] });
}

export function describeText(name, text, day) {
  return chat(`You are filing a messy Downloads folder. This is the start of a document whose file name is "${name}".\n` +
    `---\n${text.slice(0, 3500)}\n---\n${shape(day)}`);
}

export function describeByName(name, size, day) {
  return chat(`You are filing a messy Downloads folder. You only know this file's name and size; do not guess its contents beyond that.\n` +
    `name: "${name}"\nsize: ${size} bytes\n${shape(day)}`);
}

// Used by the cloud agent's ask_local tool. The answer is scrubbed by the caller.
export function answer(question, { text, imagePath }) {
  const rules = 'Answer in at most two sentences. Never include personal names, emails, account or id numbers, ' +
    'addresses, or amounts; describe them generically instead (for example "a bank account number"). ' +
    'Dates are allowed. If the file does not say, answer "not stated".';
  if (imagePath) return chat(`${rules}\nQuestion about this image: ${question}`, { images: [imageB64(imagePath)], json: false });
  return chat(`${rules}\nDocument:\n---\n${text.slice(0, 5000)}\n---\nQuestion: ${question}`, { json: false });
}
