/**
 * Agent state read/write. Local file is canonical; DDB is optional mirror.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PATH = '.agent/state.json';

/**
 * @typedef {Object} AgentState
 * @property {number} schemaVersion
 * @property {string} updatedAt
 * @property {number} sessionCount
 * @property {string} lastSessionAt
 * @property {string} [lastSessionTag]
 * @property {number} openGoals
 * @property {number} inProgressGoals
 * @property {number} doneGoals
 * @property {number} blockedGoals
 * @property {string|null} currentGoalId
 * @property {number} testCount
 * @property {number} testFileCount
 * @property {number} coveragePct
 * @property {number} lintWarnings
 * @property {number|null} bundleSizeKb
 * @property {number} streakDays
 */

/** @returns {Promise<AgentState>} */
export async function loadState(filePath = DEFAULT_PATH) {
  const raw = await readFile(path.resolve(filePath), 'utf8');
  return JSON.parse(raw);
}

/**
 * @param {AgentState} state
 * @param {string} [filePath]
 */
export async function saveState(state, filePath = DEFAULT_PATH) {
  const abs = path.resolve(filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** @param {AgentState} prev @param {Partial<AgentState>} patch @returns {AgentState} */
export function applyPatch(prev, patch) {
  return { ...prev, ...patch, updatedAt: new Date().toISOString() };
}
