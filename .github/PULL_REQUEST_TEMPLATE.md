## What this changes

<!-- One paragraph. The "why" matters more than the "what" — the diff shows what. -->

## Verification

How did you confirm this works?

- [ ] `npm run lint` passes (zero warnings)
- [ ] `npm test` passes (all 3,306+ tests)
- [ ] `npm audit --audit-level=high` returns 0
- [ ] `npm run build` succeeds
- [ ] `npm run cdk:synth` succeeds
- [ ] OpenAPI updated (`openapi.yaml`) if routes changed
- [ ] No TypeScript files (`.ts`, `.tsx`, `tsconfig*.json`) introduced
- [ ] If touching payment flows: I ran the security-review checklist

## Real payment proof (if touching x402 / payment flows)

<!-- Drop a tx hash or a screenshot from the earnings dashboard. We don't trust untested payment code. -->

## Anything reviewers should know

<!-- Surprising design choices, things you considered and rejected, follow-ups planned for a separate PR -->
