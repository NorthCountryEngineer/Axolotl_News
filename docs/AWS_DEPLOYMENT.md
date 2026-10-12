# AWS deployment: NCE Core and Axolotl News

This is a runbook for a **future deployment that you choose to fund**. The application, infrastructure definitions, integration package, and deployment checks were prepared locally. No AWS resources, paid build, Cloudflare record, subscription, or account upgrade was created during this work. Do not run the cloud commands below while the original “no costs” condition remains in effect. Keeping both applications local is the only deployment option here that guarantees no AWS bill.

The default deployment uses **NCE Core for identity and live permissions**. The older Cognito/Amplify Gen 2 alternative is documented separately in [DEPLOYMENT.md](DEPLOYMENT.md); choose one backend for an Axolotl environment. Do not run its `ampx pipeline-deploy` when following this NCE runbook.

## What runs where

| Part | AWS deployment | Purpose |
| --- | --- | --- |
| Core public website | Amplify Hosting SSR compute, default Amplify hostname | Node proxy forwards the existing Django application over HTTPS; preserves its public issuer |
| Core application and jobs | One ECS Fargate task containing a web container and worker container | Runs Django/Gunicorn and the durable `core_worker` |
| Core database | Private, single-AZ RDS PostgreSQL | Stores accounts, organizations, permissions, integrations, and jobs |
| Core origin | HTTPS Application Load Balancer at `core-origin.axolotl.news` | Accepts the trusted proxy origin credential; this is an infrastructure hostname, not the Core login URL |
| Axolotl website | Static React/Vite build on Amplify Hosting | Presentation, public articles, and WYSIWYG studio |
| Axolotl API | API Gateway HTTP API and Python Lambda | Public reading, current Core permission checks, private editing and media signing |
| Axolotl content | Two DynamoDB tables and a private S3 bucket | Separate drafts/published snapshots, uploaded media |
| Credentials | Secrets Manager for Core; standard SSM SecureString for the Axolotl confidential client | Secrets stay on servers, outside browser configuration and Git |

Core issues opaque access tokens. The Axolotl API checks each protected operation against Core, including the expected issuer, organization UUID, service UUID, audience, expiry, and permission. Public post reading does not require an account. Register `posts-write` and `posts-publish` on the Axolotl service, and grant the child's editor account only the permissions and environment access tag you want it to use. An old ID token or a role label does not substitute for a current authorization decision.

This small Core topology favors a modest baseline over high availability: one task and a single-AZ database can be unavailable during failure or maintenance. Amplify hosts the entry point; it does not execute Django or run PostgreSQL. The proxy artifact follows Amplify's [SSR deployment specification](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-deployment-specification.html).

## 1. Review locally before spending anything

