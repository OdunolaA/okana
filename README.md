# Okana

**Live demo:** https://odunolaa.github.io/okana

Okana shows sales teams and leadership how a software product is progressing and how it stacks up against the market, using real delivery data instead of status updates.

## The problem

Sales teams walk into client demos unsure what they can promise. CEOs hear progress from their product managers but rarely see evidence. The data exists, in Jira, Salesforce, Pendo and public reviews of competitors, but nobody outside the product team can read it.

## What Okana does

| Page | Who it's for | What it shows |
|---|---|---|
| Setup guide | Admins | Seven steps to connect Jira, Salesforce, Pendo and review sources |
| About the product | Everyone | Team, vision, ICP, ARR goal, CEO snapshot, sales quick answers |
| Product progress | Leadership | Sprint, burndown, velocity, roadmap with confidence, milestones, demos |
| Market position | Leadership | Okana score, feature comparison, competitor complaints, trends |
| Demo prep (Sales view) | Sales | What to promise, what's coming, demos, battlecards |

Statuses use red, amber and green, with text labels so they still read without colour.

## The Okana score

How much of what competitors' customers complain about the product already solves or plans to solve:

- Each complaint theme is weighted by how often it's mentioned in public reviews.
- Solved today counts 1. On the roadmap counts by confidence: High 0.8, Medium 0.5, Low 0.2. Not addressed counts 0.
- Score = points ÷ all mentions × 100. 80+ is green, 60–79 amber, below 60 red.

## How it works

```
Jira Cloud ──(GitHub Action, hourly)──> data/jira.json ──> index.html on GitHub Pages
                                                    Pendo <── page views (optional)
```

- **index.html** is the whole app: plain HTML, CSS and JavaScript, no build step.
- Each data source has an adapter (`jiraAdapter`, `salesforceAdapter`, `reviewsAdapter`). Without live data they return sample data for a fictional product, Atlas.
- **scripts/fetch-jira.mjs** reads the active sprint, closed sprints, roadmap epics and versions from Jira and writes `data/jira.json`. The Jira API token stays in GitHub Secrets and never reaches the browser.
- Jira has no daily burndown history in its API, so the sync records remaining points each day in `data/jira-history.json`.
- **.github/workflows/okana.yml** runs the sync every hour and publishes the site.

## Connecting Jira

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens.
2. In this repository: **Settings → Secrets and variables → Actions**.
   - Secrets: `JIRA_BASE_URL` (e.g. `https://your-team.atlassian.net`), `JIRA_EMAIL`, `JIRA_API_TOKEN`
   - Variables: `JIRA_PROJECT_KEY` (e.g. `ATLAS`), `JIRA_BOARD_ID` (the number in your board's URL), optionally `JIRA_POINTS_FIELD`
3. In Jira, label roadmap epics `now`, `next` or `later`, plus `confidence-high`, `confidence-medium` or `confidence-low`, and give them due dates. Unreleased versions with release dates become milestones.
4. Run **Actions → Okana sync and deploy → Run workflow**.

## Usage tracking with Pendo

Set `pendoApiKey` in the `OKANA_CONFIG` block near the top of the script in `index.html`. Okana sends anonymous visitor IDs and one event per page view (`Okana page viewed`, with page, view and period). Tracking stays off while the key is empty.

## Project management

The backlog lives on the [Okana roadmap](../../projects) board. `scripts/setup-project.sh` creates the board, labels and issues with the GitHub CLI.

## What's next

1. Pilot with one product team and log feedback as issues
2. Connect Salesforce for live ARR
3. Weekly competitor review collection and AI theme summaries
4. v2 pages: Geo position, Product health, Transformation readiness, Sales status, Documents
5. Sign-in with Leadership and Sales roles

