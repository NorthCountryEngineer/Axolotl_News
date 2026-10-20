# Newsroom accounts

Open **Editor’s desk → Accounts** as an authorized administrator. Enter the person’s email and optional name, choose Editor, Publisher or Administrator, then choose **Create invitation**. Copy the private invitation link and give it to that person. It is shown once, expires after 48 hours and can be revoked before acceptance. Axolotl News does not send email.

The person creates their password on Core’s invitation page. If their Core account already exists, they sign in with that account first. They keep the same Core UUID and password across applications. Creating an invitation does not create another local password or join an existing identity merely because someone typed its email. The requested application access becomes active when that identity explicitly accepts the invitation.

- **Editor** creates and edits stories and uses configured assistants.
- **Publisher** also publishes, duplicates and removes newsroom content.
- **Administrator** also configures assistants and manages Axolotl News accounts and invitations.

These are application roles. An Axolotl administrator does not become a Core organization or platform administrator. The server checks Core’s current `admin` or this service’s `accounts-manage` permission before listing accounts or creating/revoking invitations. Content publishing alone does not grant account administration. Account grants are bound to this registered application and environment; they do not open another application or grant organization-wide access tags.

The current release supports account listing, invitation creation and invitation revocation. An existing app account or legacy application access cannot be invited again. An invitation does not reactivate disabled access or replace an existing role. Core organization administration retains global membership and identity lifecycle controls.

## Release dependencies

Account management requires the Core application-account API and `identity.0012_application_accounts`, plus an upgrade of the existing Axolotl identity package to the reviewed `nce/marketplace.json` version 1.1.0. This adds the explicit `accounts-manage` and `agents-manage` permissions and the three `account_roles`. The Core additive upgrade command preserves existing clients, credential parameters and capability grants. It creates no infrastructure and no person.

Deploy Core/migration/package metadata before the Axolotl API and frontend. The API forwards only allowed account fields to Core using its existing confidential resource client plus the human’s current access token; credentials stay on the server. A missing Core upgrade is surfaced as an actionable failure, never as a successful account creation.

`GET /admin/accounts`, `POST /admin/accounts/invitations` and `DELETE /admin/accounts/invitations/{id}` are authenticated application API routes. `/session` returns `canManageAccounts` from current explicit Core authority. Account and invitation responses are private and noncached; the invitation secret is never returned by later listings. Local previews use separate synthetic browser data and do not create a Core account.
