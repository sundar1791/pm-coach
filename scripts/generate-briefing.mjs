#!/usr/bin/env node
/**
 * Daily AGI briefing generator.
 * Uses Claude API (with built-in web search) to research and compile the briefing,
 * saves it to briefings/, commits + pushes, then emails it via Resend.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY
 *   RESEND_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ── Config ────────────────────────────────────────────────────────────────────

const RECIPIENT_EMAIL = 'sundar1791@gmail.com';
const FROM_EMAIL      = 'AGI Briefing <onboarding@resend.dev>';
const MODEL           = 'claude-opus-4-8';

const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const { ANTHROPIC_API_KEY, RESEND_API_KEY } = process.env;
if (!ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY');
if (!RESEND_API_KEY)    throw new Error('Missing RESEND_API_KEY');

// ── Generate briefing ─────────────────────────────────────────────────────────

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const PROMPT = `\
You are a research assistant delivering a daily briefing on humanity's progress toward AGI.
Today's date is ${today}.

Search the web for the following topics:
1. AGI artificial general intelligence breakthrough today
2. AI research paper breakthrough this week
3. OpenAI DeepMind Google Anthropic announcement today
4. Large language model reasoning capability advance
5. AI safety alignment news today

From all gathered information compile the TOP 10 most significant developments related to AGI \
progress. For each item include:
1. **Headline** — clear, descriptive title
2. **Source & Date**
3. **Why it matters for AGI** — 2-3 sentences on the significance
4. **Link** (if available)

Rank by importance. Open with a one-sentence executive summary of the single most important \
development of the day.

Format the entire output as clean Markdown starting with:
# AGI Progress Briefing — ${today}`;

console.log(`[${today}] Generating briefing via Claude API (model: ${MODEL})…`);

const response = await client.messages.create({
  model:      MODEL,
  max_tokens: 8000,
  tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
  messages:   [{ role: 'user', content: PROMPT }],
});

const briefingMd = response.content
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('\n')
  .trim();

if (!briefingMd) throw new Error('Claude returned no text content');

// ── Save to repo ──────────────────────────────────────────────────────────────

const outputDir  = 'briefings';
const outputPath = `${outputDir}/agi-briefing-${today}.md`;

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, briefingMd + '\n');
console.log(`Saved → ${outputPath}`);

// ── Git commit + push ─────────────────────────────────────────────────────────

try {
  execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
  execSync('git config user.name  "github-actions[bot]"');
  execSync(`git add "${outputPath}"`);
  execSync(`git commit -m "AGI briefing ${today}"`, { stdio: 'inherit' });
  execSync('git push origin daily-ai-updates',       { stdio: 'inherit' });
  console.log('Pushed to origin/daily-ai-updates');
} catch (err) {
  // Swallow "nothing to commit" errors; re-throw real failures
  if (!err.message.includes('nothing to commit')) {
    console.warn('Git step warning:', err.message);
  }
}

// ── Convert Markdown → HTML for email ────────────────────────────────────────

function mdToHtml(md) {
  const lines   = md.split('\n');
  const htmlLines = [];
  let inPara    = false;

  const flush = () => { if (inPara) { htmlLines.push('</p>'); inPara = false; } };
  const inline = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#0f3460">$1</a>');

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line) {
      flush();
      continue;
    }
    if (/^# (.+)/.test(line)) {
      flush();
      htmlLines.push(`<h1 style="font-size:1.6em;border-bottom:2px solid #1a1a2e;padding-bottom:8px;color:#1a1a2e;margin-top:0">${inline(line.replace(/^# /, ''))}</h1>`);
      continue;
    }
    if (/^## (.+)/.test(line)) {
      flush();
      htmlLines.push(`<h2 style="font-size:1.2em;color:#16213e;margin-top:2em;border-bottom:1px solid #eee;padding-bottom:4px">${inline(line.replace(/^## /, ''))}</h2>`);
      continue;
    }
    if (/^### (.+)/.test(line)) {
      flush();
      htmlLines.push(`<h3 style="font-size:1em;color:#0f3460;margin-top:1.4em">${inline(line.replace(/^### /, ''))}</h3>`);
      continue;
    }
    if (/^---+$/.test(line)) {
      flush();
      htmlLines.push('<hr style="border:none;border-top:1px solid #ddd;margin:1.8em 0">');
      continue;
    }
    if (/^[0-9]+\. /.test(line)) {
      flush();
      htmlLines.push(`<p style="margin:.4em 0">${inline(line)}</p>`);
      continue;
    }
    // Normal paragraph text
    if (!inPara) { htmlLines.push('<p style="margin:.5em 0;line-height:1.7">'); inPara = true; }
    else htmlLines.push('<br>');
    htmlLines.push(inline(line));
  }
  flush();
  return htmlLines.join('\n');
}

const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AGI Briefing — ${today}</title>
</head>
<body style="font-family:Georgia,serif;max-width:680px;margin:32px auto;color:#222;padding:0 20px">
  ${mdToHtml(briefingMd)}
  <p style="font-size:.8em;color:#999;margin-top:3em;border-top:1px solid #eee;padding-top:1em">
    AGI Daily Briefing · automated via pm-coach ·
    <a href="https://github.com/sundar1791/pm-coach/tree/daily-ai-updates/briefings" style="color:#999">archive</a>
  </p>
</body>
</html>`;

// ── Send email via Resend ─────────────────────────────────────────────────────

console.log(`Sending email to ${RECIPIENT_EMAIL}…`);

const res = await fetch('https://api.resend.com/emails', {
  method:  'POST',
  headers: {
    Authorization:  `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from:    FROM_EMAIL,
    to:      [RECIPIENT_EMAIL],
    subject: `AGI Briefing — ${today}`,
    html:    htmlBody,
    text:    briefingMd,
  }),
});

if (!res.ok) {
  const body = await res.text();
  throw new Error(`Resend API ${res.status}: ${body}`);
}

const { id } = await res.json();
console.log(`Email sent ✓  (Resend id: ${id})`);

// ── Print briefing to stdout ──────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
console.log(briefingMd);
console.log('─'.repeat(60));
