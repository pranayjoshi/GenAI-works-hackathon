# Meta Ads sandbox setup (about 15 minutes, free)

Ripple's launch action runs only after the owner approves it. It creates one campaign, two ad sets (one per version, identical ZIP and age targeting, the same fixed daily budget) and one ad per ad set, all **paused**. This is two paused ad sets in one campaign, not Meta's split-test study object. Live launch is optional in the demo: a live attempt in our sandbox currently stops at ad creative ("Select a Facebook Page"), so the demo shows the preview. In a sandbox ad account ads never deliver, so nothing can spend. Ripple never sets anything active.

## What you need

| Item | Where | Goes in `.env` as |
|---|---|---|
| Meta developer account | developers.facebook.com, log in with Facebook, accept the developer terms | |
| An app of type **Business** | developers.facebook.com > My Apps > Create App | |
| **Marketing API** added to the app | App dashboard > Add product > Marketing API | |
| A **sandbox ad account** | Marketing API > Tools > Sandbox Ad Account Management > Create | `META_AD_ACCOUNT_ID=act_<number>` |
| An access token for it, with `ads_management` and `ads_read` | Same row > key icon > Generate access token | `META_ACCESS_TOKEN=...` |
| A Facebook Page you admin (ads need a Page as the identity) | facebook.com/pages/create. Name it something clearly fictional, like "Ripple Demo Café", not a real business | `META_PAGE_ID=<number>` (Page > About > Page ID) |

Optional:

| Item | Goes in `.env` as |
|---|---|
| An Instagram professional account linked to that Page (for an Instagram identity on the ad) | `META_INSTAGRAM_USER_ID=<number>` |
| The link the ad points to (default `https://example.com`) | `META_LINK_URL=...` |
| Daily budget per version in cents (default `500` = $5; never spent while paused) | `META_DAILY_BUDGET_CENTS=500` |

## Steps

1. Create the developer account and the Business app, then add the Marketing API product.
2. In Marketing API > Tools, create a sandbox ad account and generate its access token. Copy both into `.env`.
3. Create the Page and copy its id into `.env`.
4. Restart Ripple (`npm start`), open the demo run, go to the Decision card and press **Approve** on "Run the real test". Ripple creates the paused campaign and shows the ids with links to Ads Manager.

Without these settings the Approve button still works: Ripple shows exactly what it would create (the same payloads) and exports the action plan, and says that nothing was sent to Meta.

## Safety

- Every object is created with `status: PAUSED`. The code refuses any other status.
- Use the sandbox ad account for the demo. A real ad account would also create paused objects, but needs a payment method and Meta's ad review before anything can run.
- The token is read from `.env` only, never logged, and never sent anywhere except `graph.facebook.com`.
