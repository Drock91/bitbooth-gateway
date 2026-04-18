#!/usr/bin/env node
/**
 * x402 Autopilot Supervisor
 *
 * Runs AFTER each tick and decides whether the agent is making real progress
 * toward the north star or spinning in a polish loop. If stuck, it writes
 * .agent/STUCK.md (which halts the next tick) and optionally opens a GitHub
 * issue to escalate to a human.
 *
 * Exit codes:
 *   0  → tick is healthy, continue
 *   1  → STUCK — caller should halt ticks until STUCK.md is removed
 *
 * Decision signals (any HARD or >= 2 SOFT triggers STUCK):
 *   SOFT  last N completed goals are all `polish`
 *   SOFT  north star state has not changed in N ticks
 *   SOFT  coverage plateau (>=90% and delta <0.5% over N ticks)
 *   HARD  next open goal is `polish` while deployed_staging=false
 *
 * Side effects on STUCK:
 *   - writes .agent/STUCK.md with full diagnosis + instructions to resume
 *   - opens a GitHub issue via `gh` (only if GH_AUTOPILOT_ISSUES=true)
 *   - appends one JSON line to .agent/SUPERVISOR_LOG.jsonl (always)
 *   - appends one JSON line to .agent/NORTH_STAR_HISTORY.jsonl (always)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parseGoals, pickNext } from '../../src/agent/goals.js';

const REPO_ROOT = process.cwd();
const AGENT_DIR = path.join(REPO_ROOT, '.agent');
const NORTH_STAR_PATH = path.join(AGENT_DIR, 'NORTH_STAR.json');
const NORTH_STAR_HISTORY_PATH = path.join(AGENT_DIR, 'NORTH_STAR_HISTORY.jsonl');
const SUPERVISOR_LOG_PATH = path.join(AGENT_DIR, 'SUPERVISOR_LOG.jsonl');
const STUCK_PATH = path.join(AGENT_DIR, 'STUCK.md');
const GOALS_PATH = path.join(REPO_ROOT, 'GOALS.md');
const STATE_PATH = path.join(AGENT_DIR, 'state.json');

const WINDOW = Number(process.env.SUPERVISOR_WINDOW || 5);
const COVERAGE_PLATEAU_MIN = Number(process.env.SUPERVISOR_COV_MIN || 90);
const COVERAGE_PLATEAU_DELTA = Number(process.env.SUPERVISOR_COV_DELTA || 0.5);

const DEFAULT_NORTH_STAR = {
  schemaVersion: 1,
  deployed_staging: false,
  deployed_prod: false,
  staging_url: null,
  prod_url: null,
  real_402_issued_count: 0,
  real_usdc_settled_count: 0,
  first_real_tenant: false,
  demo_ready: false,
  last_cdk_deploy_at: null,
  last_updated: null,
  blockers: [],
};

function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[supervisor ${ts}] ${msg}\n`);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendJsonl(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

function readJsonl(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Classify a goal title into one of four categories. Deterministic — no LLM.
 *   ship    moves the north star forward (deploy, live URL, real payment, demo)
 *   unblock removes a blocker (missing creds, broken build, blocker flag)
 *   harden  security/reliability work that will run in production
 *   polish  tests, coverage, lint, format, refactor, docs (default bucket)
 *
 * Order matters: polish is checked FIRST so that coverage/test work can't
 * accidentally be reclassified as `harden` just because the target file
 * happens to contain a keyword like "dlq" or "fraud".
 */
function classifyGoal(title) {
  if (!title) return 'unknown';
  const t = title.toLowerCase();

  // Polish first — strong signals win regardless of what the target file is.
  if (
    /\bcoverage\b|\buncovered\b|\bcover (remaining|missing|gap|branch|line)|\bbranch gap\b|\badd (unit |integration |e2e )?tests?\b|\bwrite (unit |integration |e2e )?tests?\b|\btest (coverage|gap|helper)|\blint\b|\bprettier\b|\bformat(ting|ter)?\b|\brefactor\b|\brename\b|\breadme\b|\bchangelog\b|\bdocstring\b|\btypo\b|\bcleanup\b|\bcomment\b|\bjsdoc\b|\bextract.*template|\bsplit.*file|\bconvention\b|\b<?= ?300.?line/.test(
      t,
    )
  ) {
    return 'polish';
  }

  if (
    /\bcdk (bootstrap|deploy)\b|\bdeploy(ed|ing)?\b.*(staging|prod|aws|live)|\bgo[\s-]?live\b|\bfirst[\s-]deploy\b|\bbootstrap.*aws\b|\bdomain\b|\bdns\b|\broute ?53\b|\bacm\b.*cert|\bship\b.*(to|endpoint|staging|prod)|\breal\b.*(402|usdc|payment|tenant|settlement)|\bdemo\b.*(ready|endpoint|flow)|\be2e\b.*flow|\blive\b.*(url|endpoint|test)/.test(
      t,
    )
  ) {
    return 'ship';
  }

  if (
    /\bmissing\b.*(secret|cred|key|config|env)|\bfix\b.*broken.*build|\bunblock\b|\bblocker\b|\bcredentials?\b.*(not|missing|required)|\bconnect\b.*aws/.test(
      t,
    )
  ) {
    return 'unblock';
  }

  if (
    /\bsecurity\b|\bauth(entic|oriz)\b|\brate[\s-]?limit(ing|er|ed)?\b|\bwaf\b|\bsecret\b.*rotat|\bincident\b|\bcircuit[\s-]?break\b|\bidempotency\b|\bfraud\b|\bhmac\b|\breplay\b|\bpoint[\s-]?in[\s-]?time\b|\bpitr\b|\bbackup\b|\brecover/.test(
      t,
    )
  ) {
    return 'harden';
  }

  return 'polish';
}

