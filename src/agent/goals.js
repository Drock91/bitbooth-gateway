/**
 * GOALS.md parser + updater.
 * Source of truth is the markdown file; this module reads/writes it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATH = 'GOALS.md';

/**
 * @typedef {Object} Goal
 * @property {string} id
 * @property {'P0'|'P1'|'P2'} priority
 * @property {'open'|'in_progress'|'done'|'blocked'} status
 * @property {number} estimateMinutes
 * @property {string} title
 * @property {string} [closedAt]
 */

const ROW_RE =
  /^\|\s*(G-\d+)\s*\|\s*(P0|P1|P2)\s*\|\s*(open|in_progress|done|blocked)\s*\|\s*(\d+)m\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]+?)\s*\|)?\s*$/;

/**
 * Parse all goals from a GOALS.md string.
 * @param {string} md
 * @returns {Goal[]}
 */
export function parseGoals(md) {
  const goals = [];
  for (const line of md.split('\n')) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    goals.push({
      id: m[1],
      priority: m[2],
      status: m[3],
      estimateMinutes: Number(m[4]),
      title: m[5].trim(),
      closedAt: m[6]?.trim() || undefined,
    });
  }
  return goals;
}

/**
 * Read + parse GOALS.md.
 * @param {string} [filePath]
 * @returns {Promise<Goal[]>}
 */
export async function loadGoals(filePath = DEFAULT_PATH) {
  const md = await readFile(path.resolve(filePath), 'utf8');
  return parseGoals(md);
}

/**
 * Select the next goal to work on per the tick policy.
 * 1. in_progress (resume)
 * 2. top open P0 within budget
 * 3. top open P1 within budget
 * @param {Goal[]} goals
 * @param {number} budgetMinutes
 * @returns {Goal | null}
 */
export function pickNext(goals, budgetMinutes = 60) {
  const inProg = goals.find((g) => g.status === 'in_progress');
  if (inProg) return inProg;
  const open = goals.filter((g) => g.status === 'open' && g.estimateMinutes <= budgetMinutes);
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  open.sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id),
  );
  return open[0] ?? null;
}

/**
 * Count goals by status.
 * @param {Goal[]} goals
 */
export function countByStatus(goals) {
  const counts = { open: 0, in_progress: 0, done: 0, blocked: 0 };
  for (const g of goals) counts[g.status] = (counts[g.status] ?? 0) + 1;
  return counts;
}

/**
 * Raw append of a new goal row to Active table. Simple line splice.
 * @param {string} md
 * @param {Omit<Goal,'closedAt'>} goal
 */
export function appendGoal(md, goal) {
  const row = `| ${goal.id} | ${goal.priority} | ${goal.status} | ${goal.estimateMinutes}m | ${goal.title} |`;
  // Insert before first blank line following "## Active".
  const lines = md.split('\n');
  let idxActive = lines.findIndex((l) => l.trim() === '## Active');
  if (idxActive === -1) throw new Error('GOALS.md missing ## Active section');
  // find last table row after ## Active
  let insertAt = idxActive + 1;
  for (let i = idxActive + 1; i < lines.length; i++) {
    if (lines[i].startsWith('##')) break;
    if (lines[i].startsWith('|') && lines[i].match(/^\|\s*G-\d+/)) insertAt = i + 1;
  }
  lines.splice(insertAt, 0, row);
  return lines.join('\n');
}

/**
 * Overwrite GOALS.md.
 * @param {string} md
 * @param {string} [filePath]
 */
export async function saveGoals(md, filePath = DEFAULT_PATH) {
  await writeFile(path.resolve(filePath), md, 'utf8');
}
