# Private feedback and development proposals

Signed-in newsroom users can choose **Share an idea** from the header without leaving their current work. The form accepts an idea, problem, or improvement, an app section, and a description. Including the current section is optional; only a fixed section name is sent, never a query string, draft, media, or page content.

**Editor’s desk → Ideas & feedback** opens the idea box at `/feedback`. Authors see their own notes, progress, and reviewer replies. They can update their own notes while those notes are New or We're looking and submissions remain open. Other users' feedback and technical proposals are not visible to authors.

## Reviewing feedback

A reviewer needs current Core `posts-write` permission plus `posts-publish` or `admin`. The API checks Core authorization on every request. Reviewers can read the inbox, edit notes, save a progress update and reply, request development proposals, and approve a proposed approach. With **Admin actions** enabled, each note also has the existing ellipsis menu for Update, Duplicate, and Delete. Deletion removes the note, reply, and proposal from the workspace; a small private tombstone prevents reuse of its identifier.

Replies and progress updates are the author-facing conversation. Proposal generation and approval leave that progress unchanged until a reviewer explicitly saves an update. Duplicates start as new notes without replies, approval, or prior planning history. Stable request identifiers recover creation and duplication responses after a connection failure without creating additional copies.

## Proposing an approach

Select a note and choose **Propose development approach**. A proposal contains an outcome, approach, implementation steps, files to inspect, acceptance criteria, tests, risks, open questions, and a provisional scope assessment.

The default **Free guided planner** produces an architecture-aware starting template with no model call. To use an AI planner, a feedback administrator can select an enabled writing assistant in **Idea box settings → Development planner**. Configuring feedback requires reviewer permission plus `agents-manage` or `admin`. Assistant configuration remains in the existing Agent settings.

The selected mode must be accessible to the requesting reviewer and have an enabled agent, workflow, and local or Bedrock writing model. Planning uses the saved agent instructions, model, mode audience, model execution authorization, and configured input, turn, and call limits. It does not execute the post/media workflow graph. Paid models require the existing administrator authorization and deployed provider permissions. Opening or submitting feedback never calls a model. Local preview always uses the free guided planner, even when a mode is selected.

The agent receives the note and the versioned architecture snapshot in `config/feedback-architecture.json`. It has no live repository access, tools, shell, deployment authority, or GitHub connection. File references must come from that snapshot. Update the snapshot when application paths or architecture change. AI plans are suggestions for a human developer, not proof of implementation or test results.

Review the plan and choose **Approve development approach** to enable **Copy brief** and **Download development brief**. The Markdown brief is a handoff for a developer or coding agent. Approval does not implement, publish, deploy, or send anything. Export rechecks current reviewer access and the saved proposal. Editing the source note invalidates its prior approval and marks the old proposal out of date; request and review a fresh plan before exporting again.

## Failed or uncertain planning

The API reserves a paid request before invoking the provider and disables SDK retries for that call. An exact completed retry returns saved state. Pending or uncertain calls are never automatically replayed. **Check saved result** reloads the stored result. If the request remains unfinished, **Clear unfinished request** saves the note with a revision check and clears the pending state. The earlier call may already have incurred a provider charge. Clearing does not invoke a model; requesting a new proposal is a separate deliberate call. Concurrent edits, policy changes, or permission revocation prevent a late result from overwriting newer state.

## Storage and release

Feedback uses the existing private game draft table with separate tenant-scoped `feedback:` and `feedback-config:` key prefixes. It adds no table, public snapshot, new IAM permissions, notification service, or cloud subscription. Local preview stores feedback separately in this browser under `axolotl-feedback-v1`; it is demonstration data and is not synchronized to AWS.

Release the API before the frontend using the existing deployment procedure. `python3 scripts/package-api.py` includes `feedback.py` and the architecture snapshot in the Lambda archive. The existing CloudFormation template needs no resource changes. Do not publish the frontend until the updated API responds to authenticated `/feedback/settings` and `/feedback` requests.

## Validate

1. Run `npm test`, `npm run typecheck`, and `python3 -m unittest discover -s tests -p 'test_*.py'`.
2. Run `npm run build:preview` and `npm run preview -- --port 5174`. Open the local editor, share an idea while editing, and confirm the draft remains intact.
3. Open Ideas & feedback. Save a reply and progress, generate a guided plan, approve it, and download the brief. Edit the original note and confirm the old plan cannot be exported until replaced and approved.
4. Turn Admin actions on and check Update, Duplicate, and Delete on disposable notes. Pause new submissions and confirm earlier notes remain readable; restore the setting afterward.
5. Build the normal frontend with `VITE_APP_MODE=nce npm run build`, using the existing public `nce-config.json`.
6. After an authorized release, test separate author and reviewer accounts: authors see only their own notes and replies, reviewers see the inbox and proposals, and revoking reviewer access clears private reviewer content. Verify signed-out API access is rejected and feedback never appears on public pages.

Backend tests mock Core, DynamoDB, and provider calls. Local preview/browser validation does not establish a live AWS deployment or successful paid provider invocation.
