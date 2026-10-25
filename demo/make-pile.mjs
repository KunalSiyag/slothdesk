// Builds a fake but realistic messy Downloads folder in demo/pile, so the demo never
// touches anyone's real files. Every name, number and key in here is made up.
// Needs Google Chrome (headless) for the PDFs and screenshots.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const pile = join(here, 'pile');
const tmp = join(here, '.build');
rmSync(pile, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(pile, { recursive: true });
mkdirSync(tmp, { recursive: true });

const chrome = process.env.CHROME || 'google-chrome';
const page = (body, css = '') => `<!doctype html><meta charset="utf-8"><style>
  body{font:15px/1.45 Inter,Arial,sans-serif;margin:40px;color:#1d2330} h1{font-size:22px;margin:0 0 4px}
  table{border-collapse:collapse;width:100%;margin-top:14px} td,th{border:1px solid #ccd;padding:6px 8px;text-align:left}
  .muted{color:#667} .big{font-size:28px;font-weight:700} ${css}</style>${body}`;

function pdf(name, html) {
  const src = join(tmp, `${name}.html`);
  writeFileSync(src, html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(pile, name)}`, src], { stdio: 'ignore' });
}

function shot(name, html, w = 1280, h = 800) {
  const src = join(tmp, `${name}.html`);
  writeFileSync(src, html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${join(pile, name)}`, src], { stdio: 'ignore' });
}

// Documents
pdf('download (3).pdf', page(`<h1>Brightline Power Distribution Co.</h1><div class="muted">Electricity bill · October 2026</div>
  <table><tr><th>Consumer no.</th><td>DEMO-0001</td></tr><tr><th>Name</th><td>A. Sample</td></tr>
  <tr><th>Units consumed</th><td>312 kWh</td></tr><tr><th>Amount payable</th><td>₹2,486.00</td></tr>
  <tr><th>Due date</th><td>30 October 2026</td></tr><tr><th>After due date</th><td>₹2,536.00 (late fee ₹50)</td></tr></table>
  <p>Pay online or at any collection centre before the due date to avoid disconnection.</p>`));

pdf('echallan_receipt.pdf', page(`<h1>e-Challan</h1><div class="muted">Traffic Police · Notice</div>
  <table><tr><th>Challan no.</th><td>DEMO-0002</td></tr><tr><th>Vehicle</th><td>XX 00 AB 1234</td></tr>
  <tr><th>Offence</th><td>Parking in a no-parking zone</td></tr><tr><th>Fine</th><td>₹500</td></tr>
  <tr><th>Status</th><td><b>UNPAID</b></td></tr><tr><th>Pay by</th><td>5 November 2026</td></tr></table>
  <p>If unpaid by the date above the case is sent to the virtual court.</p>`));

pdf('AccountStatement_Oct.pdf', page(`<h1>Northwind Bank</h1><div class="muted">Statement of account · 01 Oct 2026 to 23 Oct 2026</div>
  <p>Account holder: A. Sample · PAN ABCDE1234F · A/c no. 001234567890 · IFSC NWBK0001234</p>
  <table><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th></tr>
  <tr><td>02 Oct</td><td>Salary</td><td></td><td>85,000.00</td></tr><tr><td>05 Oct</td><td>Rent</td><td>22,000.00</td><td></td></tr>
  <tr><td>11 Oct</td><td>Streamflix subscription</td><td>649.00</td><td></td></tr><tr><td>18 Oct</td><td>Credit card bill</td><td>14,210.00</td><td></td></tr></table>`));

pdf('Ticket_DevConf_Bengaluru.pdf', page(`<h1>DevConf Bengaluru 2026</h1><div class="muted">Your ticket</div>
  <p class="big">14 November 2026 · 9:00 AM</p><p>Venue: Hall 3, City Convention Centre</p>
  <p>Bring a photo ID. Badge pickup closes at 10:30 AM. Workshop seats must be confirmed by 7 November 2026 from the attendee portal.</p>`));