function recentDoneGoals(count) {
  try {
    const text = fs.readFileSync(GOALS_PATH, 'utf8');
    const rows = text
      .split('\n')
      .filter((line) => /^\|\s*G-\d+\s*\|\s*P[012]\s*\|\s*done\s*\|/.test(line))
      .map((line) => {
        const parts = line.split('|').map((s) => s.trim());
        return { id: parts[1], title: parts[5] || '' };
      });
    return rows.slice(-count);
  } catch {
    return [];
  }
}

function currentOpenGoal() {
  try {
    const text = fs.readFileSync(GOALS_PATH, 'utf8');
    const goal = pickNext(parseGoals(text));
    if (!goal) return null;
    return { id: goal.id, title: goal.title };
  } catch {
    return null;
  }
}

/**
 * Try to recover NORTH_STAR.json from git history when the file is missing
 * on disk. Walks recent commits on the current branch, then origin/main, and
 * returns the most recent committed version with at least one truthy progress
 * flag (deployed_staging, demo_ready, etc.) or non-zero counter. This avoids
 * silently overwriting real shipped state with all-false defaults whenever
 * the file gets deleted (worktree swap, branch checkout, fresh clone).
 */
function recoverNorthStarFromGit() {
  const refs = ['HEAD', 'origin/x402-api-gateway', 'origin/main'];
  for (const ref of refs) {
    try {
      const raw = execSync(`git show ${ref}:.agent/NORTH_STAR.json`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = JSON.parse(raw);
      const looksReal =
        parsed.deployed_staging === true ||
        parsed.deployed_prod === true ||
        parsed.demo_ready === true ||
        parsed.first_real_tenant === true ||
        Number(parsed.real_402_issued_count) > 0 ||
        Number(parsed.real_usdc_settled_count) > 0;
      if (looksReal) {
        log(`recovered NORTH_STAR from ${ref}`);
        return parsed;
      }
    } catch {
      /* ref doesn't exist or file not present in that ref */
    }
  }
  return null;
}

function ensureNorthStar() {
  if (!fs.existsSync(NORTH_STAR_PATH)) {
    // Before silently resetting to all-false defaults (which trips the
    // polish-vs-ship hard gate forever), check git history for the most
    // recent committed NORTH_STAR with real progress flags. This is the
    // failsafe that survives worktree swaps + fresh clones.
    const recovered = recoverNorthStarFromGit();
    if (recovered) {
      const restored = { ...recovered, last_updated: new Date().toISOString() };
      fs.writeFileSync(NORTH_STAR_PATH, JSON.stringify(restored, null, 2));
      return restored;
    }
    const init = { ...DEFAULT_NORTH_STAR, last_updated: new Date().toISOString() };
    fs.writeFileSync(NORTH_STAR_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  return readJson(NORTH_STAR_PATH, { ...DEFAULT_NORTH_STAR });
}

/**
 * Hash of the fields that represent "real progress toward the north star".
 * Any change flips the hash, which breaks the plateau-detection window.
 *
 * Includes blocker count so that resolving a named blocker (shrinking the
 * blockers[] array) is recognized as progress even when the payment counters
 * stay flat — otherwise pre-prod guardrail work (key flush, IAM policies,
 * quota prep) looks like polish to the supervisor and triggers a false halt.
 */
function northStarHash(ns, state) {
  const {
    deployed_staging,
    deployed_prod,
    staging_url,
    prod_url,
    real_402_issued_count,
    real_usdc_settled_count,
    first_real_tenant,
    demo_ready,
  } = ns;
  const blockerCount = Array.isArray(ns.blockers) ? ns.blockers.length : 0;
  const doneGoals = state?.doneGoals ?? 0;
  return JSON.stringify({
    deployed_staging,
    deployed_prod,
    staging_url,
    prod_url,
    real_402_issued_count,
    real_usdc_settled_count,
    first_real_tenant,
    demo_ready,
    blockerCount,
    doneGoals,
  });
}

function writeStuckReport({ reasons, recentGoals, northStar, state, currentGoal, tick }) {
  const classifyLine = (g) => `- **${g.id}** \`${classifyGoal(g.title)}\` — ${g.title}`;

  const md = `# Autopilot Stuck — tick #${tick}

**Status:** HALTED — waiting for human guidance
**Detected at:** ${new Date().toISOString()}

## Why the supervisor halted

${reasons.map((r) => `- ${r}`).join('\n')}

## North star state

\`\`\`json
${JSON.stringify(northStar, null, 2)}
\`\`\`

## Next open goal the agent was going to work on

${
  currentGoal
    ? `- **${currentGoal.id}**: ${currentGoal.title}\n- Classification: \`${classifyGoal(
        currentGoal.title,
      )}\``
    : '- (no open goal picked)'
}

## Last ${recentGoals.length} completed goals (newest last)

${recentGoals.map(classifyLine).join('\n') || '- (none)'}

## Project metrics snapshot

- Coverage: ${state.coveragePct ?? '?'}%
- Tests: ${state.testCount ?? '?'}
- Test files: ${state.testFileCount ?? '?'}
- Done goals: ${state.doneGoals ?? '?'}
- Open goals: ${state.openGoals ?? '?'}
- Bundle size: ${state.bundleSizeKb ?? '?'} KB

## What I think I need from you, D-rock

1. **Unblock deployment** — nothing else moves until \`cdk deploy\` can run. Likely missing:
   - AWS credentials mounted into the container (\`AWS_ACCESS_KEY_ID\`, \`AWS_SECRET_ACCESS_KEY\`, \`AWS_REGION\`)
   - \`cdk bootstrap\` run at least once for the target account/region
   - A staging domain or \`X402_STAGING_URL\` env var
2. **Seed ship-category goals** — replace the polish backlog with concrete deploy goals (e.g., \`cdk bootstrap\`, \`cdk deploy staging\`, smoke-test against live URL)
3. **Approve the next move** — reply with ONE of:
   - \`ship\` → unblock deployment and I handle staging + verification
   - \`pause\` → stay halted (default)
   - \`override N\` → override the supervisor for N ticks (not recommended)

## To resume

\`\`\`bash
# Delete the STUCK marker to resume immediately:
rm .agent/STUCK.md

# OR close the linked GitHub issue (if one was created).
\`\`\`

---
*Generated by scripts/agent/supervisor.js — classification is deterministic keyword-based, not LLM.*
`;

  fs.writeFileSync(STUCK_PATH, md);
  return md;
}

function openGitHubIssue(title, body) {
  if (process.env.GH_AUTOPILOT_ISSUES !== 'true') {
    log('gh issue creation skipped (GH_AUTOPILOT_ISSUES != true)');
    return null;
  }

  try {
    const existing = execSync(
      'gh issue list --label autopilot-stuck --state open --json number --limit 1',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    if (existing && existing.trim() !== '[]') {
      log(`existing open autopilot-stuck issue found — skipping create: ${existing.trim()}`);
      return null;
    }

    const bodyFile = path.join(AGENT_DIR, 'STUCK_ISSUE_BODY.tmp');
    fs.writeFileSync(bodyFile, body);

    const out = execSync(
      `gh issue create --title ${JSON.stringify(title)} --body-file ${JSON.stringify(
        bodyFile,
      )} --label autopilot-stuck`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    try {
      fs.unlinkSync(bodyFile);
    } catch {
      /* ignore */
    }
    log(`gh issue created: ${out.trim()}`);
    return out.trim();
  } catch (err) {
    log(`gh issue create failed: ${err.message}`);
    return null;
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = { tick: 0, dryRun: false, force: null };
  for (const arg of argv) {
    if (arg.startsWith('--tick=')) out.tick = Number(arg.split('=')[1]) || 0;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--force-stuck') out.force = 'stuck';
    else if (arg === '--force-healthy') out.force = 'healthy';
  }
  return out;
}

function main() {
  const args = parseArgs();

  if (fs.existsSync(STUCK_PATH) && !args.force) {
    log('already STUCK — exiting 1 without re-diagnosing');
    appendJsonl(SUPERVISOR_LOG_PATH, {
      ts: new Date().toISOString(),
      tick: args.tick,
      decision: 'still_stuck',
    });
    process.exit(1);
  }

  const northStar = ensureNorthStar();
  const state = readJson(STATE_PATH, {});
  const recentGoals = recentDoneGoals(WINDOW);
  const currentGoal = currentOpenGoal();

  const snapshot = {
    ts: new Date().toISOString(),
    tick: args.tick,
    hash: northStarHash(northStar, state),
    deployed_staging: Boolean(northStar.deployed_staging),
    deployed_prod: Boolean(northStar.deployed_prod),
    coveragePct: state.coveragePct ?? null,
    doneGoals: state.doneGoals ?? null,
    blockerCount: Array.isArray(northStar.blockers) ? northStar.blockers.length : 0,
  };

  if (!args.dryRun) {
    appendJsonl(NORTH_STAR_HISTORY_PATH, snapshot);
  }

  const history = readJsonl(NORTH_STAR_HISTORY_PATH).slice(-(WINDOW + 1));

  const reasons = [];
  const categories = recentGoals.map((g) => classifyGoal(g.title));

  const allPolish = recentGoals.length >= WINDOW && categories.every((c) => c === 'polish');
  if (allPolish) {
    reasons.push(
      `All last ${WINDOW} completed goals classified as \`polish\` (tests/coverage/lint/format/docs). No \`ship\`, \`unblock\`, or \`harden\` work in the window.`,
    );
  }

  if (history.length >= WINDOW + 1) {
    const old = history[0];
    if (old.hash === snapshot.hash) {
      reasons.push(
        `North star state has not changed in ${WINDOW} ticks. \`deployed_staging=${northStar.deployed_staging}\`, \`real_402_issued_count=${northStar.real_402_issued_count}\`, \`real_usdc_settled_count=${northStar.real_usdc_settled_count}\`.`,
      );
    }
  }

  // Coverage plateau check. Skip when already at 100% — you can't grow past
  // the ceiling and flagging "100% → 100%" as a plateau is a false positive
  // that would halt every tick once full coverage is achieved.
  const covNow = Number(state.coveragePct ?? 0);
  if (covNow >= COVERAGE_PLATEAU_MIN && covNow < 100 && history.length >= WINDOW + 1) {
    const oldCov = Number(history[0].coveragePct ?? 0);
    const delta = covNow - oldCov;
    if (Math.abs(delta) < COVERAGE_PLATEAU_DELTA) {
      reasons.push(
        `Coverage plateau: ${covNow}% now vs ${oldCov}% ${WINDOW} ticks ago (delta ${delta.toFixed(2)}%). Already above ${COVERAGE_PLATEAU_MIN}% — further coverage work is diminishing returns while nothing is shipped.`,
      );
    }
  }

  let hardViolation = false;
  if (currentGoal && !northStar.deployed_staging) {
    const cat = classifyGoal(currentGoal.title);
    if (cat === 'polish') {
      hardViolation = true;
      reasons.push(
        `HARD VIOLATION: next goal **${currentGoal.id}** ("${currentGoal.title}") classifies as \`polish\` but \`deployed_staging=false\`. Nothing should be polished before it ships.`,
      );
    }
  }

  let isStuck = hardViolation || reasons.length >= 2;
  if (args.force === 'stuck') isStuck = true;
  if (args.force === 'healthy') isStuck = false;

  const decision = {
    ts: new Date().toISOString(),
    tick: args.tick,
    categories,
    reasons,
    northStarHash: snapshot.hash,
    coveragePct: covNow,
    currentGoalId: currentGoal?.id ?? null,
    decision: isStuck ? 'STUCK' : 'continue',
    dryRun: args.dryRun,
  };

  if (!args.dryRun) {
    appendJsonl(SUPERVISOR_LOG_PATH, decision);
  } else {
    log(`dry-run decision: ${JSON.stringify(decision, null, 2)}`);
  }

  if (!isStuck) {
    log(
      `tick #${args.tick} — healthy (soft_signals=${reasons.length}, categories=[${categories.join(',')}])`,
    );
    process.exit(0);
  }

  log(`tick #${args.tick} — STUCK: ${reasons.length} reasons, hard=${hardViolation}`);

  if (args.dryRun) {
    log('dry-run — not writing STUCK.md or opening issue');
    process.exit(1);
  }

  const body = writeStuckReport({
    reasons,
    recentGoals,
    northStar,
    state,
    currentGoal,
    tick: args.tick,
  });
  openGitHubIssue(`Autopilot stuck at tick #${args.tick} — needs guidance`, body);
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectRun) {
  main();
}

export {
  classifyGoal,
  recentDoneGoals,
  currentOpenGoal,
  ensureNorthStar,
  northStarHash,
  parseArgs,
  writeStuckReport,
  openGitHubIssue,
  readJson,
  readJsonl,
  appendJsonl,
  main,
};
