# Axolotl News

A family axolotl publication with a visual editor, newsletters, photos, video, PDFs and the young creator's Canva story. Public readers need no account. Editors sign in through **NCE Core**; Core controls current editing and publishing permissions.

## Deploy with NCE Core

Follow the numbered [AWS deployment guide](docs/AWS_DEPLOYMENT.md) for **both applications**, their bootstrap and permissions, and Cloudflare DNS. It includes the exact commands and settings; no AWS resources have been deployed by this project.

| Application | Frontend | Backend |
| --- | --- | --- |
| NCE Core | Amplify Hosting Node SSR proxy | Django + worker on ECS Fargate, private RDS PostgreSQL |
| Axolotl News | Amplify Hosting static React | HTTP API + Lambda, on-demand DynamoDB, private S3 |

Core keeps its default Amplify hostname initially. Its protected HTTPS origin uses `core-origin.axolotl.news`; the publication uses `axolotl.news`. The [marketplace package](nce/marketplace.json) registers an externally hosted Core application. Registration does not provision AWS infrastructure. Core's Kubernetes connector is unnecessary for this deployment.

**No cloud resources, subscriptions or DNS records were created.** Deployment will incur charges. Read the [cost guide](docs/COSTS.md) before executing the deployment steps. Amplify builds also have usage charges; the environment gate is an intentional opt-in, not a bill cap.

Core changes are supplied separately in the NCE_Core repository; apply that feature branch before deployment. This source contains no AWS credentials, client secrets, private keys or Canva editor links.

## Free local preview

Node.js 20.18+ is required. On this laptop dependencies are already installed. A fresh clone needs `npm ci --no-audit --no-fund` (free dependency downloads; no AWS calls). To enforce offline installation, use `npm ci --offline --ignore-scripts --no-audit --no-fund`; it fails if the local cache is incomplete.

```sh
cd Axolotl_News
npm run dev
```

Open `http://127.0.0.1:5173`, then **Editor's desk → Open local editor**. The default mode is local. Drafts and uploads stay in this browser, and local publishing does not contact AWS. Stop with Control-C.

```sh
npm run build:preview
npm run preview
```

The preview build forces local mode. Real production builds require `VITE_APP_MODE=nce` and the public `nce-config.json` described in the guide. Amplify also requires `AXOLOTL_ENABLE_AWS_DEPLOYMENT=true`. Keep secrets out of every frontend build variable.

Local drafts use localStorage and files use IndexedDB. Clearing browser data removes them. Keep original files separately; exported draft JSON contains file references rather than file bytes. Text-only imports are supported. Local data does not migrate automatically into the cloud.

## Publishing features

- Responsive newsroom, category filters, article pages, printable layouts and presentation viewer.
- WYSIWYG headings, formatting, lists, quotes, alignment and undo/redo. Move, duplicate or remove blocks; choose colors, story/newsletter layouts and templates; preview before publishing.
- JPG, PNG, WebP, GIF, MP4, WebM and PDF uploads, captions, alt text and cover selection. Image/PDF limit 10 MB; video limit 50 MB. Core mode enforces exact upload size and allowed MIME type in short-lived S3 upload policies.
- Separate private drafts and public snapshots. Edits remain private until publication; publish copies media into a distinct revision. Unpublish, media cleanup and draft deletion are available.
- Core Authorization Code + PKCE sign-in. Every protected API operation checks the opaque access token against current Core authorization; `posts-write` and `posts-publish` are separate grants. Already issued S3 upload/download URLs remain valid for their short expiry window.
- Explicit Save; no autosave. Keep the tab open and retry failed saves. No analytics, mailing list, public comments or paid editor service is included.

The exact extracted Canva story text is included, with new vector illustrations. Original slide artwork still needs a signed-in free Canva export and upload: [Canva instructions](docs/CANVA.md). Publishing a **Presentation** with PNG slides or a PDF replaces the text edition on the homepage.

## Verification

```sh
npm run typecheck
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm run build:preview
python3 scripts/package-api.py
```

Tests cover document sanitization, Core PKCE/callback/refresh behavior, live authorization, private/public separation, signed upload constraints and cleanup concurrency. [Verification record](docs/VERIFICATION.md) distinguishes local checks from the required deployed smoke tests. AWS, DNS, TLS, and Amplify SSR behavior must be checked after you choose to deploy.

## Source

| Path | Purpose |
| --- | --- |
| `src/components/Studio.tsx` | Visual publishing editor |
| `src/lib/core.ts` | Core login and HTTP API adapter |
| `backend/nce_api/handler.py` | Live Core authorization, stories and media API |
| `infra/aws/axolotl.template.json` | Serverless AWS infrastructure |
| `nce/marketplace.json` | Core application package |
| `nce-config.example.json` | Public frontend configuration example |
| `amplify.yml` | Guarded hosting build |
| `docs/AWS_DEPLOYMENT.md` | Default two-application deployment runbook |

An optional independent Cognito/AppSync/Amplify Gen 2 variant remains in `amplify/`, with [standalone instructions](docs/DEPLOYMENT.md). Select one backend mode deliberately; the Core deployment does not provision that additional backend.

Dependencies are locked to versions available in the original local cache. No online vulnerability audit ran under the internet restriction. Review and update dependencies before production. Fun facts are adapted from [San Diego Zoo Wildlife Alliance](https://animals.sandiegozoo.org/animals/axolotl).
