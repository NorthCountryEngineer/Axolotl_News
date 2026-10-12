# Costs and the no-cost boundary

The two applications, infrastructure definitions, integration package, and checks were prepared locally. No AWS provisioning, paid build, Cloudflare change, account upgrade, paid Canva operation, or subscription was performed. No paid editor service is required.

**A production AWS deployment is not guaranteed free.** The local Axolotl editor and local Core checks create no AWS resources. Once you choose to deploy, both requests and stored/running resources can be billed. `AXOLOTL_ENABLE_AWS_DEPLOYMENT=true` permits the Axolotl build recipe; it is an acknowledgment, not a cost cap. Even failed builds can consume billable time.

## The default NCE deployment

| Component | Charges to account for | Control in this project |
| --- | --- | --- |
| Core ECS Fargate | Allocated task CPU/memory while running, public IPv4, traffic | One small task with web and worker containers; no autoscaling policy |
| Core RDS PostgreSQL | Database instance hours even when idle, storage, backups/snapshots | Single AZ, small instance; separate deliberate retention/deletion |
| Core HTTPS ALB | Load balancer hours/capacity, public IPv4 | One origin; the default Amplify login hostname is separate |
| Core Amplify SSR proxy | Builds, compute requests/duration, hosting/transfer | Branch-only compute role and production builds; no preview branches |
| Axolotl static Amplify | Builds, storage, serving traffic | One production branch; no server rendering for the blog |
| Axolotl HTTP API/Lambda | API requests and function duration | 5 requests/second target and 10 burst; optional reserved concurrency 2 where quota permits; these are not dollar limits |
| DynamoDB | On-demand requests and draft/published storage | Two small content tables; images/video stay in S3 |
| S3 | Upload/media storage, requests, publishing copies, downloads | Private bucket; bounded signing and explicit old-media cleanup |
| Secrets/logs/artifacts | Secrets Manager, SSM/KMS calls, CloudWatch logs, ECR images, code bucket | Limited IAM access; standard SecureString; finite API log retention |
| Existing domain | `axolotl.news` renewal | Keep Cloudflare DNS and current registration; no Route 53 zone needed |

Core's database, ALB, and running Fargate task create an **idle baseline** even if nobody visits. Setting Core `DesiredCount=0` stops its tasks; it does not remove the database or ALB. Deleting the Axolotl frontend does not stop its API or remove retained data.

Anonymous media viewers do not need AWS accounts, and S3 storage/traffic is billed to the bucket owner. Public access, short-lived signed URLs, on-demand databases, and throttling do not make traffic free. [S3 billing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/BucketBilling.html), [DynamoDB capacity modes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/capacity-mode.html).

Video traffic can dominate a family site: a 20 MB clip viewed 1,000 times is roughly 20 GB of transfer before cache effects. Re-publishing can create another stored media copy. That is a planning example, not a price quotation. Unpublish before **Clear old media** and keep the article unpublished until cleanup ends; unpublishing alone does not delete stored media.

## Fargate versus Lambda for Core

