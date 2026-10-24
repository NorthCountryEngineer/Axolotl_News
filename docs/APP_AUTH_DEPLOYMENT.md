# Deploy app-branded sign-in and invitation-only account creation

This upgrades the **existing** deployment in account **015454941623**, region **us-east-1**. Run each numbered step in the same Terminal window. Stop on any error; do not continue to the next step. Copy code blocks as plain text, including ordinary single backslashes at line endings.

These are instructions for you to execute. Publishing an image, running migration compute, and starting an Amplify build can incur AWS charges. No deployment was started for this change. Core sign-in will have a short maintenance window during steps 7–9. Existing ALB/RDS/storage charges continue while the Core service is stopped.

The release adds three branding fields to Core services. It preserves existing users, passwords, registrations, roles, issuer, signing keys, and DNS records. Core's Amplify proxy and the Axolotl Lambda API need no update for this feature. Deploy **Core first**, then Axolotl's frontend.

## 1. Merge the Core authentication PR

Open the Core pull request linked in the completion message, review it, and click **Merge pull request**. Do this before pulling `main` below. The Axolotl frontend source is already on its `main` branch.

## 2. Set every required variable in a fresh Terminal window

```sh
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
export AWS_PROFILE="axolotl-deploy"
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_PAGER=""
export CORE_DIR="/Users/ericyager/Downloads/NCE_Core"
export AXOLOTL_DIR="/Users/ericyager/Documents/ChatGPT/Axolotl News"
export AUTH_DEPLOY_DIR="$HOME/.axolotl-aws/app-auth-release"
export CORE_STACK="nce-core-production"
export CORE_REGISTRY_STACK="nce-core-production-registry"
export CORE_PUBLIC_ORIGIN="https://core.nnytech.ai"
mkdir -p "$AUTH_DEPLOY_DIR"
cd "$HOME"
```

## 3. Confirm the account before doing any deployment

```sh
aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

The Account must be **015454941623**. If credentials expired, run this, finish the browser login, and repeat the identity command:

```sh
aws login --profile "$AWS_PROFILE"
```

Do not use `aws sso login` for this `aws login` profile. If the account is different, stop and select the correct account when logging in.

## 4. Pull the merged Core code

```sh
cd "$CORE_DIR"
git status --short
```

If that lists changes, stop and save them before switching branches. Otherwise:

```sh
git switch main
git pull --ff-only origin main
test -f identity/app_auth.py
test -f identity/migrations/0009_service_auth_name_service_auth_tagline_and_more.py
export CORE_AUTH_TAG="app-auth-$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"
```

The two `test` commands should finish silently with no error. Open Docker Desktop if it is not already running, then verify:

```sh
docker info >/dev/null
```

## 5. Read the existing registry and build the new image locally

```sh
export CORE_REPOSITORY_URI="$(aws cloudformation describe-stacks \
  --stack-name "$CORE_REGISTRY_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryUri`].OutputValue | [0]' \
  --output text --profile "$AWS_PROFILE" --region "$AWS_REGION")"
export CORE_REPOSITORY_NAME="${CORE_REPOSITORY_URI#*/}"
export CORE_REGISTRY_HOST="${CORE_REPOSITORY_URI%%/*}"
printf 'Repository: %s\nImage tag: %s\n' "$CORE_REPOSITORY_URI" "$CORE_AUTH_TAG"
```

The repository must start with `015454941623.dkr.ecr.us-east-1.amazonaws.com/`. It currently ends in `nce-core-production-registry-repository-tnbnd0in2i6m`. If it prints `None` or an empty value, stop.

```sh
docker build --platform linux/arm64 \
  -f deployment/Dockerfile.aws \
  -t "$CORE_REPOSITORY_URI:$CORE_AUTH_TAG" .
```

Wait for a successful build before continuing. The build downloads the pinned dependencies and the official RDS certificate bundle.

## 6. Publish the image and record its immutable digest

```sh
aws ecr get-login-password --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$CORE_REGISTRY_HOST"
docker push "$CORE_REPOSITORY_URI:$CORE_AUTH_TAG"
export CORE_AUTH_DIGEST="$(aws ecr describe-images \
  --repository-name "$CORE_REPOSITORY_NAME" \
  --image-ids "imageTag=$CORE_AUTH_TAG" \
  --query 'imageDetails[0].imageDigest' --output text \
  --profile "$AWS_PROFILE" --region "$AWS_REGION")"
export CORE_AUTH_IMAGE_URI="$CORE_REPOSITORY_URI@$CORE_AUTH_DIGEST"
printf 'New image: %s\n' "$CORE_AUTH_IMAGE_URI"
```

The image must end in `@sha256:` followed by 64 hexadecimal characters.

