# Connected Game Studio

Axolotl News connects to an independently deployed Game Studio. Newsroom administrators (`posts-write` and `posts-publish`) see **Game studio** in the Editor’s desk and Games shelf. It opens Game Studio as a full page with `host=axolotl-news&login=auto`. Game Studio starts its own Core authorization-code/PKCE flow once. The existing Core browser session can satisfy sign-in without entering credentials again; Game Studio still checks its own service access. An expired Core session or an authentication policy can require normal sign-in. No newsroom token, account claim, password, or role travels in the URL or iframe.

The standalone installation must have an approved `axolotl-news` host with origin `https://axolotl.news` and return path `/games`. The Core integration must explicitly authorize the intended newsroom administrators for Game Studio. A link or host ID alone grants no permissions. Creation is administrative; ordinary signed-in players retain their existing score-submission access.

## Public deployment configuration

Add the following optional object to the existing public `NCE_PUBLIC_CONFIG_JSON` value, retaining all existing issuer/client/API identifiers:

```json
{
  "game_studio": {
    "origin": "https://production.d2z19juex5y7z7.amplifyapp.com",
    "api_url": "https://go95sum8ni.execute-api.us-east-1.amazonaws.com",
    "host_id": "axolotl-news"
  }
}
```

This snippet is an object to merge into the existing configuration, not a replacement for it. Both URLs must be exact HTTPS origins without trailing slashes, paths, query strings, credentials or fragments. Extra fields are rejected. `scripts/write-core-config.mjs` also retains and validates this object when it is present in a registration file. With the object absent, existing deployments and local previews retain the legacy workshop. Local preview never loads the external catalog.

Allow the configured studio origin in any hosting `frame-src` policy and its API origin in `connect-src`. The standalone service must allow Axolotl’s exact origin in its public API CORS and approved player framing configuration. Public catalog requests omit credentials and reject redirects; private creation is never framed.

## Existing games and scores

Existing `/games/<uuid>` links, saved seeds, published revisions, drafts, conversations, table keys and high-score APIs stay in Axolotl News. No game is copied, migrated, republished or unpublished by connecting Game Studio. Browser-only data retains the original `axolotl-games:v1` and `axolotl-game-scores:v1` keys.

Administrators manage existing drafts at `/game-studio/legacy`; old `/game-studio?game=<uuid>` bookmarks still open that draft. **New game** sends administrators to the standalone service when configured. Editing an existing draft retains the last published version and score board. Existing lifecycle rules continue to apply when an administrator deliberately republishes, unpublishes, or deletes a game.

The Games shelf adds published standalone games with source-qualified identities. Standalone routes use `/games/studio/<uuid>`, so even an identical UUID cannot collide with an existing Axolotl game. The approved standalone iframe owns schema validation, play, and its own boards, including newer game formats. **Open full player and shared high scores** opens its normal top-level player, where Game Studio can authorize shared-score submissions. Embedded guests can use browser-only scores when storage is available. Axolotl does not reinterpret completion messages as identity, authorization, or earned points.

A standalone catalog outage or invalid catalog leaves existing Axolotl cards available. The catalog is read-only and its public navigation return values never write newsroom content automatically.

## Release and acceptance

Release the API before the frontend so non-administrators cannot reach the old authoring API through stale tabs. This release changes no CloudFormation resources, IAM policies, tables, DNS, newsletter content, or model configuration. Follow the existing API-first deployment process with the current parameters and code artifact; stop for any proposed resource replacement or deletion.

Before release, privately snapshot the existing game draft/public records and board payloads. After release, compare them byte for byte or by canonical hashes without printing private conversations or internal player identifiers. Confirm existing public game IDs, revisions, definitions and scores are unchanged. Do not republish existing games as a smoke test.

Check anonymous play and board reads still work, signed-in ordinary players can submit as before, and an editor without `posts-publish` receives `403` for private game/settings/authoring routes. A newsroom administrator can open the retained draft editor and the standalone creator; confirm its new Core token belongs to Game Studio rather than Axolotl. Test a temporary standalone draft, return to the configured host, and verify the separate catalog/player route. Preserve real games and boards throughout acceptance.
