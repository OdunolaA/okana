// Okana: pulls sprint, velocity, roadmap, milestone and release data from Jira Cloud
// and writes it to data/jira.json for the Okana app to read.
//
// Runs in GitHub Actions (see .github/workflows/okana.yml). Needs Node 18+ (built-in fetch).
//
// Settings (GitHub repository secrets and variables):
//   JIRA_BASE_URL        secret    e.g. https://your-team.atlassian.net
//   JIRA_EMAIL           secret    the Atlassian account email that owns the API token
//   JIRA_API_TOKEN       secret    from https://id.atlassian.com/manage-profile/security/api-tokens
//   JIRA_PROJECT_KEY     variable  e.g. ATLAS
//   JIRA_BOARD_ID        variable  the number in your board's URL (.../boards/12)
//   JIRA_POINTS_FIELD    variable  optional, story points field id (default customfield_10016)
//
// Roadmap conventions in Jira (so Okana can read them):
//   Epics with a label "now", "next" or "later" appear on the roadmap in that lane.
//   A label "confidence-high", "confidence-medium" or "confidence-low" sets the confidence.
//   The epic's due date is shown as its date.
//   Unreleased Jira versions (releases) with a release date appear as milestones.
//   Released versions appear as release notes.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const env = process.env;
const BASE = (env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const PROJECT = env.JIRA_PROJECT_KEY || "";
const BOARD = env.JIRA_BOARD_ID || "";
const POINTS = env.JIRA_POINTS_FIELD || "customfield_10016";
const OUT = env.OKANA_OUT || "data/jira.json";
const HISTORY = env.OKANA_HISTORY || "data/jira-history.json";

if (!BASE || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN || !PROJECT || !BOARD) {
  console.log("Jira is not configured yet (missing secrets or variables). Okana will keep using sample data.");
  process.exit(0);
}

const auth = "Basic " + Buffer.from(env.JIRA_EMAIL + ":" + env.JIRA_API_TOKEN).toString("base64");

async function jira(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira returned ${res.status} for ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Pages through any Jira list endpoint that uses startAt / maxResults.
async function all(path, key) {
  const out = [];
  let startAt = 0;
  for (let guard = 0; guard < 100; guard++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await jira(`${path}${sep}startAt=${startAt}&maxResults=50`);
    const items = page[key] || [];
    out.push(...items);
    if (page.isLast === true || items.length === 0 || out.length >= (page.total ?? Infinity)) break;
    startAt += items.length;
  }
  return out;
}

// Jira's issue search (/rest/api/3/search/jql) pages with nextPageToken.
async function searchJql(jql, fields) {
  const out = [];
  let token = "";
  for (let guard = 0; guard < 100; guard++) {
    const q = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100` + (token ? `&nextPageToken=${encodeURIComponent(token)}` : "");
    const page = await jira(q);
    out.push(...(page.issues || []));
    if (page.isLast !== false || !page.nextPageToken) break;
    token = page.nextPageToken;
  }
  return out;
}

const points = (issue) => Number(issue.fields?.[POINTS]) || 0;
const isDone = (issue) => issue.fields?.status?.statusCategory?.key === "done";
const dayMs = 86400000;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const fmtShort = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
const fmtMonth = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "No date";

async function sprintIssues(sprintId) {
  return all(`/rest/agile/1.0/sprint/${sprintId}/issue?fields=summary,status,${POINTS}`, "issues");
}

async function main() {
  const now = new Date();

  // Current sprint
  const active = await all(`/rest/agile/1.0/board/${BOARD}/sprint?state=active`, "values");
  if (active.length === 0) throw new Error("No active sprint on board " + BOARD + ".");
  const sp = active[0];
  const issues = await sprintIssues(sp.id);
  const total = issues.reduce((s, i) => s + points(i), 0);
  const remainingNow = issues.filter((i) => !isDone(i)).reduce((s, i) => s + points(i), 0);
  const start = new Date(sp.startDate), end = new Date(sp.endDate);
  const length = Math.max(1, Math.round((end - start) / dayMs));
  const day = Math.min(length, Math.max(0, Math.floor((now - start) / dayMs)));

  // Burndown: Jira's API has no daily history, so Okana records one value per day on each run.
  let history = {};
  try { history = JSON.parse(await readFile(HISTORY, "utf8")); } catch { history = {}; }
  const h = history[sp.id] || { total, days: {} };
  h.total = total;
  h.days[day] = remainingNow;
  history = { [sp.id]: h }; // keep only the current sprint
  const remaining = [];
  for (let d = 0; d <= day; d++) {
    if (h.days[d] !== undefined) remaining.push(h.days[d]);
    else remaining.push(d === 0 ? total : remaining[remaining.length - 1]);
  }

  // Velocity: completed points in the last 12 closed sprints (the current sprint is left out until it closes)
  const closed = (await all(`/rest/agile/1.0/board/${BOARD}/sprint?state=closed`, "values"))
    .sort((a, b) => new Date(a.completeDate || a.endDate) - new Date(b.completeDate || b.endDate))
    .slice(-12);
  const velocity = [];
  for (const c of closed) {
    const ci = await sprintIssues(c.id);
    velocity.push([c.name.replace(/^.*?(\d+)$/, "S$1"), ci.filter(isDone).reduce((s, i) => s + points(i), 0)]);
  }

  // Roadmap from epics labelled now / next / later
  const epics = await searchJql(`project = "${PROJECT}" AND issuetype = Epic AND labels in ("now", "next", "later") ORDER BY duedate ASC`, "summary,labels,duedate");
  const roadmap = epics.map((e) => {
    const labels = (e.fields.labels || []).map((l) => l.toLowerCase());
    const lane = ["now", "next", "later"].find((l) => labels.includes(l)) || "later";
    const c = labels.find((l) => l.startsWith("confidence-"));
    const conf = c ? c.replace("confidence-", "").replace(/^./, (x) => x.toUpperCase()) : "Low";
    return { name: e.fields.summary, when: fmtMonth(e.fields.duedate), lane, conf: ["High", "Medium", "Low"].includes(conf) ? conf : "Low" };
  });

  // Milestones and release notes from Jira versions
  const versions = await jira(`/rest/api/3/project/${PROJECT}/versions`);
  const upcoming = versions.filter((v) => !v.released && !v.archived && v.releaseDate)
    .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate)).slice(0, 5)
    .map((v) => {
      const due = new Date(v.releaseDate), daysLeft = (due - now) / dayMs;
      const status = v.overdue || daysLeft < 0 ? "Off track" : v.startDate ? (daysLeft < 7 ? "At risk" : "On track") : "Not started";
      return [v.name, fmtDate(v.releaseDate), status];
    });
  const releases = versions.filter((v) => v.released)
    .sort((a, b) => new Date(b.releaseDate || 0) - new Date(a.releaseDate || 0)).slice(0, 3)
    .map((v) => [v.name, fmtShort(v.releaseDate), v.description || "Released"]);

  const data = {
    fetchedAt: now.toISOString(),
    projectKey: PROJECT,
    boardId: BOARD,
    sprint: {
      number: Number(String(sp.name).match(/(\d+)\s*$/)?.[1]) || sp.id,
      goal: sp.goal || sp.name,
      day, length, total, remaining
    },
    velocity, roadmap, milestones: upcoming, releases
  };

  await mkdir(OUT.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n");
  await writeFile(HISTORY, JSON.stringify(history, null, 2) + "\n");
  console.log(`Synced sprint "${sp.name}": ${remainingNow} of ${total} points left, ${roadmap.length} roadmap items, ${upcoming.length} milestones.`);
}

main().catch((err) => {
  console.error("Jira sync failed: " + err.message);
  process.exit(1);
});
