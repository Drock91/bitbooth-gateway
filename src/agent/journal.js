/**
 * MEMORY.md append-only journal writer.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATH = 'MEMORY.md';
const ENTRY_ANCHOR = '\n---\n\n*agent:';

/**
 * @typedef {Object} JournalEntry
 * @property {number} session
 * @property {string} date   ISO yyyy-mm-dd
 * @property {string} tag
 * @property {string} goalId
 * @property {string} goalTitle
 * @property {'closed'|'progressed'|'blocked'|'idle'} outcome
 * @property {number} filesChanged
 * @property {number} testsBefore
 * @property {number} testsAfter
 * @property {number|null} coverageBefore
 * @property {number|null} coverageAfter
 * @property {'clean'|string} lint
 * @property {'clean'|'skipped'|'failed'} cdk
 * @property {string} learning
 * @property {string[]} followups
 * @property {string} [nextSuggested]
 */

/** @param {JournalEntry} e */
export function renderEntry(e) {
  const cov =
    e.coverageBefore !== null && e.coverageAfter !== null
      ? `coverage ${e.coverageBefore}% → ${e.coverageAfter}%`
      : 'coverage n/a';
  const followups = e.followups.length ? e.followups.join(', ') : '(none)';
  return [
    '',
    `## Session ${String(e.session).padStart(3, '0')} — ${e.date} — ${e.tag}`,
    `- **Goal worked**: ${e.goalId} (${e.goalTitle})`,
    `- **Outcome**: ${e.outcome}`,
    `- **Files changed**: ${e.filesChanged}`,
    `- **Tests**: ${e.testsBefore} before → ${e.testsAfter} after; ${cov}`,
    `- **Lint**: ${e.lint}`,
    `- **CDK synth**: ${e.cdk}`,
    `- **Learning**: ${e.learning}`,
    `- **Followups opened**: ${followups}`,
    `- **Next suggested**: ${e.nextSuggested ?? '(none)'}`,
    '',
  ].join('\n');
}

/**
 * Append an entry above the template anchor line.
 * @param {JournalEntry} entry
 * @param {string} [filePath]
 */
export async function appendEntry(entry, filePath = DEFAULT_PATH) {
  const abs = path.resolve(filePath);
  const current = await readFile(abs, 'utf8');
  const rendered = renderEntry(entry);
  const anchorIdx = current.indexOf(ENTRY_ANCHOR);
  let next;
  if (anchorIdx === -1) {
    // No template — append to end.
    next = current + '\n' + rendered;
  } else {
    // Insert newest entry below header, above anchor.
    const [head, ...rest] = current.split(ENTRY_ANCHOR);
    const firstEntryIdx = head.indexOf('## Session');
    if (firstEntryIdx === -1) {
      next = head + rendered + ENTRY_ANCHOR + rest.join(ENTRY_ANCHOR);
    } else {
      next =
        head.slice(0, firstEntryIdx) +
        rendered.trimStart() +
        '\n---\n\n' +
        head.slice(firstEntryIdx) +
        ENTRY_ANCHOR +
        rest.join(ENTRY_ANCHOR);
    }
  }
  await writeFile(abs, next, 'utf8');
}
