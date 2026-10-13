# Verification record

Updated October 12, 2026. No AWS resources were provisioned, paid build started, certificate issued, or DNS record changed. GitHub publication is the only external write performed.

## Core integration checks

- Axolotl: 20 TypeScript/Node tests and 17 Python API security/contract tests pass. They cover document sanitization, PKCE/state/issuer checks, one-time callback, refresh rotation, refresh/logout races, live permission revocation, wrong-tenant/service denial, Core outages, private/public separation, upload constraints, copy revisions, and cleanup locking.
- Both TypeScript checks pass. The local preview and NCE production frontend builds pass; the latter used invented HTTPS endpoints and public identifiers, with no cloud requests. The local Lambda ZIP packages successfully.
- NCE Core: 106 selected identity, external registration, modernization and shared-header regression tests passed; 7 AWS runtime/security/template tests and 4 Node proxy tests passed. The CloudFormation template synthesized locally with 33 resources. Proxy installation used the existing cache in offline mode.
- No live database migration ran. Tests use isolated test databases and mock SSM transfer. No Docker image was built or pushed to ECR.

Cloud deployment remains unverified: Core's deployed Amplify proxy/cookie/CSRF transport, ECS image startup, PostgreSQL migration, SSM IAM/KMS, API Gateway integration, S3 signed POST behavior, DNS and TLS require the acceptance checks in [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). These local tests do not establish a working cloud endpoint.

The Core registration command writes public metadata separately from private credentials, and can transfer credentials directly to one dedicated SSM SecureString from a restricted one-off ECS task. Core mode creates no Cognito/AppSync backend. The optional older standalone backend has its separate tests and destructive deletion defaults.

## Earlier local editor and Canva checks

The following original preview/browser record remains relevant to the visual editor. The Core login UI and backend adapter added on October 12 were checked by the automated tests above; they were not tested against AWS.

## Browser checks

The site and editor served successfully on loopback. The following worked in the in-app browser:

- Public homepage, original-story text edition, and field-guide content rendered.
- Desktop editor fit a 1280-pixel viewport without horizontal overflow.
- Local editor created a newsletter layout with text and a sourced fact.
- PNG upload stored in IndexedDB and rendered; alt text and story-cover selection saved.
- Draft save and reopen after browser reload.
- Publish created a separate public article and media copy.
- A saved private draft revision did not change the published article, including after reloading the public route.
- Bold WYSIWYG formatting appeared in the reader preview.

A native browser confirmation blocked further automation while checking unpublish. The app now uses an accessible in-page confirmation dialog for editorial actions and navigation instead of native confirmations; this change passes TypeScript/build checks. The final in-page confirm/cleanup/delete interactions require a manual check. Browser before-unload protection still uses the browser's own standard unsaved-changes prompt.

The desktop and narrow-screen layouts were visually inspected; the narrow-screen headline was adjusted to fit. No cloud authentication or actual S3/AppSync request was tested. Complete the smoke-test checklist in [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md) after you choose to deploy.

## Canva content

The original eight-page Canva design `DAHXRf8lZik` was exported through Canva’s signed-in browser download interface on October 13, 2026, using MP4 Video, 1920 × 1080, all pages, and a single file. The 69.333-second export contains one audio track. The repository MP4 matches the downloaded file byte-for-byte (SHA-256 recorded in `src/data/presentation.json`). The homepage plays this original export instead of the earlier text-only carousel. A poster frame was extracted locally without changing the MP4. No design content, page timing, or sharing permissions were changed; no purchase, subscription, AWS deployment, or cloud build was started for this change.

## Environment and scope

Dependencies were installed only inside the project using the existing npm cache and offline mode. Installation scripts and network audits were disabled. No global packages, system settings, AWS profiles, credentials, subscriptions, were created or modified during the original local implementation. The subsequent GitHub source publication was explicitly authorized. Cloud build/deploy commands exist only as instructions and a guarded recipe.