pdf('Rental_Agreement_Renewal.pdf', page(`<h1>Notice of lease renewal</h1>
  <p>Your rental agreement for Flat 2B ends on <b>30 November 2026</b>. To renew for another 11 months, sign the attached agreement and return it
  by <b>15 November 2026</b>. The new monthly rent is ₹23,100, a 5% increase.</p><p>If you do not plan to renew, give 30 days' notice in writing.</p>`));

const resume = page(`<h1>A. Sample</h1><div class="muted">Software engineer · sample@example.com</div>
  <h3>Experience</h3><p>Backend engineer, Example Corp, 2024 to now. Go, Postgres, Kubernetes.</p>
  <h3>Projects</h3><p>A screen recorder in Rust. A city simulation run by language models.</p>`);
pdf('Resume.pdf', resume);
copyFileSync(join(pile, 'Resume.pdf'), join(pile, 'Resume (1).pdf'));
pdf('Resume (3).pdf', resume.replace('2024 to now', '2024 to now. Led the billing migration'));

pdf('2410.01234v2.pdf', page(`<h1>Speculative Decoding for Small Local Models</h1><div class="muted">arXiv preprint</div>
  <h3>Abstract</h3><p>We show that a 1B draft model speeds up a 4B target model by 1.8x on consumer GPUs with 4 GB of memory,
  with no change to output quality. We release code and benchmarks.</p>`));

// Secrets, all fake (the AWS key is the one from AWS's own documentation)
writeFileSync(join(pile, 'rootkey.csv'), 'Access key ID,Secret access key\nAKIAIOSFODNN7EXAMPLE,wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n');
writeFileSync(join(pile, 'github-recovery-codes.txt'), Array.from({ length: 16 }, (_, i) => `${(0x1a2b3 + i * 7919).toString(16).slice(0, 5)}-${(0x9f8e7 - i * 104729).toString(16).slice(-5)}`).join('\n') + '\n');
writeFileSync(join(pile, 'notes (2).txt'), 'call landlord about the leaking tap\nrenew the gym membership before 1 Nov 2026\nask Priya for the conference slides\n');
writeFileSync(join(pile, 'dev-server_key.pem'), '-----BEGIN OPENSSH PRIVATE KEY-----\nTHIS-IS-A-FAKE-KEY-FOR-THE-DEMO\n-----END OPENSSH PRIVATE KEY-----\n');

// Screenshots
const term = `body{background:#0d1117;color:#c9d1d9;font:16px/1.5 'JetBrains Mono',monospace;margin:28px} .r{color:#ff7b72} .b{color:#79c0ff} .g{color:#7ee787}`;
shot('Screenshot_2026-10-21_23-14-07.png', page(`<div class="g">$ cargo build --release</div><div class="r">error[E0499]: cannot borrow \`frames\` as mutable more than once at a time</div>
  <div class="b">  --> src/capture.rs:88:21</div><pre>86 |     let first = &mut frames[0];
87 |     let last = &mut frames[len - 1];
   |                     ^^^^^^ second mutable borrow occurs here</pre><div class="r">error: could not compile \`recorder\` (bin "recorder") due to 1 previous error</div>`, term));

const chat = `body{background:#0b141a;color:#e9edef;margin:0;padding:24px 140px} .m{max-width:60%;padding:10px 14px;border-radius:10px;margin:10px 0}
  .in{background:#202c33} .out{background:#005c4b;margin-left:auto} .t{font-size:12px;color:#8696a0} h2{font:600 18px Arial;border-bottom:1px solid #222;padding-bottom:10px}`;
shot('Screenshot_2026-10-22_09-02-41.png', page(`<h2>Landlord</h2><div class="m in">Hi, reminder that the plumber is coming Saturday 26 Oct at 11am for the tap. Please be home.</div>
  <div class="m out">Sure, I'll be there. Also got the renewal notice, will send it back next week.</div>
  <div class="m in">Thanks. Need it signed by 15 Nov please.</div><div class="t">Today 9:02 AM</div>`, chat));

