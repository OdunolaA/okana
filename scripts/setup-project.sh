#!/usr/bin/env bash
# Creates the Okana GitHub Project board, labels and backlog issues.
# Run once from inside the repository folder:
#   gh auth refresh -s project      (first time only: lets gh manage Projects)
#   bash scripts/setup-project.sh OdunolaA okana
set -euo pipefail

OWNER="${1:-OdunolaA}"
REPO="${2:-okana}"
FULL="$OWNER/$REPO"

echo "Creating labels..."
gh label create "v1"          --repo "$FULL" --color "0E7C86" --description "Prototype scope"            --force
gh label create "v2"          --repo "$FULL" --color "1E4FA8" --description "Next version"               --force
gh label create "integration" --repo "$FULL" --color "E0A100" --description "Connects a data source"     --force
gh label create "research"    --repo "$FULL" --color "8C9AA6" --description "User research and pilots"   --force

echo "Creating the project board..."
PROJECT=$(gh project create --owner "$OWNER" --title "Okana roadmap" --format json --jq '.number')
gh project link "$PROJECT" --owner "$OWNER" --repo "$FULL" || true
echo "Project #$PROJECT created."

# add_issue "title" "body" "labels" "done|open"
add_issue () {
  local url
  url=$(gh issue create --repo "$FULL" --title "$1" --body "$2" --label "$3")
  gh project item-add "$PROJECT" --owner "$OWNER" --url "$url" > /dev/null
  if [ "$4" = "done" ]; then
    gh issue close "$url" --reason completed > /dev/null
  fi
  echo "  $1 ($4)"
}

echo "Adding shipped v1 work..."
add_issue "App shell: sidebar navigation, Leadership and Sales views" "Left navigation, product picker, period filter, audit log, view switch with tooltip. Works on phones." "v1" done
add_issue "Setup guide page" "Seven setup steps with status, opens first until setup is complete." "v1" done
add_issue "About the product page" "Team, vision, ICP, ARR goal, CEO snapshot and sales quick answers." "v1" done
add_issue "Product progress page" "Sprint, burndown, velocity, roadmap with confidence, milestones, demos, release notes." "v1" done
add_issue "Market position page and Okana score" "Score method: solved = 1, roadmap weighted by confidence (High 0.8, Medium 0.5, Low 0.2), weighted by mentions. Includes score over time vs competitor average and target." "v1" done
add_issue "Sales view (Demo prep)" "What sales can promise, coming soon, demos, battlecards, copy to client deck." "v1" done
add_issue "Traffic-light statuses" "Red, amber, green for confidence, milestones, score bands, coverage and setup status." "v1" done

echo "Adding integration work..."
add_issue "Connect Jira through a GitHub Action" "scripts/fetch-jira.mjs runs hourly and writes data/jira.json. Needs JIRA_* secrets and variables." "integration" open
add_issue "Add Pendo usage tracking" "Set pendoApiKey in index.html. Track page views by view and period." "integration" open
add_issue "Connect Salesforce for ARR progress" "Read-only access to opportunities for ARR vs goal." "integration,v2" open
add_issue "Collect competitor reviews weekly" "G2, Capterra and Reddit reviews summarised into complaint themes for the Okana score." "integration,v2" open
add_issue "Replace demo video placeholders" "Link real sprint demo recordings and AI summaries." "v2" open

echo "Adding v2 sections..."
add_issue "Geo position page" "Which countries the product can enter and when, based on features, roadmap and velocity." "v2" open
add_issue "Product health page" "Bugs, time to fix, time to feature, feature completeness, backlog and roadmap health." "v2" open
add_issue "Transformation readiness page" "Verticals the product suits and legacy products or clients that could move to it." "v2" open
add_issue "Sales status page" "Sales vs ARR, client profiles, outreach, demos, pilot tracker and feedback summaries." "v2" open
add_issue "Documents page" "GDPR, export control, cyber, legal and AI policy documents." "v2" open
add_issue "Sign-in and roles" "Leadership and Sales access, with sales users limited to the Sales view." "v2" open

echo "Adding research..."
add_issue "Pilot with a product team" "Run Okana with one team for four weeks and log feedback as issues." "research" open

echo "Done. Open your board: https://github.com/users/$OWNER/projects/$PROJECT"
