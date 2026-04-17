#!/usr/bin/env bash
# Secret scanner for autopilot commits.
#
# Scans the diff from the last tick for common secret patterns. Exits 0 if
# clean, 1 if a suspected secret is found. Called by autopilot-entrypoint.sh
# AFTER claude runs, BEFORE the push. If red, the tick commit is reverted.
#
# This is a belt-and-suspenders guard — Claude has been told via CLAUDE_LOOP.md
# not to commit secrets, but regex-scanning the diff catches the obvious stuff.

set -u

SINCE_REF="${1:-HEAD~1}"   # diff against this ref
LOG_PREFIX="[secret-scan]"

# Patterns to reject in any committed diff. Deliberately conservative — we
# want false positives over false negatives.
#
# Each line: DESCRIPTION|EGREP_PATTERN
PATTERNS=(
  'AWS access key|AKIA[0-9A-Z]{16}'
  'AWS secret key|aws_secret_access_key\s*[:=]\s*["'\''][0-9a-zA-Z/+]{40}["'\'']'
  'Anthropic API key|sk-ant-[a-zA-Z0-9_-]{20,}'
  'OpenAI API key|sk-[a-zA-Z0-9]{32,}'
  'GitHub PAT (classic)|ghp_[a-zA-Z0-9]{36}'
  'GitHub fine-grained PAT|github_pat_[a-zA-Z0-9_]{22,}'
  'GitHub OAuth token|gho_[a-zA-Z0-9]{36}'
  'Slack token|xox[abprs]-[a-zA-Z0-9-]{10,}'
  'Stripe secret key|sk_live_[0-9a-zA-Z]{24,}'
  'Stripe test key|sk_test_[0-9a-zA-Z]{24,}'
  'Google API key|AIza[0-9A-Za-z_-]{35}'
  'RSA private key header|-----BEGIN RSA PRIVATE KEY-----'
  'OpenSSH private key header|-----BEGIN OPENSSH PRIVATE KEY-----'
  'Generic private key|-----BEGIN PRIVATE KEY-----'
  # Hex private key: 0x + 64 hex chars. Must appear in a private-key context,
  # not on lines that are obviously transaction/block hashes. Without a context
  # filter this pattern matches every tx hash on earth (same shape).
  'Hex private key (ethereum)|(privateKey|private_key|PRIVATE_KEY|secretKey|secret_key|WALLET_KEY|wallet_key)[^0-9a-fA-F]{0,10}0x[0-9a-fA-F]{64}'
  # BIP39 mnemonic: must appear in a mnemonic/seedPhrase context. A bare
  # "12 consecutive lowercase words" regex has an intolerable false-positive
  # rate — it matches normal English prose.
  'BIP39 mnemonic|(mnemonic|seedPhrase|seed_phrase|SEED_PHRASE|recoveryPhrase|recovery_phrase)[^a-z]{0,10}["'\'']?([a-z]+\s){11}[a-z]+'
  'JWT token|eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}'
  'Password assignment|password\s*[:=]\s*["'\''][^"'\'' ]{8,}["'\'']'
)

# Files we never want committed, even without secrets inside.
FORBIDDEN_FILES=(
  '\.env$'
  '\.env\.local$'
  '\.env\.production$'
  'id_rsa$'
  'id_ed25519$'
  'id_ecdsa$'
  '\.pem$'
  '\.p12$'
  '\.pfx$'
  'credentials\.json$'
  'service-account.*\.json$'
)

FOUND=0

# 1. Check for forbidden file names added or modified in the diff.
CHANGED_FILES="$(git diff --name-only "$SINCE_REF" 2>/dev/null || echo '')"
if [ -n "$CHANGED_FILES" ]; then
  while IFS= read -r file; do
    for forbid in "${FORBIDDEN_FILES[@]}"; do
      if echo "$file" | grep -qE "$forbid"; then
        echo "$LOG_PREFIX FORBIDDEN FILE committed: $file (pattern: $forbid)"
        FOUND=1
      fi
    done
  done <<< "$CHANGED_FILES"
fi

# 2. Scan the actual diff content for secret patterns.
DIFF="$(git diff "$SINCE_REF" -- . 2>/dev/null || echo '')"
if [ -n "$DIFF" ]; then
  for entry in "${PATTERNS[@]}"; do
    desc="${entry%%|*}"
    pat="${entry#*|}"
    # Only match lines ADDED (+) in the diff, ignore removals and context.
    MATCH="$(echo "$DIFF" | grep -E '^\+' | grep -vE '^\+\+\+' | grep -E -e "$pat" || true)"
    if [ -n "$MATCH" ]; then
      echo "$LOG_PREFIX SECRET DETECTED: $desc"
      echo "$LOG_PREFIX offending line(s):"
      echo "$MATCH" | head -3 | sed 's/^/  /'
      FOUND=1
    fi
  done
fi

if [ "$FOUND" -eq 1 ]; then
  echo "$LOG_PREFIX FAIL — commit contains secrets or forbidden files"
  exit 1
fi

echo "$LOG_PREFIX clean"
exit 0