const dash = `body{background:#111217;color:#ccccdc;font-family:Arial;margin:20px} .row{display:flex;gap:14px} .p{background:#181b1f;border:1px solid #2a2d33;border-radius:6px;padding:14px;flex:1}
  .k{font-size:40px;font-weight:700} .bad{color:#f2495c} .ok{color:#73bf69} svg{width:100%;height:220px}`;
shot('Screenshot_2026-10-23_01-47-55.png', page(`<h2>checkout-service · last 1h</h2><div class="row"><div class="p">p99 latency<div class="k bad">2.41 s</div></div>
  <div class="p">error rate<div class="k bad">6.8%</div></div><div class="p">orders/min<div class="k ok">1,204</div></div></div>
  <div class="p" style="margin-top:14px">p99 latency<svg viewBox="0 0 600 200"><polyline fill="none" stroke="#f2495c" stroke-width="3"
  points="0,170 60,165 120,168 180,160 240,150 300,90 360,40 420,35 480,60 540,50 600,45"/></svg></div>`, dash));

shot('Screenshot_2026-10-24_18-30-12.png', page(`<div style="max-width:560px;margin:auto;border:1px solid #dde;border-radius:14px;padding:20px">
  <b>Sky Lines</b> <span class="muted">· Booking confirmed</span><p class="big">BLR → DEL</p><p>Fri 13 Nov 2026 · 06:10 → 08:55</p>
  <p>Passenger: A. Sample · PNR: XYZ9Q1 · Seat 14C</p><p class="muted">Web check-in opens 48 hours before departure.</p></div>`));

shot('Screenshot_2026-10-24_22-05-33.png', page(`<div style="max-width:600px;margin:auto;border:1px solid #eee;border-radius:16px;padding:18px">
  <b>Sample Dev</b> <span class="muted">@sampledev · 2h</span><p style="font-size:18px">Hot take: the best feature you can ship this week is deleting
  the three you never finished.</p><p class="muted">142 replies · 1.2K reposts · 9.8K likes</p></div>`));

shot('Screenshot_2026-10-19_16-11-02.png', page(`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">${['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#1d3557']
  .map(c => `<div style="background:${c};height:200px;border-radius:10px;color:#fff;padding:10px;font:600 14px Arial">${c}</div>`).join('')}</div>
  <p class="muted">Palette ideas for the landing page · v3</p>`));

// A secret that only shows up inside the image. Twelve made-up words, not a real wallet.
shot('Screenshot_2026-10-20_00-12-44.png', page(`<div style="max-width:620px;margin:auto;background:#141821;color:#e8eaf0;border-radius:16px;padding:26px">
  <h2 style="margin:0 0 6px">Back up your wallet</h2><p style="color:#9aa3b5">Write these 12 words down in order. Anyone with this phrase can take your funds.</p>
  <ol style="columns:3;font:600 17px monospace;line-height:2">${['orbit', 'velvet', 'canyon', 'mango', 'thrift', 'lunar', 'pepper', 'galaxy', 'harbor', 'violin', 'saddle', 'ember']
  .map(w => `<li>${w}</li>`).join('')}</ol><p style="color:#f2a65a">Never share it. Never take a screenshot of it.</p></div>`, 'body{background:#0b0e14}'));

copyFileSync(join(pile, 'Screenshot_2026-10-23_01-47-55.png'), join(pile, 'Screenshot_2026-10-23_01-47-55 (copy).png'));

// Things that are only names
writeFileSync(join(pile, 'zoom_amd64.deb'), Buffer.alloc(1024));
writeFileSync(join(pile, 'project-assets-final-FINAL.zip'), Buffer.alloc(2048));

// Give them plausible download times so they sort like a real folder.
const now = Date.now() / 1000;
for (const [i, n] of ['download (3).pdf', 'Resume.pdf', 'Resume (1).pdf', 'zoom_amd64.deb', 'rootkey.csv'].entries())
  utimesSync(join(pile, n), now - (40 - i) * 86400, now - (40 - i) * 86400);

rmSync(tmp, { recursive: true, force: true });
console.log(`made a fake messy folder in ${pile}`);
