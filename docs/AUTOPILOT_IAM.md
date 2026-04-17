# Autopilot IAM — Scoped AWS Credentials

How the autopilot container gets AWS access for `cdk deploy` without broad permissions.

## Design

The container needs exactly one capability: **run `cdk deploy` against the
x402 stacks in us-east-2**. CDK v2 bootstrap creates four roles in the target
account that handle all CloudFormation, S3, and IAM operations. The autopilot
container only needs `sts:AssumeRole` on those bootstrap roles — it never
touches AWS APIs directly.

```
┌─────────────────────┐
│  autopilot container │
│  (x402-autopilot-   │
│   deployer role)     │
└────────┬────────────┘
         │ sts:AssumeRole
         ▼
┌─────────────────────────────────────────────┐
│  CDK Bootstrap Roles (us-east-2)            │
│  ├─ cdk-*-deploy-role       (orchestrate)   │
│  ├─ cdk-*-file-publishing   (S3 uploads)    │
│  ├─ cdk-*-lookup-role       (context reads) │
│  └─ cdk-*-cfn-exec-role     (CFN creates)   │
└─────────────────────────────────────────────┘
         │
         ▼  CloudFormation creates/updates
┌─────────────────────────────────────────────┐
│  x402 Resources (us-east-2 only)            │
│  DDB · Lambda · API GW · WAF · Secrets · CW │
└─────────────────────────────────────────────┘
```

## Policy

The autopilot IAM role has two statements:

1. **AssumeCdkBootstrapRoles** — `sts:AssumeRole` on the 4 CDK bootstrap roles,
   scoped to us-east-2 by ARN.
2. **ReadStackStatus** — `cloudformation:DescribeStacks` + `GetTemplate` on
   `X402-*` stacks so `cdk diff` works without assuming the full deploy role.

That's it. The role **cannot**:

- Access any region other than us-east-2
- Modify IAM policies, users, or roles
- Access Secrets Manager directly
- Delete stacks (CDK deploy role doesn't have `DeleteStack`)
- Touch any non-x402 resource

## Setup

### 1. Bootstrap CDK (one-time)

```bash
npx cdk bootstrap aws://ACCOUNT_ID/us-east-2 --app 'node infra/app.js'
```

### 2. Create the autopilot deployer role

```bash
node scripts/ops/setup-autopilot-iam.js --account ACCOUNT_ID
# Use --dry-run first to review the policies
```

### 3. Mount credentials into the container

Add to `.env` (never committed — already in `.gitignore`):

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-2
CDK_DEFAULT_ACCOUNT=123456789012
CDK_DEFAULT_REGION=us-east-2
STAGE=staging
```

The `docker-compose.autopilot.yml` already loads `.env` via `env_file`.
No docker-compose changes needed — the env vars flow through automatically.

### Alternative: EC2 instance profile

If running on EC2, skip access keys entirely. Attach the
`x402-autopilot-deployer` role as an instance profile. The AWS SDK in the
container picks up credentials from IMDS automatically.

### Alternative: GitHub Actions OIDC

For CI/CD (cd-staging.yml, cd-prod.yml), use the existing OIDC federation —
no long-lived keys needed. The workflows already configure this.

## Credential flow diagram

```
.env (host)
  │
  ▼ env_file: .env
docker-compose.autopilot.yml
  │
  ▼ environment injection
autopilot container
  │
  ▼ AWS SDK credential chain
npx cdk deploy --app 'node infra/app.js'
  │
  ▼ sts:AssumeRole → cdk-*-deploy-role
CloudFormation stack update
```

## Security constraints

| Constraint                 | Enforcement                                              |
| -------------------------- | -------------------------------------------------------- |
| Region-locked to us-east-2 | ARN-scoped resources on AssumeRole                       |
| No direct API access       | Only sts:AssumeRole + cfn:Describe                       |
| No secret reads            | Autopilot never calls SecretsManager; CFN exec role does |
| No IAM mutation            | Policy has no iam:\* actions                             |
| Credential rotation        | Access keys rotated via `scripts/ops/rotate-secrets.js`  |
| Audit trail                | CloudTrail logs all AssumeRole calls                     |
