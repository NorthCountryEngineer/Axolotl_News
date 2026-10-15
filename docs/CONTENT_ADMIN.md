# Manage Axolotl News creations

These controls apply to Axolotl News posts and their content. They do not change
NCE Core's administration or deployment console.

## Use the controls

1. Sign in through **Editor's desk** with a newsroom administrator account.
2. Click **Admin actions: Off** in the header. It changes to **Admin actions: On**.
3. Open the **…** beside a published post, a creation in the editor sidebar, or
   a content block in the editor.
4. Choose **Update**, **Duplicate**, or **Delete**.
5. Click the header toggle again to hide the menus. Signing out or reloading the
   page also starts with admin actions off.

**Update** opens the existing saved draft. A block's Update action focuses its
text or media caption. Save and publish when ready; editing a draft does not
silently replace the public version.

**Duplicate** creates a new private draft with its own identifiers and uploaded
files. The original stays intact. Save unsaved changes before duplicating a whole
creation. Duplicating a block changes the current draft and reuses its file within
that same creation; it does not make an extra public post.

**Delete creation** confirms removal of the public post, private draft, and that
creation's current uploaded media. A block's Delete action changes the draft;
save and publish to update what readers see. Files shared by other blocks in
that same creation remain available until the creation is deleted. Deleting the
last block leaves one blank text block so the editor remains usable.

## Permission boundary and recovery

In the deployed NCE mode, both `posts-write` and `posts-publish` are required for
admin actions. The API checks current, application-bound Core authorization on
every protected request. Hiding or displaying a menu does not grant permission.
The original Cognito mode uses its existing `Editors` group. Local preview has a
simulated editor session and is for development only.

An interrupted copy remains visible as **Copy incomplete**. Retry **Duplicate**
on the original creation in the same browser session to resume the same copy,
including after reloading. Or delete the incomplete copy before starting again.
The API blocks editing and publication until copying finishes. An interrupted
deletion remains visible as **Deletion unfinished**; retry its Delete action.

Completed deletions retain only an internal identifier marker, without the
story text, to prevent late saves from restoring the removed creation. Storage
version retention, backups, and a previously issued upload URL's short validity
window follow the existing AWS storage policy; this is not a promise to purge
every historical backup. No infrastructure is deleted by these controls.

## Validate locally without AWS calls

Use Node 22 or newer. This Mac also has a bundled Node runtime that can be used
without changing system software:

```sh
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
node --version
cd "$HOME"
git clone --branch codex/content-admin-actions \
  https://github.com/NorthCountryEngineer/Axolotl_News.git \
  axolotl-content-preview
cd "$HOME/axolotl-content-preview"
npm ci --no-audit --no-fund
VITE_APP_MODE=local npm run dev -- --port 5178 --strictPort
```

Open `http://127.0.0.1:5178/`. Choose **Editor's desk → Open local editor**.
Create a disposable fun fact, give it a title, and save it. The menus should be
absent while the header toggle is off. Turn it on and verify:

- Each creation and content block gets an ellipsis with all three actions.
- Escape closes the menu and returns focus to its trigger.
- Duplicate creates a separate draft with the original still present.
- Update selects the intended creation or block.
- Cancelling Delete preserves the creation. Confirming Delete on your disposable
  creation removes it from the local list.
- Publishing locally makes a card appear on the homepage with the same menu.
- Turning the toggle off and signing out hide the admin controls.

Stop the preview with Control-C, then run:

```sh
npm run typecheck
npm test
python3 -m unittest discover -s tests -p 'test_nce_api.py'
npm run build:preview
```

These checks use local storage or stubbed service responses. They do not deploy
or invoke AWS workloads.

## Release the changes

The frontend and Lambda API must both receive this release. No Core migration,
new IAM permissions, new service, or paid subscription is required. Publishing
to the live AWS application is a separate user-run operation; ordinary hosting,
build, request, and storage charges still apply.

1. Merge the reviewed PR to `main` in `NorthCountryEngineer/Axolotl_News`.
2. Update your local checkout with `git switch main` and `git pull --ff-only`.
3. In that checkout, select the intended AWS account. These commands are for your
   existing deployment; stop if the account is not `015454941623`:

```sh
export PATH="$HOME/.local/bin:$PATH"
export AWS_PROFILE="axolotl-deploy"
export AWS_REGION="us-east-1"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_PAGER=""
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
aws sts get-caller-identity --profile axolotl-deploy --region us-east-1
```

If expired, run `aws login --profile axolotl-deploy`, then check the account again.

4. Package the API locally and copy the release files outside Documents, avoiding
   the Terminal file-access issue encountered during the original deployment:

```sh
python3 scripts/package-api.py
export AXOLOTL_ADMIN_CODE_KEY="releases/$(git rev-parse HEAD)/axolotl-api.zip"
mkdir -p "$HOME/.axolotl-aws/content-admin"
cp infra/aws/build/axolotl-api.zip "$HOME/.axolotl-aws/content-admin/axolotl-api.zip"
cp infra/aws/axolotl.template.json "$HOME/.axolotl-aws/content-admin/axolotl.template.json"
```

5. The following commands change your live AWS deployment. Run them only when you
   authorize its normal AWS charges. Upload the new code and update the existing
   stack, preserving the values of all other existing parameters:

```sh
aws s3 cp "$HOME/.axolotl-aws/content-admin/axolotl-api.zip" \
  "s3://axolotl-news-code-015454941623-us-east-1/${AXOLOTL_ADMIN_CODE_KEY:?Run step 4 first}" \
  --profile axolotl-deploy --region us-east-1

aws cloudformation deploy \
  --stack-name axolotl-news-production \
  --template-file "$HOME/.axolotl-aws/content-admin/axolotl.template.json" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "LambdaCodeKey=${AXOLOTL_ADMIN_CODE_KEY:?Run step 4 first}" \
  --profile axolotl-deploy --region us-east-1
```

Wait for successful stack completion. Release the backend before the frontend:
the new frontend uses `POST /posts/{id}/duplicate` and
`DELETE /posts/{id}/content`. No new stack or database migration is needed.

6. Start a new Amplify build of the merged main branch, retaining its existing
   environment settings. This starts billable build work:

```sh
aws amplify start-job --app-id d2v2mlkst3io2a --branch-name main \
  --job-type RELEASE --profile axolotl-deploy --region us-east-1
```

Open the existing Axolotl app in the AWS Amplify console and wait for that build
to show **Deployed** before testing.

7. Sign in at `https://axolotl.news/studio`, turn on Admin actions, and repeat the
   checks using a disposable creation. Verify a second account with only
   `posts-write` can edit drafts but does not receive the admin toggle, and an
   anonymous reader sees neither the toggle nor ellipsis menus.

This feature does not edit the fixed field guide or the original Canva video.
New fun facts, photos, videos, newsletters, and stories created in the newsroom
use the editable content model above.
