// Decides what a model may look at. Runs before any model call.
//
//   secret   -> never opened by any model, never summarized. Filed by name only.
//   personal -> read by the local model only; only a generic summary may leave.
//   ordinary -> read by the local model; a scrubbed summary may leave.

import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const SECRET_NAMES = [
  [/recovery[-_ ]?codes?/i, 'recovery codes'],
  [/rootkey|accesskeys?|credentials?\.(csv|json)|aws.*keys?/i, 'cloud credentials'],
  [/\.(pem|key|p12|pfx|ppk|kdbx|keystore|jks|asc|gpg)$/i, 'private key or keystore'],
  [/^id_(rsa|ed25519|ecdsa|dsa)/i, 'SSH key'],
  [/(^|[._-])env($|\.)|^\.env/i, 'environment file'],
  [/(secret|token|passwords?|seed[-_ ]?phrase|wallet)/i, 'secret'],
];

const PERSONAL_NAMES = [
  [/pan[-_ ]?card|aadhaa?r|passport|voter|driving[-_ ]?licen[cs]e/i, 'identity document'],
  [/statement|bank|passbook|cheque|upi/i, 'bank record'],
  [/\btax|itr|form[-_ ]?16|\b(ais|tis)\b|_ais_|_tis\b|gst/i, 'tax record'],
  [/challan|(^|[^a-z])fines?([^a-z]|$)|penalty/i, 'fine or government notice'],
  [/payslip|salary|offer[-_ ]?letter|appraisal/i, 'employment record'],
  [/resume|\bcv\b/i, 'resume'],
  [/invoice|receipt|bill/i, 'receipt'],
  [/medical|prescription|lab[-_ ]?report|insurance/i, 'health or insurance record'],
];

const SECRET_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'API key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/^(?:\s*[a-z0-9]{4,6}[- ][a-z0-9]{4,6}\s*\n){6,}/im, 'recovery codes'],
];

const TEXTY = new Set(['.txt', '.csv', '.json', '.md', '.env', '.ini', '.conf', '.yaml', '.yml', '.toml', '']);

export function classify(path) {
  const name = basename(path);
  for (const [re, why] of SECRET_NAMES) if (re.test(name)) return { level: 'secret', why };

  // Peek at small text files for secret signatures. The content is never stored.
  const ext = extname(name).toLowerCase();
  if (TEXTY.has(ext) && statSync(path).size < 512 * 1024) {
    const head = readFileSync(path, 'utf8').slice(0, 64 * 1024);
    for (const [re, why] of SECRET_CONTENT) if (re.test(head)) return { level: 'secret', why };
  }

  for (const [re, why] of PERSONAL_NAMES) if (re.test(name)) return { level: 'personal', why };
  return { level: 'ordinary', why: null };
}

// Some personal data only shows up inside the document.
const PERSONAL_CONTENT = [
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/, 'PAN number'],
  [/\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/, 'Aadhaar-like number'],
  [/\b(IFSC|account (no|number)|a\/c)\b/i, 'bank details'],
  [/\b(passport no|date of birth|DOB)\b/i, 'identity details'],
  [/\b(PNR|booking ref(erence)?|passenger)\b/i, 'travel booking'],
];

export function personalInText(text) {
  for (const [re, why] of PERSONAL_CONTENT) if (re.test(text)) return why;
  return null;
}

// Last line of defence for anything that leaves the machine.
export function scrub(s) {
  if (s == null) return s;
  return String(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, '[id]')
    .replace(/\b[A-Za-z0-9_]*\d[A-Za-z0-9_]*\d[A-Za-z0-9_]*\d[A-Za-z0-9_]*\d[A-Za-z0-9_]*/g, m =>
      /^(?:19|20)\d{2}$/.test(m) ? m : '[number]')
    .replace(/[₹$€£]\s?[\d,.]+/g, '[amount]');
}
