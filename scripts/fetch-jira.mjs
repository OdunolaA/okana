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
//   Product health uses issues of type Bug (with priority), done epics, and backlog items in To Do.

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

// ---------- Product health ----------
const PRIORITIES = ["Highest", "High", "Medium", "Low"];
const FIX_TARGET_DAYS = { Highest: 2, High: 5, Medium: 15, Low: 30 };
const priorityOf = (i) => { const n = i.fields?.priority?.name || "Medium"; return n === "Lowest" ? "Low" : PRIORITIES.includes(n) ? n : "Medium"; };
const ageDays = (from, to) => (new Date(to) - new Date(from)) / dayMs;
const avg = (xs) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };

// Time buckets for each period filter in the app: [label, from, to]
function buckets(period, now) {
  const day0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out = [];
  if (period === "week") for (let k = 6; k >= 0; k--) { const f = new Date(+day0 - k * dayMs); out.push([f.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), f, new Date(+f + dayMs)]); }
  if (period === "month") for (let k = 3; k >= 0; k--) { const t = new Date(+day0 + dayMs - k * 7 * dayMs), f = new Date(+t - 7 * dayMs); out.push([fmtShort(f), f, t]); }
  if (period === "quarter") for (let k = 2; k >= 0; k--) { const f = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); out.push([f.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), f, new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1))]); }
  if (period === "year") { const q = Math.floor(now.getUTCMonth() / 3); for (let k = 3; k >= 0; k--) { const f = new Date(Date.UTC(now.getUTCFullYear(), (q - k) * 3, 1)); out.push([`Q${Math.floor(f.getUTCMonth() / 3) + 1} ${String(f.getUTCFullYear()).slice(2)}`, f, new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 3, 1))]); } }
  return out;
}

async function productHealth(now) {
  const P = `project = "${PROJECT}"`;
  const open = await searchJql(`${P} AND issuetype = Bug AND statusCategory != Done`, "priority,created");
  const fixed = await searchJql(`${P} AND issuetype = Bug AND statusCategory = Done AND resolved >= -460d`, "priority,created,resolutiondate");

  const openBugs = Object.fromEntries(PRIORITIES.map((p) => [p, 0]));
  open.forEach((i) => openBugs[priorityOf(i)]++);

  const last90 = fixed.filter((i) => i.fields.resolutiondate && ageDays(i.fields.resolutiondate, now) <= 90);
  const fixTime = PRIORITIES.map((p) => [p, FIX_TARGET_DAYS[p], avg(last90.filter((i) => priorityOf(i) === p).map((i) => ageDays(i.fields.created, i.fields.resolutiondate)))]);

  const inside = (d, f, t) => { const x = new Date(d); return x >= f && x < t; };
  const bugFlow = {};
  for (const period of ["week", "month", "quarter", "year"]) {
    const b = buckets(period, now);
    bugFlow[period] = {
      labels: b.map((x) => x[0]),
      opened: b.map(([, f, t]) => [...open, ...fixed].filter((i) => inside(i.fields.created, f, t)).length),
      closed: b.map(([, f, t]) => fixed.filter((i) => i.fields.resolutiondate && inside(i.fields.resolutiondate, f, t)).length)
    };
  }

  // Time to feature: days from an epic being created to it being done
  const epicsDone = (await searchJql(`${P} AND issuetype = Epic AND statusCategory = Done AND resolved >= -365d ORDER BY resolved DESC`, "summary,created,resolutiondate"))
    .filter((e) => e.fields.resolutiondate);
  const took = (e) => Math.round(ageDays(e.fields.created, e.fields.resolutiondate));
  const recentHalf = epicsDone.filter((e) => ageDays(e.fields.resolutiondate, now) <= 182);
  const olderHalf = epicsDone.filter((e) => ageDays(e.fields.resolutiondate, now) > 182);
  const timeToFeature = { days: median(recentHalf.map(took)), previous: median(olderHalf.map(took)), recent: epicsDone.slice(0, 4).map((e) => [e.fields.summary, took(e)]) };

  // Backlog: work not started yet (epics left out)
  const backlogItems = await searchJql(`${P} AND statusCategory = "To Do" AND issuetype != Epic`, "created");
  const backlog = { items: backlogItems.length, old: backlogItems.filter((i) => ageDays(i.fields.created, now) > 90).length };

  console.log(`Product health: ${open.length} open bugs, ${epicsDone.length} epics done this year, ${backlog.items} backlog items.`);
  return { openBugs, fixTime, bugFlow, timeToFeature, backlog };
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

  // Product health (v2): bugs, time to feature and backlog age. Skipped, not fatal, if the space has no Bug type.
  let health = null;
  try { health = await productHealth(now); }
  catch (err) { console.log("Product health skipped: " + err.message); }

  const data = {
    fetchedAt: now.toISOString(),
    projectKey: PROJECT,
    boardId: BOARD,
    sprint: {
      number: Number(String(sp.name).match(/(\d+)\s*$/)?.[1]) || sp.id,
      goal: sp.goal || sp.name,
      day, length, total, remaining
    },
    velocity, roadmap, milestones: upcoming, releases, health
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