## 7. Prepare the update, preserving every existing configuration parameter

Read the existing stack into a local file. This uses CloudFormation metadata, not decrypted application secrets:

```sh
aws cloudformation describe-stacks \
  --stack-name "$CORE_STACK" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  --output json > "$AUTH_DEPLOY_DIR/core-stack-before.json"
```

Paste this complete block to prepare the two updates and a recovery file. It changes only the image and service count; every other parameter uses `UsePreviousValue`.

```sh
python3 - <<'PY'
import json, os, re
from pathlib import Path
folder = Path(os.environ['AUTH_DEPLOY_DIR'])
stack = json.loads((folder / 'core-stack-before.json').read_text())['Stacks'][0]
params = {p['ParameterKey']: p['ParameterValue'] for p in stack['Parameters']}
assert stack['StackStatus'] in {'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'}, stack['StackStatus']
assert params.get('DesiredCount') == '1', 'Expected one running Core service; stop and check the stack.'
assert {'CoreImageUri', 'DesiredCount'} <= params.keys()
image = os.environ['CORE_AUTH_IMAGE_URI']
assert re.fullmatch(r'015454941623\.dkr\.ecr\.us-east-1\.amazonaws\.com/[^@]+@sha256:[a-f0-9]{64}', image)
for name, uri, count in [('core-auth-stopped.json', image, '0'),
                         ('core-auth-running.json', image, '1'),
                         ('core-auth-recovery.json', params['CoreImageUri'], '1')]:
    values = []
    for key in params:
        if key == 'CoreImageUri': values.append({'ParameterKey': key, 'ParameterValue': uri})
        elif key == 'DesiredCount': values.append({'ParameterKey': key, 'ParameterValue': count})
        else: values.append({'ParameterKey': key, 'UsePreviousValue': True})
    (folder / name).write_text(json.dumps(values, indent=2) + '\n')
print('Prepared stopped, running, and recovery updates.')
PY
```

Now start the maintenance window and register the new task definition with the service stopped:

```sh
aws cloudformation update-stack --stack-name "$CORE_STACK" \
  --use-previous-template --capabilities CAPABILITY_IAM \
  --parameters "file://$AUTH_DEPLOY_DIR/core-auth-stopped.json" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws cloudformation wait stack-update-complete --stack-name "$CORE_STACK" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

## 8. Run the database migration once using the new image

```sh
cd "$CORE_DIR"
CORE_ENABLE_AWS_DEPLOYMENT=true .venv/bin/python infra/aws/run-management.py \
  --stack "$CORE_STACK" --region "$AWS_REGION" -- migrate identity 0009 --noinput
```

This starts one temporary Fargate migration task and explicitly requires the new branding migration to exist in the image. Wait for **Release command completed successfully.** If it fails, keep the service stopped and use the recovery instructions below. The task's web log should report `Applying identity.0009_service_auth_name_service_auth_tagline_and_more... OK` on the first run. A retry can report no migrations to apply if that migration already succeeded. Do not run bootstrap, recreate the runtime secret, or register Axolotl again.

## 9. Restart Core and wait until it is healthy

```sh
aws cloudformation update-stack --stack-name "$CORE_STACK" \
  --use-previous-template --capabilities CAPABILITY_IAM \
  --parameters "file://$AUTH_DEPLOY_DIR/core-auth-running.json" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws cloudformation wait stack-update-complete --stack-name "$CORE_STACK" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
export CORE_CLUSTER="$(aws cloudformation describe-stacks --stack-name "$CORE_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`Cluster`].OutputValue | [0]' \
  --output text --profile "$AWS_PROFILE" --region "$AWS_REGION")"
export CORE_SERVICE="$(aws cloudformation describe-stacks --stack-name "$CORE_STACK" \
  --query 'Stacks[0].Outputs[?OutputKey==`Service`].OutputValue | [0]' \
  --output text --profile "$AWS_PROFILE" --region "$AWS_REGION")"
aws ecs wait services-stable --cluster "$CORE_CLUSTER" --services "$CORE_SERVICE" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

Open **https://core.nnytech.ai** and verify your existing parent account still signs in. Core's Amplify proxy already forwards these pages; it needs no rebuild.

If this returns **503**, stop before step 10. The service waiter alone does not verify the public HTTP response. A worker error such as `column identity_service.auth_name does not exist` means the new image is running without the branding schema. Run the explicit step 8 migration, wait for success, and let ECS replace the stopped service task. After migration succeeds, an `ecs update-service --force-new-deployment` on the existing service can start the replacement immediately; this is a user-run, billable deployment action. Do not rebuild the frontend or change DNS to resolve a missing database column.

## 10. Set Axolotl's sign-in branding in Core