Read [COSTS.md](COSTS.md), the infrastructure files, and the Core security/deployment documentation. Use the Core `codex/aws-axolotl-integration` branch or review and merge [NCE Core PR #1](https://github.com/NorthCountryEngineer/NCE_Core/pull/1) into your chosen production branch before starting. Axolotl source is public at [NorthCountryEngineer/Axolotl_News](https://github.com/NorthCountryEngineer/Axolotl_News). Decide which existing AWS account and Region to use. Keep one production branch for each app, disable automatic preview branches, and leave optional AI providers, Kubernetes provisioning, SMS, WAF, NAT gateways, and paid add-ons disabled.

Axolotl local checks, from this checkout:

```sh
npm run typecheck
npm test
npm run build:preview
```

The local editor is `/studio`; choose **Open local editor**. Use **Save draft** explicitly. Browser storage is specific to that browser and origin. A JSON draft export includes media references, not file bytes; preserve originals separately. Upload them again when moving a draft into the deployed application. Imported text-only drafts cannot restore uploaded media from JSON alone.

Core checks and image/proxy packaging are described in the Core checkout's deployment documentation. The local tests do not create AWS resources. A Docker image build may download its pinned dependencies and the official RDS CA bundle; it is not a deployment.

Before any cloud command, inspect AWS **Billing and Cost Management → Bills, Credits, Free Tier**. Account age and plan affect allowances. If you elect to create a zero-spend or monthly budget notification, understand that it is an alert, **not a hard cap**: billing information and notifications can lag spending. Do not change your account plan or add a subscription to follow this guide. [AWS account plans](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html), [budget notification delays](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

## 2. Record the deployment values

Use your existing approved AWS CLI profile, preferably temporary SSO credentials. Do not put access keys in either repository or Amplify environment variables. [AWS CLI SSO configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).

Create a private worksheet outside Git with the following values; these are deployment metadata, not passwords:

| Value | Example or source |
| --- | --- |
| AWS profile, account, Region | Your existing account; use one Region for both Amplify apps, Core infrastructure, API/code bucket, and SSM parameter; Core's ACM certificate must be in the ALB Region |
| Core production branch and Amplify app ID | Your chosen reviewed branch and the Core Amplify app |
| Core public origin/issuer | `https://<branch>.<core-app-id>.amplifyapp.com` |
| Core backend origin | `https://core-origin.axolotl.news` |
| Axolotl branch/app ID and initial origin | `https://<branch>.<axolotl-app-id>.amplifyapp.com` |
| Final Axolotl origin | `https://axolotl.news` |
| Organization slug and parent admin email | Your existing organization or a new one created with the operator bootstrap command |
| Core organization/service UUIDs | Core registration output; names are not identifiers |
| Stack names | For example `nce-core-production` and `axolotl-news-production` |

Keep the Core issuer stable. Adding a different public Core domain later requires a coordinated issuer, discovery, application-trust, and session migration. The `core-origin` subdomain does not change its issuer.

## 3. Reserve both Amplify entry points

This section starts AWS setup and can lead to billable builds/hosting. Proceed only after you have chosen to fund deployment.

1. In Amplify Hosting, create a Core app connected to your NCE Core repository and reviewed production branch. Use the official GitHub App connection rather than storing a personal access token in source. Disable branch auto-creation, PR previews, and automatic builds while configuration is incomplete.
2. Core's root `amplify.yml` supplies the monorepo build specification; the same recipe is saved in `deployment/amplify-core/amplify.yml`. Its app root is `deployment/amplify-core`, and its artifact directory is `.amplify-hosting`. If the console asks for the application root, use that same path. Keep the branch's `AMPLIFY_MONOREPO_APP_ROOT` consistent with it. Use the Amazon Linux 2023 build image and select Node 22 in **Hosting → Build settings → Build image settings** if a Node override is needed. [Amplify build image settings](https://docs.aws.amazon.com/amplify/latest/userguide/custom-build-image.html).
3. Create a separate Amplify app connected to `NorthCountryEngineer/Axolotl_News`. Select the reviewed branch; keep automatic builds and preview branches disabled during setup. Axolotl uses the repository root and the `dist` artifact directory.
4. Record each app ID, its actual default domain, and the branch URL. Do not construct a URL from an assumed app ID. A setup build that fails is still a build and may be billed.
5. Set Core's platform to `WEB_COMPUTE` using the supported API/CLI, and retain cookies in its cache key. The documented console location for the latter is **Hosting → Custom headers and cache → Cache key settings → Keep cookies in cache key**. Use static `WEB` hosting for Axolotl.

```sh
aws amplify update-app \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --app-id CORE_APP_ID \
  --platform WEB_COMPUTE \
  --cache-config type=AMPLIFY_MANAGED \
  --no-enable-auto-branch-creation \
  --no-enable-branch-auto-build
```

Amplify's default cache setting excludes cookies. Core's dynamic responses also carry `private, no-store`; both defenses matter for authenticated pages. Do not install the Axolotl SPA rewrite on Core: the proxy handles Django routes, login POSTs, and OAuth endpoints. [Amplify platform/cache CLI fields](https://docs.aws.amazon.com/cli/latest/reference/amplify/update-app.html), [cookie cache configuration](https://docs.aws.amazon.com/amplify/latest/userguide/cache-key-cookies.html).

## 4. Establish Core's HTTPS origin

1. In **ACM**, select the **same Region as the Core ALB**, request a public certificate for exactly `core-origin.axolotl.news`, and choose DNS validation. This is separate from the certificate Amplify manages for the public Axolotl site.
2. In Cloudflare's existing `axolotl.news` zone, add ACM's exact validation CNAME name and value. Use **DNS only** (gray cloud), with automatic TTL. Leave it in place for renewal. Do not invent the underscore name or strip a domain suffix blindly; check Cloudflare's saved fully qualified record.
3. Wait for ACM to report **Issued**, then record its certificate ARN. The ALB template receives this ARN.
4. After Core's infrastructure exists, add a second CNAME: name `core-origin`, target the stack's actual ALB DNS name, **DNS only**. This record directs origin traffic; the underscore validation CNAME proves certificate ownership. Do not use an IP address copied from the ALB.

If the zone has restrictive CAA records, ensure they permit Amazon certificate issuance under the appropriate `issue`/`issuewild` policy before requesting certificates. ACM documents recognized issuers including `amazon.com`, `amazontrust.com`, `awstrust.com`, and `amazonaws.com`; you do not need four duplicate records just to use ACM. [ALB HTTPS certificates](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/https-listener-certificates.html), [ACM CAA troubleshooting](https://docs.aws.amazon.com/acm/latest/userguide/troubleshooting-caa.html).

## 5. Deploy Core's application, database, and worker

Run the following from the **NCE Core checkout**, after independently accepting the cost of these resources. Replace placeholders with the values you recorded. The template creates a VPC, HTTPS ALB, private PostgreSQL database, secrets, roles, logs, and an ECS service. Its initial `DesiredCount=0` avoids running web/worker processes before migration; the database and ALB can already be billed.

1. Create a private directory outside Git and generate a fresh runtime secret locally. The generator creates a Django key, RSA signing key, and initial parent administrator password, and refuses to overwrite an existing file. Keep the file for recovery and inspect the password only privately.

```sh
mkdir -m 700 "$HOME/.axolotl-aws"
.venv/bin/python infra/aws/generate-runtime-secret.py \
  --output "$HOME/.axolotl-aws/core-runtime-production.json"
```

2. Store that JSON as a Secrets Manager secret in the Core Region. This is a future billable secret; no actual key belongs in the command history. Record the returned ARN and preserve the original signing keys on subsequent releases.

```sh
aws secretsmanager create-secret \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --name nce-core-production/runtime \
  --secret-string "file://$HOME/.axolotl-aws/core-runtime-production.json"
```

3. Deploy the separate ECR registry template and record its `RepositoryUri`. It uses immutable image tags and retains the repository on deletion.

```sh
aws cloudformation deploy \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name nce-core-production-registry \
  --template-file infra/aws/core-registry.template.json

aws cloudformation describe-stacks \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name nce-core-production-registry \
  --query 'Stacks[0].Outputs' --output table
```

4. Build an ARM64 image with the AWS Dockerfile, authenticate Docker to the actual ECR registry, and push a **new unique release tag**. The image build downloads pinned dependencies and the official RDS CA bundle. It runs as non-root UID 10001 and verifies the RDS endpoint with `sslmode=verify-full`; it does not contain production secrets.

```sh
docker build --platform linux/arm64 -f deployment/Dockerfile.aws \
  -t YOUR_ECR_REPOSITORY_URI:release-001 .

aws ecr get-login-password --profile YOUR_PROFILE --region YOUR_REGION \
  | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.YOUR_REGION.amazonaws.com

docker push YOUR_ECR_REPOSITORY_URI:release-001

aws ecr describe-images \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --repository-name ACTUAL_ECR_REPOSITORY_NAME \
  --image-ids imageTag=release-001 \
  --query 'imageDetails[0].imageDigest' --output text
```

Use `YOUR_ECR_REPOSITORY_URI@sha256:ACTUAL_DIGEST` in the stack, **not** the mutable tag. ECR storage and image scanning can have cost implications. The template's registry lifecycle cleans only old untagged images; tagged releases remain until you remove them.

5. Deploy the main Core template using the regional ACM certificate from step 4:

```sh
aws cloudformation deploy \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name nce-core-production \
  --template-file infra/aws/core-fargate.template.json \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    CoreImageUri=YOUR_ECR_REPOSITORY_URI@sha256:ACTUAL_DIGEST \
    CorePublicOrigin=https://BRANCH.CORE_APP_ID.amplifyapp.com \
    CoreOriginHost=core-origin.axolotl.news \
    CertificateArn=ACTUAL_REGIONAL_CERTIFICATE_ARN \
    CoreRuntimeSecretArn=ACTUAL_RUNTIME_SECRET_ARN \
    CoreResourceCredentialsParameter=/axolotl-news/core-resource-client \
    DesiredCount=0

aws cloudformation describe-stacks \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name nce-core-production \
  --query 'Stacks[0].Outputs' --output table
```

Record `LoadBalancerDnsName`, `CoreOriginSecretArn`, `AmplifyComputeRoleArn`, `Cluster`, `Service`, `LogGroup`, `DatabaseIdentifier`, and the task definition outputs. Add the DNS-only `core-origin` CNAME described earlier. The template generates a separate plaintext origin secret; the proxy role can read it but cannot read the runtime keys or database password.

This template uses a 0.25-vCPU/1-GB ARM64 task shared by web and worker, a `db.t4g.micro` single-AZ PostgreSQL instance with 20 GB storage, seven-day automated database backups, database deletion protection, and fourteen-day retained application logs. It has no NAT gateway. Task ingress accepts port 8000 only from the ALB; database ingress accepts port 5432 only from the task security group. The task's public IP supplies restricted outbound HTTPS access and can be charged. The origin header is the application boundary in front of public ALB ingress.

## 6. Initialize Core and register Axolotl

Run migrations once as a release operation before starting normal web/worker traffic. The service entrypoint deliberately does not run migrations on every restart. The dedicated bootstrap task receives the generated initial administrator password through Secrets Manager; the normal web/worker task does not receive it. Do not pass a password in a shell argument, build environment, or public log.

The release helper uses the ordinary AWS CLI credential chain. Set your already approved profile and the explicit cost acknowledgment for these commands:

```sh
export AWS_PROFILE=YOUR_PROFILE
export CORE_ENABLE_AWS_DEPLOYMENT=true

python3 infra/aws/run-management.py \
  --stack nce-core-production --region YOUR_REGION -- migrate --noinput

python3 infra/aws/run-management.py \
  --stack nce-core-production --region YOUR_REGION -- check --deploy --fail-level WARNING

python3 infra/aws/run-management.py \
  --stack nce-core-production --region YOUR_REGION --bootstrap -- \
  --slug YOUR_ORGANIZATION_SLUG --name 'Your organization name' \
  --admin-email YOUR_PARENT_ADMIN_EMAIL
```

Each command starts a billable one-off Fargate task and waits for its web container exit code. Do not start the service if a release command fails. Inspect the stack's CloudWatch `LogGroup` and the task's stopped reason. A database migration may take longer than the helper's AWS waiter; inspect the original task before retrying so two migrations do not run concurrently. The bootstrap refuses to overwrite an existing administrator password. For an existing organization, skip bootstrap and retain the established login.

Start the regular service by repeating the **same main-template deployment and all recorded parameters**, changing only `DesiredCount=1`. Do not rotate signing keys or change the issuer during that update. Wait for the ECS service to become stable and its ALB target to become healthy.

The service uses stop-before-start updates to keep its normal peak at one task. Expect short downtime on an image release; web and worker restart together. Review the worker's running jobs before updating, then verify a representative job after the release.

Configure the Core Amplify proxy now, before using its portal:

| Core Amplify production-branch variable | Value |
| --- | --- |
| `CORE_PUBLIC_ORIGIN` | Exact default Amplify origin/issuer |
| `CORE_BACKEND_ORIGIN` | `https://core-origin.axolotl.news` |
| `CORE_AWS_REGION` | Region containing the origin secret |
| `CORE_ORIGIN_SECRET_ARN` | Stack output `CoreOriginSecretArn`, never the value |
| `CORE_ENABLE_AWS_DEPLOYMENT` | `true`, after choosing to fund Core builds/hosting |
| `AMPLIFY_MONOREPO_APP_ROOT` | `deployment/amplify-core` |

Attach the stack output `AmplifyComputeRoleArn` to the Core **production branch**, using **App settings → IAM roles → Compute role → Edit → branch override**. Its only resource permission is `secretsmanager:GetSecretValue` on the generated origin secret. An AWS build can already be billed before its environment gate runs. Keep Node 22 for the proxy build; its manifest uses Node 22 SSR compute. Save the build specification from `deployment/amplify-core/amplify.yml`, verify `WEB_COMPUTE` and cookie-cache settings, then start the reviewed build. [Amplify SSR compute roles](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html).

Sign in at the default Core Amplify URL using the parent email and the generated `bootstrap_password` from your private local runtime file. Change that initial password through Core's normal account controls. The Core issuer remains the default Amplify URL even though requests reach the origin subdomain. Test a sign-in, form POST, sign-out, and discovery document before proceeding.

The Axolotl marketplace package registers an **external AWS Amplify runtime**. Registration installs its Core metadata, service, clients, and permission vocabulary; it does not create an Amplify app, deploy AWS, purchase anything, or infer authority from the application name. The reviewed package is `nce/marketplace.json` in Axolotl and an identical `examples/axolotl-news-package.json` in Core.

Create or select the organization's **production** environment first. In Core's **Central admin → Environments → Create environment**, use `production`, a unique namespace such as `family-production`, application origin `https://axolotl.news`, blank ingress class/TLS secret fields, automatic deployment unchecked, and active checked. The namespace is an identity-boundary label here; this does not create Kubernetes resources. For an ordinary editor, grant the resulting `environment-production` access tag and the service permissions through **Users and permissions**. Use a parent-controlled administrator account for configuration; give the child an ordinary member account.

Register production directly at `https://axolotl.news`, with callback `/oauth/callback`. A registration's origin is immutable within its installation/environment. Consequently, the simple production path does **not** first register its login at the default Axolotl Amplify URL and then rename it. Before DNS, test Core fully on its default URL and test Axolotl's static presentation/routes. Complete browser API/login/upload tests after `axolotl.news` becomes available. A separate staging environment/registration is an optional additional setup if you need full editor testing at a second hostname.

Preserve the public configuration separately from the private confidential-client credentials. Only public metadata goes into the frontend; the private resource-client JSON goes into the server-side SSM SecureString. Both the browser client and confidential introspection client must belong to the **same Core service**.

Use the dedicated registration task to install/register the reviewed package and transfer its private credentials directly to the configured SSM parameter:

```sh
python3 infra/aws/run-management.py \
  --stack nce-core-production --region YOUR_REGION --registration -- \
  register_external_application \
  --organization YOUR_ORGANIZATION_SLUG \
  --environment production \
  --package examples/axolotl-news-package.json \
  --origin https://axolotl.news \
  --actor-email YOUR_PARENT_ADMIN_EMAIL \
  --credentials-parameter /axolotl-news/core-resource-client
```

The **registration task alone** can write this exact standard SecureString; the normal web/worker task and Amplify proxy role cannot. The command prints **public configuration only** to the task's web CloudWatch stream; save that JSON object locally as `$HOME/.axolotl-aws/axolotl-core-public.json`. Its fields include the issuer, organization/service UUIDs, browser client ID, exact redirect URI, and permissions. The secret does not pass through a log, browser, ephemeral output file, or your shell history.

The SSM transfer refuses to overwrite an existing parameter. If the task fails, inspect the stopped reason and existing Core registration/parameter before retrying; do not delete an established credential simply to make a command succeed. A local or otherwise securely connected Core operator can instead use `--credentials-file` to write a new mode-0600 private JSON file, then explicitly store it with `aws ssm put-parameter --type SecureString --tier Standard --value file://PRIVATE_FILE`. This file-based path is not needed for the ECS deployment above.

After registration, the package appears in Core's marketplace/application controls as an externally hosted application. Grant an editor the Axolotl service's `posts-write` and, if desired, `posts-publish`, plus its production environment access tag. Existing Core users keep their central login. Core does not send invitation emails in this implementation; the parent must share an invitation link securely when creating the child's membership.

## 7. Deploy the Axolotl API

The NCE API uses `infra/aws/axolotl.template.json`, not an Amplify Gen 2 deployment. Its private S3 bucket and content tables are retained on stack deletion. Retention protects against an accidental stack delete; retained storage can still be billed and is not an independent backup.

Store the private resource-client secret in a **standard SecureString** parameter in the API's Region. Use the default `aws/ssm` key unless you deliberately review and configure a custom key. Do not enable advanced parameters or higher throughput just for this small application. Standard and advanced parameters have different limits and costs. Only the Lambda role needs access to that specific secret. [Creating SecureString parameters](https://docs.aws.amazon.com/systems-manager/latest/userguide/param-create-cli.html), [SecureString encryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html).

From the Axolotl checkout, create the Lambda ZIP locally:

```sh
python3 scripts/package-api.py
```

That command writes `infra/aws/build/axolotl-api.zip` and makes no network request. It packages the Python handler and uses Lambda's runtime Boto3; there is no paid package install or Lambda layer.

For the future cloud deployment:

1. In S3, create a dedicated **private** code-artifact bucket in the API's Region, with **Block all public access** enabled and default encryption. Do not enable a public website or change the media bucket's policy. Record its globally unique name.
2. Upload the ZIP under a new, versioned key, such as `releases/REVIEWED_COMMIT/axolotl-api.zip`. A changed ZIP must use a new key on the next release so CloudFormation recognizes the code update; merely replacing bytes under an unchanged key does not update the function.
3. Confirm the standard SecureString at `/axolotl-news/core-resource-client` contains only the private registration JSON `{ "client_id": "…", "client_secret": "…" }`. Do not put the entire runtime secret or an end-user token there.
4. Read the account's Lambda concurrency quota before choosing the template setting:

```sh
aws lambda get-account-settings \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --query 'AccountLimit.UnreservedConcurrentExecutions' --output text
```

AWS keeps at least 100 concurrent executions available without reservations. Use `LambdaReservedConcurrency=2` when at least 102 are currently unreserved. Some new accounts have a lower quota; for those, request a quota increase or deliberately select `LambdaReservedConcurrency=0`. In **this template**, zero omits the reservation and uses the shared account pool; it does **not** disable the function. Selecting zero removes the two-invocation bound, so review that tradeoff. Do not issue AWS's separate “reserved concurrency zero” operation expecting this template behavior. [Lambda reserved concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html).

5. Deploy the template with the exact public identifiers from Core registration, using the chosen concurrency value:

```sh
aws s3 cp infra/aws/build/axolotl-api.zip \
  s3://YOUR_PRIVATE_CODE_BUCKET/releases/REVIEWED_COMMIT/axolotl-api.zip \
  --profile YOUR_PROFILE --region YOUR_REGION

aws cloudformation deploy \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name axolotl-news-production \
  --template-file infra/aws/axolotl.template.json \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    ApplicationOrigin=https://axolotl.news \
    CoreIssuer=https://BRANCH.CORE_APP_ID.amplifyapp.com \
    CoreOrganizationId=ORGANIZATION_UUID_FROM_CORE \
    CoreServiceId=SERVICE_UUID_FROM_CORE \
    CoreCredentialsParameter=/axolotl-news/core-resource-client \
    LambdaCodeBucket=YOUR_PRIVATE_CODE_BUCKET \
    LambdaCodeKey=releases/REVIEWED_COMMIT/axolotl-api.zip \
    LambdaReservedConcurrency=2

aws cloudformation describe-stacks \
  --profile YOUR_PROFILE --region YOUR_REGION \
  --stack-name axolotl-news-production \
  --query 'Stacks[0].Outputs' --output table
```

For a review before execution, add `--no-execute-changeset` to `deploy` and inspect that change set; this guide does not execute it for you. Record outputs `ApiUrl`, `MediaBucket`, `PrivateTable`, `PublishedTable`, and `FunctionName`. If using the shared pool, replace the example's final parameter with `LambdaReservedConcurrency=0` intentionally.

Finish all uploads and close other editing tabs before cleaning up or deleting a draft. A signed upload already issued can still complete for 60 seconds; wait for that window before cleanup when another tab was uploading. If a cleanup task times out, wait at least 90 seconds and retry cleanup to reclaim its expired lock.

The HTTP API and S3 CORS rules allow the **single** configured `ApplicationOrigin`. CORS is a browser interoperability rule, not authorization. The API verifies permissions separately. Upload authorization produces a 60-second signed POST constrained to the accepted MIME type and byte count; media reads produce five-minute signed GET URLs. Direct bucket access remains private. The template uses API target traffic of 5 requests/second with burst 10, optional function concurrency reservation of 2, and Lambda logs retained for 7 days. These bounds do not cap a bill.

## 8. Configure and build the Axolotl frontend

Core's frontend was built during initialization in step 6. Keep its origin credentials, database passwords, and RSA keys out of Amplify build variables and the `.amplify-hosting` artifact. The runtime proxy fetches its single origin credential with temporary compute-role credentials.

Axolotl's public `nce-config.json` comes from Core registration plus the deployed API endpoint:

```sh
node scripts/write-core-config.mjs "$HOME/.axolotl-aws/axolotl-core-public.json" \
  https://ACTUAL_HTTP_API_ID.execute-api.YOUR_REGION.amazonaws.com
VITE_APP_MODE=nce npm run build
```

The script writes the ignored `nce-config.json` with fields `issuer`, `organization_id`, `service_id`, `browser_client_id`, `redirect_uri`, and `api_url`. Use the actual `ApiUrl` output. Inspect this public file, then set the following **Axolotl production branch** Amplify environment variables:

| Variable | Value |
| --- | --- |
| `VITE_APP_MODE` | `nce` |
| `NCE_PUBLIC_CONFIG_JSON` | Entire contents of the public `nce-config.json` |
| `AXOLOTL_ENABLE_AWS_DEPLOYMENT` | `true`, only after choosing to fund hosting/builds |

Its root `amplify.yml` installs packages and builds `dist`. In `nce` mode it **does not deploy Gen 2 resources**; the separate template above supplies the API. Never set mode `cloud` for this deployment, because that selects the optional Cognito/Gen 2 pipeline. Frontend variables/JSON are visible to visitors; use them only for public identifiers and URLs. [Amplify environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html).

Configure Axolotl's static SPA rewrite so `/studio`, `/oauth/callback`, and article links work on refresh. In **Hosting → Rewrites and redirects**, use this 200 rule **on Axolotl only**:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|mp4|webm)$)([^.]+$)/>",
    "target": "/index.html",
    "status": "200"
  }
]
```

These source commits use `[skip-cd]` to suppress automatic Amplify builds. Start the reviewed build manually after configuring the app and its variables; the marker does not prevent an intentional manual build. [Amplify build controls](https://docs.aws.amazon.com/amplify/latest/userguide/edit-build-settings.html).

Keep any domain canonical redirect before the catch-all. Review an automatically generated catch-all to avoid duplicate conflicting rules. [Amplify SPA rewrites](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html).

## 9. Verify Core before DNS; verify publishing after DNS

Run the Core and public/static checks before changing the blog's DNS. Complete the editor, revocation and publication checks after step 10 makes the registered production hostname available:

- Core's discovery document reports the exact configured default Amplify issuer. Sign in, submit a normal CSRF-protected form, and sign out. Test two separate browser sessions to ensure one person's authenticated page is never served to another.
- The Core origin hostname rejects ordinary requests without the secret header. The health endpoint may be a narrowly scoped exception for ALB health checks; it must not reveal data or confer authorization.
- From a terminal, `GET API_URL/health` and `GET API_URL/published` work. Unauthenticated `GET API_URL/posts`, upload signing, publishing, and deletion fail. API browser requests from the default Axolotl hostname are intentionally not covered by production CORS.
- On the default Axolotl URL, check the presentation and direct SPA route refresh. Complete editor/login and feed API checks on the production hostname after DNS: Core's exact callback origin remains `https://axolotl.news`.
- Remove an editor's current permission or disable membership in Core. Its next protected API operation must fail even while its old login token still exists. A Core outage must deny protected operations; public reading can remain available.
- Unpublish, confirm the article is removed from the public feed, then clear its obsolete published media while keeping it unpublished. Already issued media links can remain valid until their short expiry; deletion of the object is the stronger removal step.
- Run one representative queued Core job and verify the worker processes it. Review the release migration result, application logs, and health status rather than treating a green Amplify frontend build as proof of a healthy backend.

The local checks validate implementation behavior without cloud costs. These deployed checks cannot be claimed complete until you actually deploy and run them.

Core also includes a gated deployed acceptance script. Once the Core HTTPS origin and production browser-client registration exist, run it from the Core checkout:

```sh
CORE_ENABLE_AWS_DEPLOYMENT=true .venv/bin/python infra/aws/acceptance.py \
  --public-origin https://BRANCH.CORE_APP_ID.amplifyapp.com \
  --backend-origin https://core-origin.axolotl.news \
  --browser-origin https://axolotl.news \
  --browser-client-id PUBLIC_BROWSER_CLIENT_ID_FROM_CORE
```

It makes real deployed requests, which can be billed, to check TLS, the issuer, origin rejection, secure CSRF cookies, form POST handling, and token-endpoint CORS. It supplements the manual signed-in editor checks; no remote acceptance run was performed during development.

## 10. Attach `axolotl.news` with Cloudflare

Core continues using its default Amplify public domain; its `core-origin` DNS record remains the private-boundary backend entry point. Attach the custom domain to the **Axolotl Amplify app** only.

1. Confirm production Core registration uses `https://axolotl.news/oauth/callback`, its browser allowed origin is `https://axolotl.news`, and the API stack's `ApplicationOrigin` is `https://axolotl.news`. Do not use wildcard production origins or edit an immutable external registration to another hostname.
2. In the Axolotl app, open **Hosting → Custom domains → Add domain**. Enter `axolotl.news`. Choose a third-party DNS provider/manual configuration; keep DNS at Cloudflare and do not create or transfer a Route 53 hosted zone.
3. Map the apex and `www` to the reviewed production branch. Choose the apex as the canonical hostname and redirect `www` to it. Use an Amplify-managed certificate.
4. Copy the records actually displayed by Amplify to Cloudflare. They are specific to your app and certificate; do not reuse examples from this file.

| Cloudflare record | Target from Amplify | Proxy |
| --- | --- | --- |
| CNAME `@` | Exact apex hosting target supplied by Amplify | DNS only |
| CNAME `www` | Exact `www` hosting target supplied by Amplify | DNS only |
| Certificate-validation CNAME `_…` | Exact ACM validation target supplied by Amplify | DNS only; retain for renewal |

Cloudflare supports apex CNAME flattening on the existing zone. Keep validation records as actual CNAMEs: do not enable flattening for all CNAME records or a per-record flattening option for the underscore validation record. Remove only conflicting A/AAAA/CNAME records at the specific apex/`www` names after reviewing them; preserve MX/TXT/email and the separate Core origin records. [Cloudflare apex CNAMEs](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-zone-apex/), [third-party validation and flattening](https://developers.cloudflare.com/dns/manage-dns-records/reference/vendor-specific-records/).

5. Wait for Amplify domain verification, certificate creation, and **Available** status. AWS notes that DNS propagation and validation can take up to 48 hours. Keep the certificate-validation record DNS-only for automatic renewal. [Amplify's Cloudflare instructions](https://docs.aws.amazon.com/amplify/latest/userguide/to-add-a-custom-domain-managed-by-cloudflare.html).
6. Test `https://axolotl.news`, the `www` redirect, direct article links, `/studio` refresh, Core login, callback completion, uploads, and published media. Save a draft, publish it, view it in a signed-out browser, edit its draft without changing the public version, and verify a subsequent publication updates it. Check the browser certificate and that no HTTP/mixed-content requests occur. A `www` visitor must redirect to the apex before starting the login flow.

Use the initial DNS-only configuration throughout these tests. Any later Cloudflare proxy/caching change is a separate decision requiring review of OAuth redirects, cookies, cache rules, and certificate renewal.

## 11. Operate, back up, and shut down deliberately

Keep Core keys and encrypted database backups together in a secure recovery plan: Core's Django secret also protects stored integration bundles. Rotating it is a migration, not a casual environment edit. Do not copy the RSA private key or secret files into a frontend build. Secret injection into an ECS task happens at task startup; update and restart tasks deliberately when changing an origin credential or database credential. Coordinate the proxy-origin value with the Core runtime value. [ECS secret injection and rotation behavior](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html).

Review CloudWatch logs for web/worker/API failures while avoiding request bodies, authorization headers, passwords, and confidential registration output. Use the templates' finite log retention and bounded API settings. These reduce exposure and unbounded growth; they do not impose an account spending cap.

Before deletion, export drafts and save original media, take an explicitly approved database backup, and preserve the Core keys needed to restore it. A backup operation or retained snapshot/storage can also cost money. Review the exact stack change set and resources before applying updates or deletion. `aws cloudformation deploy --no-execute-changeset` prepares a reviewable change set; it does not deploy that change set. [CloudFormation deploy behavior](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy.html).

For a full retirement, follow these steps only when you intend to remove the application and have decided what data to preserve:

1. Disable both Amplify apps' automatic builds, branch discovery, and PR previews. Disable the Axolotl external deployment/client in Core to prevent new editor access. Wait for outstanding short-lived media URLs/uploads and any important worker job as appropriate.
2. Export the documents/original media you need and take any independently approved Core database backup. Retained backups and storage still cost money.
3. Repeat the Core main-template deployment with its recorded values and `DesiredCount=0` to stop its web and worker. Confirm ECS shows no running service tasks; inspect and stop any separate one-off tasks that are still running. The ALB and database continue to incur charges at this point.
4. Remove the Axolotl custom-domain association, then delete both Amplify apps through their app settings. Inspect their final state; frontend deletion does not delete these separately deployed backends.
5. Delete the `axolotl-news-production` CloudFormation stack. Its two DynamoDB tables and media S3 bucket remain intentionally retained. Record their names from the saved outputs before deleting the stack; remove these only after preserving the content you need.
6. Core's RDS deletion protection must be disabled before its stack can delete the database. In **RDS → Databases → actual Core database → Modify**, disable deletion protection and apply the intended change. Confirm you selected the database from `DatabaseIdentifier`, not a shared database. Delete the Core main stack after reviewing its snapshot policy. CloudFormation creates a final database snapshot under this template's `Snapshot` policy; inspect stack events and verify the result. A failed delete is not a shutdown confirmation.
7. Inspect and deliberately remove or retain the Core database snapshot, retained application log group, database/origin/runtime Secrets Manager secrets, and Axolotl SSM parameter. Retained signing keys and snapshots must remain protected together if recovery is required.
8. Delete the Core registry stack and handle its retained ECR repository/images separately. Empty and delete the private Lambda code bucket when its release artifacts are no longer needed. Inspect any S3 object versions, orphaned resources, failed stack resources, and account bills. Shared infrastructure or roles must not be removed merely because an app used them.
9. Remove the blog apex/`www` and `core-origin` routing records only when you intend to stop serving them. Retain or remove certificate-validation CNAMEs according to whether their certificate is still in use elsewhere. Keep the purchased domain registration and unrelated email/DNS records.

Do not assume setting desired count to zero, changing DNS, or deleting a frontend stops all charges. Verify the remaining resource inventory, retained storage, snapshots, and subsequent bills. [CloudFormation deletion policies](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-deletionpolicy.html), [RDS deletion protection and snapshots](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html).

The optional legacy Gen 2 stack differs: its pinned storage implementation and generated data templates use destructive deletion defaults. Deleting that stack can delete uploaded files and both content tables. Do not assume the NCE template's retention rules apply to the legacy stack.
