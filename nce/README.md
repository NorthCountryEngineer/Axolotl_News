# Axolotl News Core package

[`marketplace.json`](marketplace.json) installs this application's identity and permission vocabulary in NCE Core. The matching package is bundled in Core at `examples/axolotl-news-package.json` and `/app/examples/axolotl-news-package.json` in its AWS image. The application runs in AWS Amplify with its own Lambda API, DynamoDB tables and S3 bucket. Registering it in Core creates no hosting resources and makes no purchase or subscription.

Use the full [AWS deployment guide](../docs/AWS_DEPLOYMENT.md) for the two applications, DNS, database bootstrap, dedicated registration task and AWS resources. Core's `docs/external-applications.md` describes the generic external application contract and local registration alternative.

The package declares `external_runtime: "aws-amplify"`, `/oauth/callback`, dependency `core-platform`, and two permissions on its own Core authorization service:

- `posts-write`: read private drafts, create/edit drafts and upload draft media.
- `posts-publish`: publish/unpublish and, together with `posts-write`, copy public media or remove posts/media.

Readers remain anonymous. Give the author an ordinary Core organization membership and an editor role with the desired permissions plus the matching environment boundary tag. Core's catalog opens the public homepage; **Editor's desk** starts the PKCE sign-in flow. Organization administrators are not required for writing or publishing.

Register `https://axolotl.news` as the production origin. Core creates a public browser client with that exact origin and callback, and a separate confidential resource client scoped to the same installation/environment. The origin and client placement become immutable. Deploy a separate staging environment/registration when a second authenticated hostname is needed.

The one-off Core command exports public registration JSON to stdout and transfers the private `{ "client_id": "…", "client_secret": "…" }` directly to `/axolotl-news/core-resource-client` using its dedicated task role:

```sh
python manage.py register_external_application \
  --organization family \
  --environment production \
  --package examples/axolotl-news-package.json \
  --origin https://axolotl.news \
  --actor-email YOUR_EXISTING_CORE_ADMIN_EMAIL \
  --credentials-parameter /axolotl-news/core-resource-client
```

This command requires the existing organization, active production environment and administrator. The explicit SSM mode performs one AWS SecureString write and never overwrites an existing parameter. The Lambda reads that private credential; the Amplify frontend never receives it. For local registration, Core also supports a new `--credentials-file` with mode `0600` instead of SSM. Keep private files under ignored Core `.local/` or outside both repositories.

Save the command's public JSON as `core-public.json`, then generate the Axolotl frontend's public configuration from this repository root:

```sh
node scripts/write-core-config.mjs /PRIVATE_OPERATOR_DIRECTORY/core-public.json https://YOUR_HTTP_API_ID.execute-api.YOUR_REGION.amazonaws.com
```

This writes nonsecret `nce-config.json` containing issuer, organization/service IDs, browser client ID, callback and API origin. It must not contain a resource-client secret. Build and redeploy Amplify after changing this file.

The browser uses authorization-code PKCE `S256` with `state` and scope `openid authorization`. It sends opaque Core access tokens to the API. The ID token is discarded. Every protected API request uses server-side Core introspection and checks current permissions; a stale role or disabled membership cannot continue editing. Public content uses a separate DynamoDB table and published S3 revision keys.

The implementation and package are complete locally. The deployment guide's AWS, SSM, database, registration and DNS steps are future operator actions: no paid resource was provisioned and no live organization was registered during development.