1. Sign into Core with your parent administrator account.
2. Open **Axolotl Family → Users and permissions → Services → Axolotl News → Service settings**. The direct existing service settings address is:
   **https://core.nnytech.ai/organizations/family/services/403f3444-5e88-4308-8f2c-e0377cc66cad/settings/**.
3. Keep the existing Slug, Name, and Active settings.
4. Set **Auth name** to `Axolotl News`.
5. Set **Auth tagline** to `Your next axolotl story starts here.`
6. Set **Auth theme** to **Axolotl News** and save.

Automatic also selects this theme when the existing service slug is `axolotl-news`. Other apps can use their own display name and tagline with the Core theme. Branding does not change anyone's permissions.

## 11. Release the Axolotl frontend

In AWS Amplify → **Axolotl_News → main → Environment variables**, retain the existing `VITE_APP_MODE=nce`, `AXOLOTL_ENABLE_AWS_DEPLOYMENT=true`, public Core registration identifiers, and API URL. There are no new frontend variables for this feature.

Run this from your home directory so AWS does not need to read the Documents folder:

```sh
cd "$HOME"
aws amplify start-job --app-id d2v2mlkst3io2a --branch-name main \
  --job-type RELEASE --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

Open Amplify → **Axolotl_News → main → the new build**. Wait for **Deployed**. This builds the latest GitHub `main`, including the original Canva MP4. Automatic builds remain disabled; later source pushes need a deliberate release.

## 12. Verify the existing account before creating invitations

1. Open **https://axolotl.news/studio** in a fresh tab and choose **Sign in →**.
2. The Core-hosted page should say **Sign in to Axolotl News**, with the axolotl logo and no Core administration navigation. If Core already has a login session, you may go directly to branded consent.
3. Sign in with your existing account and choose **Authorize** if prompted.
4. Verify the browser returns to **https://axolotl.news/studio** and the editor opens. Reload once and confirm access remains.
5. In browser Network, `/oauth/token/` and the API `/session` should return **200** for your authorized editor account. Do not share codes, tokens, request bodies, or Authorization headers.

## 13. Invite an ordinary user, then grant their app permissions

1. In Core, open **Axolotl Family → Users and permissions → Invite a user**.
2. Enter the invitee's email; choose **Member**, then submit. Core displays the invitation link; it does not send email. Copy and share the link privately.
3. The invitee opens **https://axolotl.news/studio → Create account with invitation** and pastes the link or invitation code.
4. A new user chooses a password on the branded Core page. A person with that email already in Core signs into their existing account and accepts the invitation. They keep one user UUID and their existing password.
5. After acceptance, they return to Axolotl. If its production boundary is not granted, they see **Your shared account is ready** and a request to ask their parent for access. This is expected.
6. In Core **Users and permissions → Roles**, create or open an editor role with the Axolotl service permission **posts-write**. Add **posts-publish** only if this user should publish.
7. Under **Users**, click the invited email. Keep their organization role **Member**, Active checked, select the editor role, and save.
8. Beside that user, choose **Tags and grants**. Under **Explicit access-tag grants**, select the existing **environment-production** tag for the Axolotl production environment and save. Preserve any existing grants.
9. The invitee starts a fresh sign-in from Axolotl's Editor's desk. Verify the editor opens; save a draft and reload it. If they have `posts-publish`, verify their intended publish action too.

Do not grant administrator membership just to make the editor work. The backend continues checking current Core permissions on every protected request. A normal invitation grants no roles, publishing permission, or other application access automatically. Using the invitation again should show that it is unavailable.

## Recovery if Core migration or startup fails

Stop before the Axolotl frontend release. The migration is additive, so the previous Core image can run with any already-added branding columns. Do not drop the database or reverse migrations as a first response.

When CloudFormation is back in a completed state, restore the previous image and one service task using the file saved in step 7:

```sh
aws cloudformation update-stack --stack-name "$CORE_STACK" \
  --use-previous-template --capabilities CAPABILITY_IAM \
  --parameters "file://$AUTH_DEPLOY_DIR/core-auth-recovery.json" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
aws cloudformation wait stack-update-complete --stack-name "$CORE_STACK" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

If the stack is updating/rolling back, let it finish first. Inspect the migration task's web log in the stack's CloudWatch LogGroup; retain the first useful error, omitting credentials. Fix the failure before trying the new image again. No Cloudflare records, callbacks, issuer, or runtime keys change for this release.

References: [CloudFormation parameter reuse](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/update-stack.html), [ECR image digests](https://docs.aws.amazon.com/cli/latest/reference/ecr/describe-images.html), [Amplify release jobs](https://docs.aws.amazon.com/cli/latest/reference/amplify/start-job.html).