The packaged Core is Django/Gunicorn plus a durable polling worker and PostgreSQL. Fargate runs those processes directly. Its bill follows allocated CPU/memory and running time; ordinary Lambda bills primarily by invocations and duration and has a 15-minute invocation limit. Lambda is a good fit for the small Axolotl request API; moving the existing Core into Lambda is a further application redesign. [AWS Fargate or Lambda decision guide](https://docs.aws.amazon.com/pdfs/decision-guides/latest/fargate-or-lambda/fargate-or-lambda.pdf), [Lambda limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

| Choice | Financial implication | Engineering implication |
| --- | --- | --- |
| Current Core Fargate + RDS + ALB | Always-on task/database/load-balancer baseline; predictable capacity for light traffic | Runs current web and worker architecture; small topology is not highly available |
| A future Lambda Core web adapter | Web compute can approach zero while idle; RDS storage/instance still contributes | Needs Django request adaptation, cold-start evaluation, and a different worker execution model |
| Lambda Core with pooled PostgreSQL connections | Potentially controls connection churn; a database proxy is another charged service | Must review transaction/session assumptions, concurrency, and live authorization behavior |

For a rough monthly comparison, use about 730 hours multiplied by your Region's hourly task allocation, DB instance, ALB, and public IPv4 rates, then add storage, traffic, requests, builds, logs, and secrets. For Lambda, calculate request count and execution GB-seconds, then add the database/network/hosting services that remain. The Fargate worker shares the task's allocated resources; it does not create a second task in this template. RDS Proxy can pool Lambda-driven database connections, but is not provisioned here. [RDS Proxy usage scenarios](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-best-practices.usage-scenarios.html).

An illustrative **partial baseline**, using the verified official pricing examples and 730 hours/month, is:

| Running component | Calculation | Approximate monthly amount |
| --- | --- | --- |
| One Linux ARM64 task, 0.25 vCPU and 1 GB RAM | 730 × 3,600 × (0.25 × $0.0000089944 + 1 × $0.0000009889) | $8.51 |
| ALB base hours | 730 × $0.0225; load balancer capacity units extra | $16.43 |
| At least two ALB IPv4 addresses plus one task address | 3 × 730 × $0.005 | $10.95 |
| **Partial subtotal** | **Before the database and other services** | **$35.89** |

This is **not a $36/month total deployment**. RDS PostgreSQL `db.t4g.micro`, its 20 GB storage/backups, Secrets Manager, Amplify builds/SSR/hosting, ALB capacity, logs, requests, transfer, tax, and any retained data are additional. Region-specific rates, credits, and future price changes can alter the result. Quote the actual RDS configuration and all services in your AWS console/calculator before choosing to deploy. Sources: [Fargate pricing example](https://aws.amazon.com/fargate/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/), [public IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

The current choice keeps managed container/database services and the existing Core architecture; it is not an assertion of the lowest possible AWS bill. This deployment avoids a NAT gateway by giving the Fargate task a public IP with restricted security groups. Switching to private task egress through NAT gateways or VPC endpoints changes both network design and costs.

## Check the existing AWS account

Open **Billing and Cost Management → Bills, Free Tier, Credits**. Eligibility depends on account creation date, plan, services, and remaining credits. AWS changed its new-account program in July 2025; existing accounts do not necessarily have a fresh allowance. [AWS Free Tier FAQ](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html).

The documented Free account plan has limited duration and service availability; it ends after six months or credit depletion. A paid plan can charge beyond credits. This project neither upgrades your account nor verifies eligibility. If zero spending remains absolute, keep both applications local and do not execute the AWS runbook. [AWS account plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html).

## Optional budget notifications

These instructions are for you to choose, not settings created by this work. Review any monitoring feature's current cost disclosures; do not add a paid subscription, SMS integration, or budget action merely to run the application.

1. Open **Billing and Cost Management → Budgets → Create budget**.
2. Select **Use a template (simplified) → Zero spend budget** for notification when spending exceeds Free Tier limits.
3. Use a parent-controlled email address and an account-wide scope; generated costs may lack an app tag.
4. If you approve a nonzero allowance later, set actual and forecast notifications for your own monthly threshold.

**Budgets are not hard caps.** AWS documents budget updates up to three times daily, usually 8–12 hours apart. Charges can accrue before an alert, and continue afterward. API rate settings, reserved concurrency, client upload limits, and a deployment acknowledgment are also not account spending caps. [Budget templates](https://docs.aws.amazon.com/cost-management/latest/userguide/budget-templates.html), [budget update delays](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

## Keep the footprint deliberate

- Disable branch discovery and PR previews; enable a build only for reviewed changes. Grant Core's secret-reading compute role only to its production branch.
- Keep paid AI/model adapters, SMS, managed security add-ons, video transcoding, NAT gateways, and extra monitoring disabled unless you independently approve them.
- Resize photos and use short compressed videos. Preserve original media outside the application for recovery.
- Choose retention/backups explicitly. The NCE Axolotl template retains both DynamoDB tables and S3 on deletion; they can keep charging. Core retains a database snapshot on teardown. Retention is not a zero-cost backup policy.
- Review **Bills** after the initial deployment and when publishing a widely shared video. Limit log retention and remove obsolete artifacts deliberately.

Follow [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) for the default NCE deployment and teardown. The optional Cognito/Gen 2 alternative in [DEPLOYMENT.md](DEPLOYMENT.md) also adds Cognito/AppSync usage and has different, destructive data-deletion defaults. Disabling auto-build or changing DNS is not proof that backends, snapshots, uploads, images, and logs have been removed.
