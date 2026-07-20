import {
  ACTIVE_STATUSES,
  DEFAULT_PREFERENCES,
  PIPELINE,
  addDaysKey,
  applicationChecklist,
  bandLabel,
  buildMessage,
  buildTailoring,
  dateKey,
  daysSince,
  decorateJobs,
  deriveStats,
  escapeHtml,
  fitBand,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelativeDate,
  isMaxLocationEligible,
  isMaxRoleEligible,
  localDateKey,
  maxLocationRank,
  nextActionFor,
  normaliseJob,
  normalisePreferences,
  normaliseStatus,
  safeUrl,
  scoreJob,
  slugify,
  sortJobs,
  timeAgo,
  titleCase,
  uniqueList,
} from "./core.js";
import { maxProfile } from "./demo-data.js";
import { downloadTailoredCv } from "./pdf.js";

const KEYS = Object.freeze({
  access: "mjg:access",
  api: "mjg:api",
  cache: "mjg:cache:v2",
  workspace: "mjg:workspace:v1",
  seenIds: "mjg:seen-ids",
  personHint: "mjg:person-hint",
  theme: "mjg:theme",
});

const VIEW_META = Object.freeze({
  today: { eyebrow: "Your focus", title: "Today" },
  discover: { eyebrow: "Fresh opportunities", title: "Discover" },
  pipeline: { eyebrow: "Keep every thread visible", title: "Pipeline" },
  progress: { eyebrow: "Learn, don’t judge", title: "Progress" },
  cv: { eyebrow: "Truthful tailoring", title: "CV & messages" },
  settings: { eyebrow: "Make it yours", title: "Settings" },
});

const state = {
  mode: "local",
  view: initialView(),
  person: null,
  profile: {},
  preferences: normalisePreferences(DEFAULT_PREFERENCES),
  jobs: [],
  searchIndex: [],
  sources: [],
  people: [],
  activity: [],
  scout: {},
  sheetUrl: "",
  generatedAt: "",
  feedSourceCount: 0,
  feedFreshnessDays: 7,
  connected: false,
  offline: false,
  syncing: false,
  search: "",
  searchMode: "all",
  searchLocation: "all",
  searchLimit: 60,
  discoverFilter: "week",
  sort: "location",
  selectedJobId: "",
  cvJobId: "",
  messageKind: "recruiter",
  installPrompt: null,
  pollTimer: null,
  refreshTimer: null,
};

const accessGate = document.querySelector("#accessGate");
const accessStatus = document.querySelector("#accessStatus");
const appRoot = document.querySelector("#appRoot");
const viewContent = document.querySelector("#viewContent");
const jobDialog = document.querySelector("#jobDialog");
const jobDialogContent = document.querySelector("#jobDialogContent");
const addJobDialog = document.querySelector("#addJobDialog");
const accountDialog = document.querySelector("#accountDialog");
const connectionBanner = document.querySelector("#connectionBanner");
const toastRegion = document.querySelector("#toastRegion");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindStaticEvents();
  applyTheme(localStorage.getItem(KEYS.theme) || "system");
  registerServiceWorker();

  loadLocalWorkspace();
}

function bindStaticEvents() {
  document.querySelector("#refreshData")?.addEventListener("click", () => refreshData());
  document.querySelector("#notificationButton")?.addEventListener("click", () => navigate("settings", "alerts"));
  document.querySelector("#openAddJob")?.addEventListener("click", openAddJobDialog);
  document.querySelector("#mobileAddJob")?.addEventListener("click", openAddJobDialog);
  document.querySelector("#personMenu")?.addEventListener("click", openAccountDialog);
  document.querySelector("#lockDevice")?.addEventListener("click", lockDevice);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("keydown", handleDocumentKeydown);
  [jobDialog, addJobDialog, accountDialog].forEach((dialog) => {
    dialog?.addEventListener("close", updateDialogBodyState);
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  window.addEventListener("online", () => {
    state.offline = false;
    renderConnection();
    refreshData({ silent: true });
  });
  window.addEventListener("offline", () => {
    state.offline = true;
    renderConnection();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.connected) refreshData({ silent: true });
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    if (state.view === "settings") render();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    showToast("Installed", "Job Garden is ready from this device’s home screen.", "success");
  });
}

async function connectPrivate() {
  const api = localStorage.getItem(KEYS.api);
  const access = localStorage.getItem(KEYS.access);
  if (!api || !access) {
    loadLocalWorkspace();
    return;
  }

  setAccessStatus("Opening the shared garden…", "");
  try {
    const payload = await jsonpRequest("bootstrap");
    if (!payload?.ok) throw new Error(payload?.error || "Private access was not accepted.");
    hydrate(payload);
    state.connected = true;
    state.offline = false;
    saveCache(payload);
    showApp();
    startPolling();
  } catch (error) {
    const cached = loadCache();
    if (cached) {
      hydrate(cached);
      state.connected = true;
      state.offline = true;
      showApp();
      renderConnection();
      showToast("Offline copy", "Showing the last safely cached version on this device.", "error");
      return;
    }
    loadLocalWorkspace();
    showToast("Working on this device", "The shared service is unavailable, so Job Garden opened normally with local saving.", "error");
  }
}

function loadLocalWorkspace() {
  const saved = loadJson(KEYS.workspace, {});
  state.mode = "local";
  state.person = { id: "max", name: "Max", role: "candidate" };
  state.profile = saved.profile || structuredClone(maxProfile);
  const storedPreferences = normalisePreferences(saved.preferences || DEFAULT_PREFERENCES);
  state.preferences = normalisePreferences({
    ...storedPreferences,
    preferredLocations: uniqueList([...storedPreferences.preferredLocations.filter((place) => String(place).toLowerCase() !== "scotland"), "Edinburgh"]),
  });
  state.jobs = (saved.jobs || [])
    .map(normaliseJob)
    .filter((job) => job.status !== "new" || !isManagedFeedJob(job) || isMaxLocationEligible(job));
  state.searchIndex = [];
  state.sources = [{ id: "job-garden-curated", name: "Max's curated job watch", type: "curated", endpoint: "./jobs.json", enabled: true, status: "Ready" }];
  state.people = [{ id: "max", name: "Max", role: "Candidate" }];
  state.activity = saved.activity || [];
  state.scout = saved.scout || { status: "ready", sourceCount: 1 };
  state.generatedAt = saved.generatedAt || new Date().toISOString();
  state.connected = true;
  state.offline = false;
  showApp();
  startLocalScout();
}

function hydrate(payload) {
  state.mode = "private";
  state.person = payload.person || { id: localStorage.getItem(KEYS.personHint) || "max", name: "Max", role: "candidate" };
  state.profile = payload.profile || {};
  state.preferences = normalisePreferences(payload.preferences || DEFAULT_PREFERENCES);
  state.jobs = uniqueJobs([...(payload.jobs || []), ...(payload.history || [])]).map(normaliseJob);
  state.searchIndex = (payload.searchJobs || []).map(normaliseJob);
  state.sources = payload.sources || [];
  state.people = payload.people || [];
  state.activity = payload.activity || [];
  state.scout = payload.scout || {};
  state.sheetUrl = payload.sheetUrl || "";
  state.generatedAt = payload.generatedAt || new Date().toISOString();
  state.cvJobId ||= state.jobs.find((job) => ["applying", "saved", "new"].includes(job.status))?.id || state.jobs[0]?.id || "";
  applyTheme(state.preferences.theme || localStorage.getItem(KEYS.theme) || "system");
}

function showApp() {
  if (accessGate) accessGate.hidden = true;
  appRoot.hidden = false;
  renderShell();
  render();
  renderConnection();
  requestAnimationFrame(() => viewContent.focus({ preventScroll: true }));
}

function render() {
  if (!state.connected) return;
  const jobs = decoratedJobs();
  const stats = deriveStats(jobs, new Date(), state.preferences);
  const renderers = {
    today: () => renderToday(jobs, stats),
    discover: () => renderDiscover(jobs, stats),
    pipeline: () => renderPipeline(jobs, stats),
    progress: () => renderProgress(jobs, stats),
    cv: () => renderCv(jobs),
    settings: () => renderSettings(),
  };
  viewContent.innerHTML = (renderers[state.view] || renderers.today)();
  renderShell();
}

function renderShell() {
  const viewTitleElement = document.querySelector("#viewTitle");
  if (!viewTitleElement) return;
  const meta = VIEW_META[state.view] || VIEW_META.today;
  document.querySelector("#viewEyebrow").textContent = meta.eyebrow;
  viewTitleElement.textContent = meta.title;
  document.title = `${meta.title} · Max's Job Garden`;
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));

  const personName = state.person?.name || "Max";
  const personRole = state.person?.role === "supporter" ? "Supporter" : "Candidate";
  document.querySelector("#personName").textContent = personName;
  document.querySelector("#personRole").textContent = personRole;
  document.querySelector("#personAvatar").textContent = initials(personName);
  document.querySelector("#accountSummary").textContent = state.mode === "local"
    ? `${personName}'s jobs, preferences, and progress are saved in this browser. Reset only if you want to start again on this device.`
    : `${personName} is connected to the shared Job Garden.`;

  const stats = deriveStats(decoratedJobs(), new Date(), state.preferences);
  setBadge("todayNavCount", stats.followUps, stats.followUps > 0);
  setBadge("discoverNavCount", stats.newMatches, stats.newMatches > 0);
  const scoutText = state.scout.lastRunAt ? `Checked ${timeAgo(state.scout.lastRunAt)}` : "Needs setup";
  document.querySelector("#scoutMiniText").textContent = scoutText;
  const miniStrong = document.querySelector("#scoutMiniCard strong");
  miniStrong.textContent = scoutHealthy() ? "Scout is checking" : "Scout needs attention";
  document.querySelector("#scoutMiniCard .scout-orbit")?.classList.toggle("paused", !scoutHealthy());
  const notificationDot = document.querySelector("#notificationDot");
  notificationDot.hidden = !(stats.newMatches > 0 || ("Notification" in window && Notification.permission === "default"));
}

function renderToday(jobs, stats) {
  const firstName = (state.person?.name || state.profile?.name || "Max").split(/\s+/)[0];
  const actionJobs = jobs
    .filter((job) => ACTIVE_STATUSES.has(job.status) && !job.removed)
    .map((job) => ({ job, action: nextActionFor(job, state.preferences) }))
    .sort((a, b) => b.action.priority - a.action.priority || b.job.fit.score - a.job.fit.score);
  const focus = actionJobs[0];
  const otherActions = actionJobs.slice(1, 5);
  const weeklyPercent = Math.min(100, Math.round((stats.weeklyApplied / Math.max(1, stats.weeklyGoal)) * 100));
  const dailyRemaining = Math.max(0, stats.dailyGoal - stats.appliedToday);
  const greeting = greetingForNow();

  return `
    <div class="page-stack">
      <section class="welcome-hero">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(greeting)}, ${escapeHtml(firstName)}</p>
          <h2>${focus ? escapeHtml(heroMessage(focus.action)) : "Build some momentum."}</h2>
          <p>${focus ? escapeHtml(focus.action.detail) : "Start with one clear action, then keep going for as long as it feels useful."}</p>
          <div class="hero-actions">
            ${focus ? `<button class="button primary" type="button" data-open-job="${escapeHtml(focus.job.id)}">${escapeHtml(focus.action.label)}<svg aria-hidden="true"><use href="#icon-arrow"></use></svg></button>` : `<button class="button primary" type="button" data-view="discover">Find a role to review<svg aria-hidden="true"><use href="#icon-arrow"></use></svg></button>`}
            <button class="button quiet" type="button" data-view="pipeline">See the whole pipeline</button>
          </div>
        </div>
        <div class="hero-progress">
          <div class="hero-progress-card">
            <div class="hero-progress-top"><span>This week</span><strong>${stats.weeklyApplied} / ${stats.weeklyGoal}</strong></div>
            <div class="progress-track" aria-label="${weeklyPercent}% of weekly application goal"><span style="--progress:${weeklyPercent}%"></span></div>
            <p>${stats.weeklyApplied >= stats.weeklyGoal ? "Weekly target reached. Protect quality and follow up." : `${stats.weeklyGoal - stats.weeklyApplied} quality application${stats.weeklyGoal - stats.weeklyApplied === 1 ? "" : "s"} to reach the flexible goal.`}</p>
          </div>
          <div class="scout-live-line"><span class="live-dot"></span>${scoutStatusSentence()}</div>
        </div>
      </section>

      <section class="metric-grid" aria-label="Job search overview">
        ${metricCard("sparkles", "New matches", stats.newMatches, stats.newMatches ? "Ready for a quick yes/no" : "Nothing noisy waiting", "lime")}
        ${metricCard("clock", "Follow-ups", stats.followUps, stats.followUps ? "Worth doing today" : "Nothing overdue", stats.followUps ? "amber" : "")}
        ${metricCard("inbox", "Active", stats.active, "Applications still moving", "")}
        ${metricCard("target", "Daily goal", dailyRemaining ? `${dailyRemaining} left` : "Done", dailyRemaining ? "A flexible target, not a limit" : "Today’s target reached", dailyRemaining ? "" : "lime")}
      </section>

      <section class="section">
        <div class="section-heading">
          <div><p class="eyebrow">The next useful move</p><h2>Start here</h2><p>The page ranks urgency, freshness, and fit so Max can act quickly without keeping every job in his head.</p></div>
        </div>
        <div class="focus-layout">
          ${focus ? renderFocusCard(focus.job, focus.action) : renderNoFocusCard()}
          <aside class="action-panel">
            <h3>Also on the radar</h3>
            <p>Small actions, ordered by usefulness.</p>
            <div class="action-list">
              ${otherActions.length ? otherActions.map(renderActionItem).join("") : `<div class="empty-state" style="min-height:170px"><div><span>No other urgent tasks.</span></div></div>`}
            </div>
          </aside>
        </div>
      </section>

      <section class="section">
        <div class="section-heading"><div><p class="eyebrow">A healthier search</p><h2>Useful context, not pressure</h2></div></div>
        <div class="insight-grid">
          <article class="insight-card accent"><svg aria-hidden="true"><use href="#icon-zap"></use></svg><h3>Keep momentum without losing quality.</h3><p>The daily goal is adjustable and never caps how many good opportunities Max can pursue.</p></article>
          <article class="insight-card"><svg aria-hidden="true"><use href="#icon-chart"></use></svg><h3>${stats.applications} applications are evidence</h3><p>${stats.interviews} interview or assessment processes reveal which role families and proof points are creating traction.</p></article>
          <article class="insight-card"><svg aria-hidden="true"><use href="#icon-sprout"></use></svg><h3>The garden learns from “no”</h3><p>Skipping a low-pay, wrong-location, or sales-heavy role teaches the scorer what not to interrupt Max with next time.</p></article>
        </div>
      </section>
    </div>`;
}

function renderDiscover(jobs) {
  const recommendedMode = state.searchMode === "recommended";
  const trackedCandidates = jobs.filter((job) => ["new", "saved", "applying"].includes(job.status) && !job.removed);
  const candidates = recommendedMode ? trackedCandidates : decoratedSearchJobs().filter((job) => !job.removed);
  const freshCandidates = candidates.filter((job) => {
    const age = jobAge(job);
    return age !== null && age <= state.feedFreshnessDays;
  });
  const searched = freshCandidates.filter((job) => matchesJobSearch(job, state.search));
  const locationFiltered = searched.filter((job) => recommendedMode || matchesSearchLocation(job, state.searchLocation));
  const filtered = sortJobs(locationFiltered.filter((job) => {
    if (state.discoverFilter === "saved") return recommendedMode && job.status === "saved";
    const age = jobAge(job);
    if (state.discoverFilter === "today") return age === 0;
    if (state.discoverFilter === "three-days") return age <= 3;
    if (state.discoverFilter === "remote") return job.workPattern === "remote" || /remote/i.test(job.location);
    return age <= state.feedFreshnessDays;
  }), state.sort);
  const visible = recommendedMode ? filtered : filtered.slice(0, state.searchLimit);
  const counts = {
    today: freshCandidates.filter((job) => jobAge(job) === 0).length,
    threeDays: freshCandidates.filter((job) => jobAge(job) <= 3).length,
    week: freshCandidates.length,
    remote: freshCandidates.filter((job) => job.workPattern === "remote" || /remote/i.test(job.location)).length,
    saved: trackedCandidates.filter((job) => job.status === "saved").length,
    unseen: trackedCandidates.filter((job) => jobAge(job) <= state.feedFreshnessDays && job.status === "new" && !job.seenAt).length,
    glasgow: freshCandidates.filter((job) => maxLocationRank(job) === 0).length,
    remoteUk: freshCandidates.filter((job) => maxLocationRank(job) === 1).length,
    edinburgh: freshCandidates.filter((job) => maxLocationRank(job) === 2).length,
  };
  const checkedSources = state.feedSourceCount || state.scout.sourceCount || 1;
  const headline = recommendedMode ? "Best matches for Max" : "Find your next role";
  const intro = recommendedMode
    ? `A shorter list of fresh roles with the strongest overlap with Max’s experience. The score is a guide, not a gate.`
    : `Search ${counts.week} current roles from ${checkedSources} sources. Browse by place, title, skill, or company—CV scoring never hides the wider search.`;
  const emptyTitle = recommendedMode ? "No strong matches in this view" : "No jobs match those filters";
  const emptyBody = recommendedMode
    ? "Browse all jobs to explore roles outside the automatic shortlist."
    : "Try a shorter keyword, another location, or the full seven-day window.";

  return `
    <div class="page-stack">
      <section class="section">
        <div class="section-heading discover-heading">
          <div><p class="eyebrow">Updated throughout the day</p><h2>${headline}</h2><p>${intro}</p></div>
          <div class="section-actions">${recommendedMode && counts.unseen ? `<button class="button quiet small" type="button" data-action="mark-all-seen"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Mark seen</button>` : ""}<button class="button quiet small" type="button" data-action="run-scout"><svg aria-hidden="true"><use href="#icon-refresh"></use></svg>Check now</button></div>
        </div>
        <div class="discover-modes" role="tablist" aria-label="Choose job discovery mode">
          <button type="button" role="tab" aria-selected="${!recommendedMode}" class="discover-mode ${!recommendedMode ? "active" : ""}" data-search-mode="all"><span><strong>Browse all jobs</strong><small>Every current opportunity</small></span><b>${state.searchIndex.length}</b></button>
          <button type="button" role="tab" aria-selected="${recommendedMode}" class="discover-mode ${recommendedMode ? "active" : ""}" data-search-mode="recommended"><span><strong>Best matches</strong><small>Ranked against Max’s CV</small></span><b>${trackedCandidates.filter((job) => jobAge(job) <= state.feedFreshnessDays).length}</b></button>
        </div>
        <div class="discover-search-panel">
          <div class="discover-toolbar ${recommendedMode ? "" : "all-search"}">
            <label class="search-box"><svg aria-hidden="true"><use href="#icon-search"></use></svg><input id="searchJobs" type="search" value="${escapeHtml(state.search)}" placeholder="Search titles, skills or companies" aria-label="Search jobs" /></label>
            <select class="toolbar-select" id="sortJobs" aria-label="Sort jobs">
              ${option("location", "Recommended order", state.sort)}
              ${option("newest", "Newest", state.sort)}
              ${option("recommended", "Closest CV match", state.sort)}
              ${option("salary", "Highest salary", state.sort)}
            </select>
            ${recommendedMode ? `<button class="button quiet" type="button" data-view="settings" data-settings-section="search"><svg aria-hidden="true"><use href="#icon-filter"></use></svg>Search profile</button>` : ""}
          </div>
          ${recommendedMode ? "" : `<div class="filter-group"><span class="filter-label">Location</span><div class="filter-strip location-strip" role="group" aria-label="Filter by location">${locationChip("all", "All", counts.week)}${locationChip("glasgow", "Glasgow & nearby", counts.glasgow)}${locationChip("remote-uk", "Remote UK", counts.remoteUk)}${locationChip("edinburgh", "Edinburgh", counts.edinburgh)}${locationChip("other-remote", "Other remote", Math.max(0, counts.remote - counts.remoteUk))}</div></div>`}
          <div class="filter-group"><span class="filter-label">Posted</span><div class="filter-strip" role="group" aria-label="Filter by date">${filterChip("week", `Past ${state.feedFreshnessDays} days`, counts.week)}${filterChip("today", "Today", counts.today)}${filterChip("three-days", "Past 72 hours", counts.threeDays)}${recommendedMode ? `${filterChip("remote", "Remote", counts.remote)}${filterChip("saved", "Saved", counts.saved)}` : ""}</div></div>
          ${recommendedMode ? "" : `<div class="keyword-suggestions" aria-label="Suggested searches"><span>Popular searches</span>${["operations manager", "service delivery", "customer success", "onboarding", "project coordinator"].map((term) => `<button type="button" data-search-query="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}</div>`}
        </div>
        <div class="results-line"><span><strong>${filtered.length}</strong> opportunit${filtered.length === 1 ? "y" : "ies"}${!recommendedMode && filtered.length > visible.length ? ` · showing ${visible.length}` : ""}</span><span>${state.scout.lastRunAt ? `Updated ${timeAgo(state.scout.lastRunAt)}` : "Updates automatically"}</span></div>
        ${visible.length ? `<div class="job-grid">${visible.map((job) => renderJobCard(job, { broad: !recommendedMode })).join("")}</div>${!recommendedMode && visible.length < filtered.length ? `<div class="load-more"><button class="button quiet" type="button" data-action="load-more">Show ${Math.min(60, filtered.length - visible.length)} more</button></div>` : ""}` : renderEmpty("search", emptyTitle, emptyBody, recommendedMode ? "Search all sources" : "Clear search", recommendedMode ? "show-all-search" : "clear-filters")}
      </section>
    </div>`;
}

function renderPipeline(jobs, stats) {
  const liveJobs = jobs.filter((job) => job.status !== "new" || job.seenAt);
  const groups = [
    { id: "interested", label: "Interested", jobs: liveJobs.filter((job) => ["new", "saved"].includes(job.status) && !job.removed) },
    { id: "applying", label: "Preparing", jobs: liveJobs.filter((job) => job.status === "applying") },
    { id: "applied", label: "Applied & follow-up", jobs: liveJobs.filter((job) => ["applied", "follow_up"].includes(job.status)) },
    { id: "interview", label: "Interview", jobs: liveJobs.filter((job) => ["interview", "offer"].includes(job.status)) },
    { id: "closed", label: "Outcomes", jobs: sortJobs(liveJobs.filter((job) => ["rejected", "withdrawn", "closed", "skipped", "hired"].includes(job.status)), "newest").slice(0, 12), total: liveJobs.filter((job) => ["rejected", "withdrawn", "closed", "skipped", "hired"].includes(job.status)).length },
  ];

  return `
    <div class="page-stack">
      <section class="pipeline-summary" aria-label="Pipeline summary">
        <article class="pipeline-stat"><span>Preparing</span><strong>${groups[1].jobs.length}</strong></article>
        <article class="pipeline-stat"><span>Awaiting response</span><strong>${groups[2].jobs.length}</strong></article>
        <article class="pipeline-stat"><span>Interview / offer</span><strong>${groups[3].jobs.length}</strong></article>
        <article class="pipeline-stat"><span>Follow-ups due</span><strong>${stats.followUps}</strong></article>
      </section>
      <section class="section">
        <div class="section-heading"><div><p class="eyebrow">One source of truth</p><h2>Every application has a next state</h2><p>Open a card to move it, add a date, prepare a CV, or record why it ended.</p></div></div>
        <div class="pipeline-board-wrap">
          <div class="pipeline-board">
            ${groups.map((group) => `
              <section class="pipeline-column" aria-label="${escapeHtml(group.label)}">
                <div class="pipeline-column-header"><span>${escapeHtml(group.label)}</span><strong>${group.total ?? group.jobs.length}</strong></div>
                <div class="pipeline-list">
                  ${group.jobs.length ? group.jobs.map(renderPipelineCard).join("") : `<div class="pipeline-empty">Nothing here right now</div>`}
                </div>
              </section>`).join("")}
          </div>
        </div>
      </section>
    </div>`;
}

function renderProgress(jobs, stats) {
  const applications = jobs.filter((job) => job.appliedDate || ["applied", "follow_up", "interview", "offer", "rejected", "withdrawn", "closed", "hired"].includes(job.status));
  const savedCount = jobs.filter((job) => ["saved", "applying", ...["applied", "follow_up", "interview", "offer", "rejected", "withdrawn", "closed", "hired"]].includes(job.status)).length;
  const funnel = [
    ["Reviewed", Math.max(savedCount, applications.length)],
    ["Applied", applications.length],
    ["Interview", stats.interviews],
    ["Offer", stats.offers],
  ];
  const max = Math.max(1, ...funnel.map(([, value]) => value));
  const weeklyPercent = Math.min(100, Math.round((stats.weeklyApplied / Math.max(1, stats.weeklyGoal)) * 100));
  const history = [...applications].sort((a, b) => String(b.appliedDate || b.updatedAt).localeCompare(String(a.appliedDate || a.updatedAt))).slice(0, 12);

  return `
    <div class="page-stack">
      <section class="progress-highlight">
        <article class="progress-story">
          <p class="eyebrow">The signal inside the search</p>
          <h2>${stats.applications} applications are a dataset—not a verdict.</h2>
          <p>Use outcomes to narrow titles, sharpen proof, and remove jobs that were never worth Max’s energy. A “no response” is a pipeline result, not a personal result.</p>
          <div class="big-rate"><strong>${stats.interviewRate}%</strong><span>interview / assessment signal from tracked applications</span></div>
        </article>
        <article class="weekly-card">
          <span>This week’s quality goal</span>
          <strong>${stats.weeklyApplied} / ${stats.weeklyGoal}</strong>
          <div class="progress-track" aria-label="${weeklyPercent}% complete"><span style="--progress:${weeklyPercent}%"></span></div>
          <p>${stats.weeklyApplied >= stats.weeklyGoal ? "Goal reached. Use the remaining time for follow-ups and recovery." : "The goal is adjustable. It exists to create rhythm, not guilt."}</p>
        </article>
      </section>

      <section class="progress-grid">
        <article class="funnel-card">
          <h3>Application funnel</h3><p>Broad enough to spot a problem, simple enough to act on.</p>
          <div class="funnel-list">
            ${funnel.map(([label, value]) => `<div class="funnel-row"><span>${label}</span><div class="funnel-bar"><span style="--width:${Math.max(value ? 4 : 0, Math.round((value / max) * 100))}%"></span></div><strong>${value}</strong></div>`).join("")}
          </div>
        </article>
        <article class="learning-card">
          <h3>What the history suggests</h3><p>Useful hypotheses to test—not rigid rules.</p>
          <div class="learning-list">
            ${learningItem("target", "Make the value obvious", "German language, client ownership, operational coordination, and concrete issue-resolution examples are high-signal proof points.")}
            ${learningItem("search", "Screen before tailoring", "Confirm salary, work pattern, and whether “success” means relationship ownership or sales quota before investing time.")}
            ${learningItem("clock", "Follow up once", "A short follow-up after five working days creates closure without turning waiting into a full-time task.")}
          </div>
        </article>
      </section>

      <section class="section">
        <div class="section-heading"><div><p class="eyebrow">Recent history</p><h2>Applications and outcomes</h2></div>${state.sheetUrl ? `<a class="text-link" href="${escapeHtml(safeUrl(state.sheetUrl))}" target="_blank" rel="noreferrer">Open full Sheet<svg aria-hidden="true"><use href="#icon-external"></use></svg></a>` : ""}</div>
        ${history.length ? `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Applied</th><th>Role</th><th>Location</th><th>Priority</th><th>Status</th></tr></thead><tbody>${history.map((job) => `<tr><td>${escapeHtml(formatDate(job.appliedDate, { year: false }) || "—")}</td><td><strong>${escapeHtml(job.title)}</strong><span>${escapeHtml(job.company)}</span></td><td>${escapeHtml(job.location)}</td><td>${escapeHtml(job.priority || "—")}</td><td>${statusPill(job.status)}</td></tr>`).join("")}</tbody></table></div>` : renderEmpty("chart", "No application history yet", "Applications will appear here once they are marked as submitted.")}
      </section>
    </div>`;
}

function renderCv(jobs) {
  const eligible = jobs.filter((job) => ["new", "saved", "applying", "applied", "follow_up", "interview"].includes(job.status) && !job.removed);
  const selected = eligible.find((job) => job.id === state.cvJobId) || eligible[0] || jobs[0];
  if (selected) state.cvJobId = selected.id;
  const profile = state.profile || {};
  const tailoring = selected ? buildTailoring(selected, profile) : null;
  const message = selected ? buildMessage(state.messageKind, selected, profile) : "Choose a job to prepare a message.";

  return `
    <div class="page-stack">
      <section class="cv-layout">
        <aside class="cv-sidebar">
          <article class="profile-card">
            <div class="profile-card-top"><span class="avatar">${escapeHtml(initials(profile.name || "Max"))}</span><div><h2>${escapeHtml(profile.name || "Max’s CV profile")}</h2><p>${escapeHtml(profile.headline || "Add a headline in Settings")}</p></div></div>
            <div class="profile-facts">
              ${profile.location ? profileFact("map", profile.location) : ""}
              ${profile.email ? profileFact("mail", profile.email) : ""}
              ${profile.phone ? profileFact("phone", profile.phone) : ""}
              ${profile.languages?.length ? profileFact("sparkles", profile.languages.join(" · ")) : ""}
            </div>
            <button class="button quiet full-button" type="button" data-view="settings" data-settings-section="profile" style="margin-top:16px"><svg aria-hidden="true"><use href="#icon-edit"></use></svg>Edit CV facts</button>
          </article>
          <article class="cv-job-card">
            <h3>Tailor for a job</h3><p>Choose the application. Dates, employers, titles, and responsibilities remain factual.</p>
            <select class="job-picker" id="cvJobPicker" aria-label="Choose a job for the CV">${eligible.map((job) => `<option value="${escapeHtml(job.id)}" ${job.id === selected?.id ? "selected" : ""}>${escapeHtml(job.company)} — ${escapeHtml(job.title)}</option>`).join("")}</select>
            <div class="cv-actions">
              ${!selected ? `<button class="button primary full-button" type="button" data-view="discover"><svg aria-hidden="true"><use href="#icon-search"></use></svg>Choose a job first</button>` : profile.roles?.length ? `<button class="button primary full-button" type="button" data-action="download-cv"><svg aria-hidden="true"><use href="#icon-download"></use></svg>Download matched PDF</button>` : `<button class="button primary full-button" type="button" data-view="settings" data-settings-section="profile"><svg aria-hidden="true"><use href="#icon-plus"></use></svg>Add employment history</button><p class="cv-unlock-note">The PDF needs at least one previous role. Add it once and every matched download unlocks.</p>`}
              ${selected?.url ? `<a class="button quiet full-button" href="${escapeHtml(selected.url)}" target="_blank" rel="noreferrer"><svg aria-hidden="true"><use href="#icon-external"></use></svg>Open job advert</a>` : ""}
            </div>
          </article>
        </aside>
        <div class="cv-main">
          <article class="cv-preview-card">
            <p class="eyebrow">Emphasis preview</p><h3>${selected ? `For ${escapeHtml(selected.title)} at ${escapeHtml(selected.company)}` : "Choose a job"}</h3><p>The download changes emphasis and ordering—not Max’s employment facts.</p>
            ${tailoring ? `<div class="tailoring-grid"><div class="tailoring-side"><span>Core CV</span><h4>${escapeHtml(tailoring.sourceHeadline)}</h4><p>${escapeHtml(profile.summary || "Client operations, service delivery, workforce coordination, stakeholder communication, and issue resolution.")}</p></div><div class="tailoring-side after"><span>For this role</span><h4>${escapeHtml(tailoring.headline)}</h4><p>${escapeHtml(tailoring.summary)}</p></div></div><div class="keyword-cloud">${tailoring.keywords.map((word) => metaPill(titleCase(word), "good")).join("")}</div><div class="truth-note"><svg aria-hidden="true"><use href="#icon-check"></use></svg><span>The PDF keeps employers, dates, titles, qualifications, tools, and the substance of every responsibility unchanged.</span></div>` : renderEmpty("file", "No active job selected", "Save or add a role, then return here to prepare the application.")}
          </article>
          <article class="message-card">
            <h3>Human, specific messages</h3><p>Short starting points for a recruiter, one follow-up, or an interview thank-you.</p>
            <div class="message-tabs" role="tablist" aria-label="Message type">${messageTab("recruiter", "Recruiter note")}${messageTab("followup", "Follow-up")}${messageTab("thankyou", "Thank-you")}</div>
            <div class="message-output" id="messageOutput">${escapeHtml(message)}</div>
            <div class="message-footer"><span>Edit names and one specific detail before sending.</span><button class="button quiet small" type="button" data-action="copy-message"><svg aria-hidden="true"><use href="#icon-copy"></use></svg>Copy</button></div>
          </article>
        </div>
      </section>
    </div>`;
}

function renderSettings() {
  const prefs = state.preferences;
  const profile = state.profile || {};
  const notificationPermission = "Notification" in window ? Notification.permission : "unsupported";
  const isOwner = state.person?.role === "supporter" || state.person?.role === "owner";
  const accessPeople = state.people.length ? state.people : [{ name: "Max", role: "Candidate" }];

  return `
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">
        ${settingsNavButton("search", "Search profile")}${settingsNavButton("alerts", "Alerts & Scout")}${settingsNavButton("sources", "Sources")}${settingsNavButton("profile", "CV facts")}${settingsNavButton("privacy", "Device & privacy")}
      </nav>
      <div class="settings-main">
        <section class="settings-section" id="settings-search">
          <div class="settings-section-heading"><h2>Max’s search profile</h2><p>Every field changes matching and can be adjusted as the search learns.</p></div>
          <form id="preferencesForm">
            <article class="settings-card">
              <div class="settings-card-header"><div><h3>Role families</h3><p>Press Enter after each title or phrase.</p></div></div>
              ${tagEditor("targetTitles", prefs.targetTitles, "Add a target title")}
            </article>
            <article class="settings-card">
              <div class="settings-card-header"><div><h3>Evidence and exclusions</h3><p>Reward language Max can prove; block noise that wastes time.</p></div></div>
              <div class="field-grid"><label class="field"><span>Reward these terms</span>${tagEditor("includeTerms", prefs.includeTerms, "Add a skill or phrase")}</label><label class="field"><span>Avoid these terms</span>${tagEditor("excludeTerms", prefs.excludeTerms, "Add an exclusion")}</label></div>
            </article>
            <article class="settings-card">
              <div class="settings-card-header"><div><h3>Pay, place, and pace</h3><p>Unknown salary stays visible, but the score explains the uncertainty.</p></div></div>
              <div class="field-grid three">
                <label class="field"><span>Minimum salary</span><input name="minimumSalary" type="number" step="1000" min="0" value="${prefs.minimumSalary}" /></label>
                <label class="field"><span>Preferred salary</span><input name="preferredSalary" type="number" step="1000" min="0" value="${prefs.preferredSalary}" /></label>
                <label class="field"><span>On-site radius (km)</span><input name="maxDistanceKm" type="number" step="5" min="0" value="${prefs.maxDistanceKm}" /></label>
              </div>
              <div class="field-grid" style="margin-top:12px"><label class="field"><span>Preferred places</span>${tagEditor("preferredLocations", prefs.preferredLocations, "Add a place")}</label><div class="field"><span>Work patterns</span><div class="check-grid">${checkControl("workPatterns", "remote", "Remote", prefs.workPatterns)}${checkControl("workPatterns", "hybrid", "Hybrid", prefs.workPatterns)}${checkControl("workPatterns", "onsite", "On-site nearby", prefs.workPatterns)}</div></div></div>
              <div class="field-grid" style="margin-top:12px"><div class="field"><span>Contract and hours</span><div class="check-grid">${checkControl("contractTypes", "permanent", "Permanent", prefs.contractTypes)}${checkControl("contractTypes", "full_time", "Full-time", prefs.contractTypes)}${checkControl("contractTypes", "contract", "Contract", prefs.contractTypes)}${checkControl("contractTypes", "part_time", "Part-time", prefs.contractTypes)}</div></div><label class="field"><span>Benefits to reward</span>${tagEditor("mustHaveBenefits", prefs.mustHaveBenefits, "Add a benefit")}</label></div>
              <div class="settings-card-footer"><button class="button primary" type="submit"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Save search profile</button></div>
            </article>
            <article class="settings-card">
              <div class="settings-card-header"><div><h3>A sustainable rhythm</h3><p>Goals create a stopping point and follow-ups happen without mental load.</p></div></div>
              <div class="field-grid three">
                <label class="field"><span>Applications per day</span><input name="dailyApplicationGoal" type="number" min="0" max="20" value="${prefs.dailyApplicationGoal}" /></label>
                <label class="field"><span>Applications per week</span><input name="weeklyApplicationGoal" type="number" min="0" max="100" value="${prefs.weeklyApplicationGoal}" /></label>
                <label class="field"><span>Follow up after days</span><input name="followUpDays" type="number" min="1" max="30" value="${prefs.followUpDays}" /></label>
              </div>
              <div class="field-grid" style="margin-top:12px"><label class="field"><span>Keep roles scoring at least</span><input name="reviewThreshold" type="number" min="0" max="99" value="${prefs.reviewThreshold}" /><small>Lower finds more possibilities; higher keeps Discover quieter.</small></label></div>
              <div class="settings-card-footer"><button class="button primary" type="submit"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Save rhythm</button></div>
            </article>
          </form>
        </section>

        <section class="settings-section" id="settings-alerts">
          <div class="settings-section-heading"><h2>Alerts and automation</h2><p>Scout checks fresh roles automatically while Job Garden is open. Device notifications appear after you enable them once.</p></div>
          <article class="settings-card">
            <div class="settings-card-header"><div><h3>Scout health</h3><p>${escapeHtml(scoutStatusSentence())}</p></div><span class="health-badge ${scoutHealthy() ? "" : "warn"}">${scoutHealthy() ? "Healthy" : "Needs setup"}</span></div>
            ${state.mode === "private" ? `<div class="switch-row"><div class="switch-copy"><strong>Immediate email alerts</strong><span>Send Max new roles at or above the match threshold.</span></div>${switchControl("alertEmail", prefs.alertEmail)}</div><div class="switch-row"><div class="switch-copy"><strong>Telegram alerts</strong><span>Send matched roles to Max’s connected chat.</span></div>${switchControl("alertTelegram", prefs.alertTelegram)}</div>` : `<div class="switch-row"><div class="switch-copy"><strong>Automatic checks</strong><span>Runs when the site opens and every 15 minutes while it remains open.</span></div><span class="health-badge">On</span></div>`}
            <div class="field-grid three" style="margin-top:16px">
              <label class="field"><span>Alert at</span><input form="preferencesForm" name="alertThreshold" type="number" min="0" max="99" value="${prefs.alertThreshold}" /></label>
              <label class="field"><span>Quiet from</span><input form="preferencesForm" name="quietHoursStart" type="number" min="0" max="23" value="${prefs.quietHoursStart}" /></label>
              <label class="field"><span>Quiet until</span><input form="preferencesForm" name="quietHoursEnd" type="number" min="0" max="23" value="${prefs.quietHoursEnd}" /></label>
            </div>
            <div class="settings-card-footer"><button class="button primary" form="preferencesForm" type="submit"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Save alert timing</button><button class="button quiet" type="button" data-action="run-scout"><svg aria-hidden="true"><use href="#icon-refresh"></use></svg>Run Scout now</button>${state.mode === "private" ? `<button class="button quiet" type="button" data-action="test-alert"><svg aria-hidden="true"><use href="#icon-mail"></use></svg>Send test email</button>` : ""}</div>
          </article>
          <article class="settings-card">
            <div class="settings-card-header"><div><h3>This device</h3><p>Permission is always requested after a deliberate click.</p></div><span class="health-badge ${notificationPermission === "granted" ? "" : "warn"}">${titleCase(notificationPermission)}</span></div>
            <div class="switch-row"><div class="switch-copy"><strong>Browser notifications</strong><span>Show high-match roles when Job Garden detects an update on this device.</span></div><button class="button quiet small" type="button" data-action="enable-notifications" ${notificationPermission === "unsupported" ? "disabled" : ""}>${notificationPermission === "granted" ? "Send a test" : "Enable"}</button></div>
            <div class="switch-row"><div class="switch-copy"><strong>Install Job Garden</strong><span>Add a focused app icon to mobile or desktop, with offline access to the last synced view.</span></div><button class="button quiet small" type="button" data-action="install-app" ${state.installPrompt ? "" : "disabled"}>${state.installPrompt ? "Install" : "Already available"}</button></div>
          </article>
        </section>

        <section class="settings-section" id="settings-sources">
          <div class="settings-section-heading"><h2>Job sources</h2><p>Scout combines official employer boards and specialist job feeds, keeps them fresh and location-safe, then separates Max’s shortlist from the wider searchable index.</p></div>
          <article class="settings-card">
            <div class="settings-card-header"><div><h3>Connected sources</h3><p>Scans rotate through local and remote searches during waking hours.</p></div></div>
            <div class="source-list">${state.sources.length ? state.sources.map(renderSourceRow).join("") : `<div class="private-note"><svg aria-hidden="true"><use href="#icon-zap"></use></svg><span>Add a public company feed or restore the default no-key sources.</span></div>`}</div>
          </article>
          ${state.mode === "private" && isOwner ? `<article class="settings-card"><div class="settings-card-header"><div><h3>Add a company feed</h3><p>Use a public Greenhouse board, Lever site, or HTTPS RSS feed.</p></div></div><form id="sourceForm"><div class="field-grid"><label class="field"><span>Name</span><input name="name" required placeholder="Company careers" /></label><label class="field"><span>Type</span><select name="type"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="rss">RSS</option></select></label><label class="field full"><span>Public endpoint</span><input name="endpoint" type="url" inputmode="url" pattern="https://.*" required placeholder="https://boards-api.greenhouse.io/v1/boards/…/jobs?content=true" /></label></div><div class="settings-card-footer"><button class="button primary" type="submit"><svg aria-hidden="true"><use href="#icon-plus"></use></svg>Add source</button></div></form></article>` : ""}
        </section>

        <section class="settings-section" id="settings-profile">
          <div class="settings-section-heading"><h2>CV facts</h2><p>These details stay in this browser unless the shared workspace is connected. Tailoring never invents experience.</p></div>
          <article class="settings-card">
            <form id="profileForm">
              <div class="field-grid">
                <label class="field"><span>Name</span><input name="name" value="${escapeHtml(profile.name || "")}" autocomplete="name" /></label>
                <label class="field"><span>Location</span><input name="location" value="${escapeHtml(profile.location || "")}" autocomplete="address-level2" /></label>
                <label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(profile.email || "")}" autocomplete="email" /></label>
                <label class="field"><span>Phone</span><input name="phone" type="tel" value="${escapeHtml(profile.phone || "")}" autocomplete="tel" /></label>
                <label class="field full"><span>LinkedIn URL</span><input name="linkedinUrl" type="url" value="${escapeHtml(profile.linkedinUrl || "")}" /></label>
                <label class="field full"><span>Core headline</span><input name="headline" value="${escapeHtml(profile.headline || "")}" /></label>
                <label class="field full"><span>Core summary</span><textarea name="summary" rows="5">${escapeHtml(profile.summary || "")}</textarea></label>
                <label class="field full"><span>Skills <small>comma-separated</small></span><textarea name="skills" rows="3">${escapeHtml((profile.skills || []).join(", "))}</textarea></label>
                <label class="field full"><span>Tools <small>comma-separated</small></span><textarea name="tools" rows="3">${escapeHtml((profile.tools || []).join(", "))}</textarea></label>
                <label class="field full"><span>Certifications <small>one per line</small></span><textarea name="certifications" rows="3">${escapeHtml((profile.certifications || []).join("\n"))}</textarea></label>
                <label class="field full"><span>Languages <small>one per line</small></span><textarea name="languages" rows="3">${escapeHtml((profile.languages || []).join("\n"))}</textarea></label>
                <label class="field full"><span>Education</span><textarea name="education" rows="3">${escapeHtml(profile.education || "")}</textarea></label>
              </div>
              <section class="employment-history" id="employmentHistory" aria-labelledby="employmentHistoryTitle">
                <div class="employment-history-heading"><div><h3 id="employmentHistoryTitle">Employment history</h3><p>Required for the matched PDF. This stays on this device unless the private shared workspace is connected.</p></div><span class="history-count">${profile.roles?.length || 0} role${profile.roles?.length === 1 ? "" : "s"}</span></div>
                <div class="employment-role-list" id="employmentRoles">
                  ${profile.roles?.length ? profile.roles.map(renderEmploymentRoleEditor).join("") : `<div class="employment-empty"><strong>No employment history added yet</strong><span>Add Max’s latest role first. More positions can be added in any order.</span></div>`}
                </div>
                <button class="button quiet" type="button" data-profile-role-action="add"><svg aria-hidden="true"><use href="#icon-plus"></use></svg>Add a position</button>
              </section>
              <div class="private-note" style="margin-top:14px"><svg aria-hidden="true"><use href="#icon-lock"></use></svg><span>Employment facts stay on this device. The CV tool changes emphasis, never employers, dates, titles, or qualifications.</span></div>
              <div class="settings-card-footer"><button class="button primary" type="submit"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Save CV facts</button></div>
            </form>
          </article>
        </section>

        <section class="settings-section" id="settings-privacy">
          <div class="settings-section-heading"><h2>Device and privacy</h2><p>The website contains no application history or contact details. What you add is saved in this browser.</p></div>
          <article class="settings-card">
            <div class="settings-card-header"><div><h3>Made for Max</h3><p>One focused workspace using Max's CV evidence, target roles, salary floor, and location rules.</p></div></div>
            <div class="source-list">${accessPeople.map((person) => `<div class="source-row"><span class="avatar">${escapeHtml(initials(person.name))}</span><span class="source-copy"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(titleCase(person.role || "member"))}</span></span><span class="health-badge">Private</span></div>`).join("")}</div>
            ${state.mode === "private" && isOwner ? `<div class="settings-card-footer"><button class="button quiet" type="button" data-action="resend-max-link"><svg aria-hidden="true"><use href="#icon-mail"></use></svg>Email Max a fresh link</button></div>` : ""}
          </article>
          <article class="settings-card">
            <div class="switch-row"><div class="switch-copy"><strong>Appearance</strong><span>Use the device theme or pick a consistent light or dark workspace.</span></div><select class="toolbar-select" id="themeSelect" aria-label="Appearance">${option("system", "System", prefs.theme)}${option("light", "Light", prefs.theme)}${option("dark", "Dark", prefs.theme)}</select></div>
            ${state.mode === "private" ? `<div class="switch-row"><div class="switch-copy"><strong>Shared Sheet</strong><span>${state.sheetUrl ? "The application history and live queue are stored in the existing private Sheet." : "The shared service is connecting."}</span></div>${state.sheetUrl ? `<a class="button quiet small" href="${escapeHtml(safeUrl(state.sheetUrl))}" target="_blank" rel="noreferrer">Open Sheet</a>` : ""}</div>` : ""}
            <div class="switch-row"><div class="switch-copy"><strong>Reset this device</strong><span>Remove saved jobs, preferences, and cached data from this browser.</span></div><button class="button danger small" type="button" data-action="lock-device">Reset</button></div>
          </article>
        </section>
      </div>
    </div>`;
}

function renderJobCard(job, options = {}) {
  const salary = salaryText(job);
  const unseen = !options.broad && job.status === "new" && !job.seenAt;
  return `<button class="job-card ${unseen ? "unseen" : ""}" type="button" data-open-job="${escapeHtml(job.id)}">
    <div class="job-card-top"><div class="meta-row">${freshnessPill(job)}${job.status !== "new" ? statusPill(job.status) : ""}</div>${matchBadge(job.fit)}</div>
    <div class="job-card-title"><h3>${escapeHtml(job.title)}</h3><span class="job-card-company">${escapeHtml(job.company)}</span></div>
    <div class="job-card-facts"><span><svg aria-hidden="true"><use href="#icon-map"></use></svg><span>${escapeHtml(job.location)}</span></span><span><svg aria-hidden="true"><use href="#icon-money"></use></svg><span>${escapeHtml(salary)}</span></span></div>
    <div class="job-card-signal"><span>Why it could fit</span><strong>${escapeHtml(job.fit.reasons[0] || "Relevant experience may transfer")}</strong>${job.fit.concerns[0] ? `<small>${escapeHtml(job.fit.concerns[0])}</small>` : ""}</div>
    <div class="job-card-footer"><span>${escapeHtml(job.source || "Job source")}</span><strong>Review job<svg aria-hidden="true"><use href="#icon-arrow"></use></svg></strong></div>
  </button>`;
}

function renderEmploymentRoleEditor(role = {}, index = 0) {
  const bullets = Array.isArray(role.bullets) ? role.bullets.join("\n") : String(role.bullets || "");
  return `<article class="employment-role" data-profile-role>
    <div class="employment-role-header"><strong>Position <span class="employment-role-number">${index + 1}</span></strong><button class="button quiet small" type="button" data-profile-role-action="remove"><svg aria-hidden="true"><use href="#icon-trash"></use></svg>Remove</button></div>
    <div class="field-grid">
      <label class="field"><span>Job title</span><input data-role-field="title" value="${escapeHtml(role.title || "")}" required placeholder="Service Delivery Manager" /></label>
      <label class="field"><span>Company</span><input data-role-field="company" value="${escapeHtml(role.company || "")}" required placeholder="Company name" /></label>
      <label class="field"><span>Location</span><input data-role-field="location" value="${escapeHtml(role.location || "")}" placeholder="Glasgow · Remote" /></label>
      <label class="field"><span>Dates</span><input data-role-field="dates" value="${escapeHtml(role.dates || "")}" required placeholder="07/2025 – 06/2026" /></label>
      <label class="field full"><span>Achievements and responsibilities <small>one per line</small></span><textarea data-role-field="bullets" rows="5" required placeholder="Managed day-to-day client relationships…\nCoordinated service delivery across multiple accounts…">${escapeHtml(bullets)}</textarea></label>
    </div>
  </article>`;
}

function renderPipelineCard(job) {
  const action = nextActionFor(job, state.preferences);
  return `<button class="pipeline-card" type="button" data-open-job="${escapeHtml(job.id)}"><div class="meta-row">${statusPill(job.status)}${job.priority ? `<span class="priority-pill">${escapeHtml(job.priority)}</span>` : ""}</div><h3>${escapeHtml(job.title)}</h3><span>${escapeHtml(job.company)}</span><div class="pipeline-card-meta"><span>${escapeHtml(action.label)}</span><strong>${job.fit?.score ?? scoreJob(job, state.preferences).score}%</strong></div></button>`;
}

function renderFocusCard(job, action) {
  return `<article class="focus-card-large"><div class="focus-content"><span class="focus-kicker"><svg aria-hidden="true"><use href="#icon-target"></use></svg>${escapeHtml(action.label)}</span><h3>${escapeHtml(job.title)}</h3><span class="focus-company">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</span><p>${escapeHtml(action.detail)}</p><div class="meta-row">${metaPill(salaryText(job), job.salaryMax >= state.preferences.minimumSalary ? "good" : "warn")}${job.fit.reasons.slice(0, 2).map((reason) => metaPill(reason, "good")).join("")}</div><button class="button primary" type="button" data-open-job="${escapeHtml(job.id)}" style="margin-top:18px">Open next step<svg aria-hidden="true"><use href="#icon-arrow"></use></svg></button></div><div class="focus-score">${scoreRing(job.fit)}</div></article>`;
}

function renderNoFocusCard() {
  return `<article class="focus-card-large"><div class="focus-content"><span class="focus-kicker"><svg aria-hidden="true"><use href="#icon-sprout"></use></svg>Ready when you are</span><h3>Nothing urgent is waiting.</h3><p>Browse fresh roles or use the pipeline to keep an existing application moving.</p><button class="button primary" type="button" data-view="discover">Browse jobs<svg aria-hidden="true"><use href="#icon-arrow"></use></svg></button></div></article>`;
}

function renderActionItem({ job, action }) {
  const tone = ["follow_up", "deadline"].includes(action.kind) ? "warn" : "";
  const icon = action.kind === "follow_up" ? "mail" : action.kind === "interview" ? "calendar" : action.kind === "fresh_match" ? "sparkles" : "clock";
  return `<button class="action-item" type="button" data-open-job="${escapeHtml(job.id)}"><span class="action-item-icon ${tone}"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span class="action-item-copy"><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(job.company)} · ${escapeHtml(job.title)}</span></span><svg aria-hidden="true"><use href="#icon-chevron"></use></svg></button>`;
}

function renderJobDialog(jobId) {
  const job = findViewJob(jobId);
  if (!job) return;
  const checklist = applicationChecklist(job);
  const summary = advertSummary(job.description, 260);
  const highlights = advertHighlights(job.description);
  const concerns = uniqueList([
    ...(job.fit.concerns || []),
    ...(job.employerNamed === false ? ["Employer name is hidden on this partner listing—verify it before sharing personal details."] : []),
  ]);
  const closeStatus = ["rejected", "withdrawn", "closed", "skipped"].includes(job.status);
  const canPrepare = ["new", "saved"].includes(job.status);
  const canApply = job.status === "applying";
  const canSave = job.status === "new";
  const canFollowUp = ["applied", "follow_up"].includes(job.status);

  jobDialogContent.innerHTML = `<div class="job-dialog-shell">
    <div class="job-dialog-header"><span>${escapeHtml(freshnessLabel(job))} · ${escapeHtml(job.source)}</span><button class="icon-button" type="button" data-close-dialog="jobDialog" aria-label="Close"><svg aria-hidden="true"><use href="#icon-close"></use></svg></button></div>
    <div class="job-detail">
      <section class="job-detail-hero"><div><div class="meta-row">${freshnessPill(job)}${statusPill(job.status)}${matchBadge(job.fit)}</div><h2 id="jobDialogTitle">${escapeHtml(job.title)}</h2><p class="job-detail-company">${escapeHtml(job.company)}</p><p class="job-detail-summary">${escapeHtml(summary || "Open the live advert to confirm the responsibilities and requirements before applying.")}</p></div></section>
      <div class="decision-facts" aria-label="Fast job check">
        ${decisionFact("map", "Location", job.location)}
        ${decisionFact("home", "Work style", job.workPattern === "unknown" ? "Check advert" : titleCase(job.workPattern))}
        ${decisionFact("money", "Salary", salaryText(job))}
        ${decisionFact("calendar", "Posted", freshnessLabel(job).replace(/^Posted /, ""))}
      </div>
      <div class="job-detail-grid">
        <article class="detail-card decision-card good"><h3><svg aria-hidden="true"><use href="#icon-sparkles"></use></svg>Good signs</h3><ul class="reason-list">${job.fit.reasons.length ? job.fit.reasons.slice(0, 4).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("") : "<li>No strong match signal yet.</li>"}</ul></article>
        <article class="detail-card decision-card"><h3><svg aria-hidden="true"><use href="#icon-target"></use></svg>Check before applying</h3><ul class="concern-list">${concerns.length ? concerns.slice(0, 4).map((concern) => `<li>${escapeHtml(concern)}</li>`).join("") : "<li>No obvious blocker found—confirm the live advert is still open.</li>"}</ul></article>
      </div>
      <article class="detail-card advert-highlights"><h3><svg aria-hidden="true"><use href="#icon-file"></use></svg>What you’d be doing</h3><ul class="highlight-list">${highlights.length ? highlights.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>Open the live advert for the complete responsibilities and requirements.</li>"}</ul></article>
      <details class="job-disclosure"><summary><span><strong>Full advert snapshot</strong><small>Only open this when you need the original detail</small></span><svg aria-hidden="true"><use href="#icon-chevron"></use></svg></summary><div class="disclosure-body"><div class="job-description">${escapeHtml(job.description || "No description is saved yet. Open the live advert to review the details.")}</div></div></details>
      <details class="job-disclosure"><summary><span><strong>Application workspace</strong><small>Checklist, dates, CV tools, and private notes</small></span><svg aria-hidden="true"><use href="#icon-chevron"></use></svg></summary><div class="disclosure-body workbench-stack">
        <div class="job-detail-grid">
          <article class="detail-card"><h3><svg aria-hidden="true"><use href="#icon-check"></use></svg>Application checklist</h3><div class="checklist">${checklist.map((item) => `<label class="checklist-item"><input type="checkbox" data-checklist-id="${item.id}" data-job-id="${escapeHtml(job.id)}" ${item.done ? "checked" : ""}/><span><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></span></label>`).join("")}</div></article>
          <article class="detail-card"><h3><svg aria-hidden="true"><use href="#icon-calendar"></use></svg>Dates and state</h3><div class="field-grid"><label class="field full"><span>Pipeline stage</span><select data-job-field="status" data-job-id="${escapeHtml(job.id)}">${pipelineOptions(job.status)}</select></label><label class="field"><span>Applied</span><input type="date" data-job-field="appliedDate" data-job-id="${escapeHtml(job.id)}" value="${escapeHtml(job.appliedDate)}" /></label><label class="field"><span>Deadline</span><input type="date" data-job-field="deadline" data-job-id="${escapeHtml(job.id)}" value="${escapeHtml(job.deadline)}" /></label><label class="field full"><span>Interview time</span><input type="datetime-local" data-job-field="interviewAt" data-job-id="${escapeHtml(job.id)}" value="${escapeHtml(toDateTimeLocal(job.interviewAt))}" /></label></div><button class="button quiet full-button" type="button" data-job-action="open-cv" data-job-id="${escapeHtml(job.id)}" style="margin-top:12px"><svg aria-hidden="true"><use href="#icon-file"></use></svg>Prepare CV & messages</button></article>
        </div>
        <article class="detail-card"><h3><svg aria-hidden="true"><use href="#icon-edit"></use></svg>Private notes</h3><textarea class="job-notes" data-job-notes="${escapeHtml(job.id)}" placeholder="Questions, concerns, recruiter, interview detail…">${escapeHtml(job.notes)}</textarea><div class="notes-footer"><button class="button quiet small" type="button" data-job-action="save-notes" data-job-id="${escapeHtml(job.id)}">Save notes</button></div></article>
      </div></details>
      <section class="skip-panel" id="skipPanel"><h3>Why isn’t this a fit?</h3><div class="skip-reasons">${["Salary too low", "Wrong location / travel", "Too sales-led", "Too senior", "Contract or temporary", "Poor work-life fit"].map((reason) => `<label class="skip-reason"><input type="checkbox" name="skipReason" value="${escapeHtml(reason)}" />${escapeHtml(reason)}</label>`).join("")}</div><label class="field"><span>Anything else?</span><input id="skipOther" placeholder="A short reason improves future matches" /></label><div style="display:flex;justify-content:flex-end"><button class="button danger" type="button" data-job-action="confirm-skip" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-trash"></use></svg>Dismiss job</button></div></section>
    </div>
    <div class="job-decision-bar">
      <div class="job-decision-secondary">${!closeStatus ? `<button class="button quiet" type="button" data-job-action="toggle-skip" data-job-id="${escapeHtml(job.id)}">Dismiss</button>` : `<button class="button quiet" type="button" data-job-action="restore" data-job-id="${escapeHtml(job.id)}">Restore</button>`}${canSave ? `<button class="button quiet" type="button" data-job-action="save" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-sprout"></use></svg>Save</button>` : ""}</div>
      <div class="job-decision-primary">${canFollowUp ? `<button class="button quiet" type="button" data-job-action="copy-followup" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-copy"></use></svg>Copy follow-up</button>` : ""}${job.url ? `<a class="button quiet" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer" data-action="advert-opened" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-external"></use></svg>Live advert</a>` : ""}${canPrepare ? `<button class="button lime" type="button" data-job-action="prepare" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-file"></use></svg>Start application</button>` : ""}${canApply ? `<button class="button lime" type="button" data-job-action="applied" data-job-id="${escapeHtml(job.id)}"><svg aria-hidden="true"><use href="#icon-check"></use></svg>Mark applied</button>` : ""}</div>
    </div>
  </div>`;
}

function openJob(jobId) {
  state.selectedJobId = jobId;
  const job = findViewJob(jobId);
  if (!job) return;
  const trackedJob = state.jobs.find((item) => item.id === jobId);
  if (trackedJob && !trackedJob.seenAt) {
    trackedJob.seenAt = new Date().toISOString();
    saveSeenId(trackedJob.id);
    postAction("mark_seen", { jobId: trackedJob.id }, { silent: true });
  }
  renderJobDialog(jobId);
  jobDialog.showModal();
  updateDialogBodyState();
  renderShell();
}

function openAddJobDialog() {
  const form = document.querySelector("#addJobForm");
  form?.reset();
  if (form?.elements.postedDate) form.elements.postedDate.value = localDateKey(new Date());
  addJobDialog.showModal();
  updateDialogBodyState();
}

function openAccountDialog() {
  accountDialog.showModal();
  updateDialogBodyState();
}

function handleDocumentClick(event) {
  const close = event.target.closest("[data-close-dialog]");
  if (close) {
    document.querySelector(`#${CSS.escape(close.dataset.closeDialog)}`)?.close();
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    navigate(viewButton.dataset.view, viewButton.dataset.settingsSection || "");
    return;
  }
  const jobButton = event.target.closest("[data-open-job]");
  if (jobButton) {
    openJob(jobButton.dataset.openJob);
    return;
  }
  const profileRoleAction = event.target.closest("[data-profile-role-action]");
  if (profileRoleAction) {
    if (profileRoleAction.dataset.profileRoleAction === "add") addProfileRoleEditor();
    if (profileRoleAction.dataset.profileRoleAction === "remove") removeProfileRoleEditor(profileRoleAction);
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.discoverFilter = filter.dataset.filter;
    state.searchLimit = 60;
    render();
    return;
  }
  const locationFilter = event.target.closest("[data-search-location]");
  if (locationFilter) {
    state.searchLocation = locationFilter.dataset.searchLocation || "all";
    state.searchLimit = 60;
    render();
    return;
  }
  const searchMode = event.target.closest("[data-search-mode]");
  if (searchMode) {
    state.searchMode = searchMode.dataset.searchMode === "all" ? "all" : "recommended";
    state.discoverFilter = "week";
    state.searchLimit = 60;
    render();
    requestAnimationFrame(() => document.querySelector("#searchJobs")?.focus({ preventScroll: true }));
    return;
  }
  const searchQuery = event.target.closest("[data-search-query]");
  if (searchQuery) {
    state.search = searchQuery.dataset.searchQuery || "";
    state.searchLimit = 60;
    render();
    return;
  }
  const jobAction = event.target.closest("[data-job-action]");
  if (jobAction) {
    handleJobAction(jobAction.dataset.jobAction, jobAction.dataset.jobId);
    return;
  }
  const sourceToggle = event.target.closest("[data-source-toggle]");
  if (sourceToggle) {
    toggleSource(sourceToggle.dataset.sourceToggle);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (action) handleAction(action.dataset.action, action.dataset.jobId || "");
  const messageTabButton = event.target.closest("[data-message-kind]");
  if (messageTabButton) {
    state.messageKind = messageTabButton.dataset.messageKind;
    render();
    return;
  }
  const removeTag = event.target.closest("[data-remove-tag]");
  if (removeTag) removeTag.closest(".editable-tag")?.remove();
  const settingsButton = event.target.closest("[data-settings-target]");
  if (settingsButton) scrollToSettings(settingsButton.dataset.settingsTarget);
}

function handleDocumentInput(event) {
  if (event.target.id === "searchJobs") {
    state.search = event.target.value;
    state.searchLimit = 60;
    window.clearTimeout(handleDocumentInput.timer);
    handleDocumentInput.timer = window.setTimeout(render, 120);
  }
}

function handleDocumentChange(event) {
  const target = event.target;
  if (target.id === "sortJobs") {
    state.sort = target.value;
    render();
    return;
  }
  if (target.id === "searchLocation") {
    state.searchLocation = target.value;
    state.searchLimit = 60;
    render();
    return;
  }
  if (target.id === "cvJobPicker") {
    state.cvJobId = target.value;
    render();
    return;
  }
  if (target.id === "themeSelect") {
    state.preferences.theme = target.value;
    applyTheme(target.value);
    postAction("save_preferences", { preferences: state.preferences }, { silent: true });
    return;
  }
  if (target.matches("[data-checklist-id]")) {
    const job = ensureTrackedJob(target.dataset.jobId);
    if (!job) return;
    job.checklist = { ...(job.checklist || {}), [target.dataset.checklistId]: target.checked };
    updateJob(job.id, { checklist: job.checklist }, "Checklist saved", true);
    return;
  }
  if (target.matches("[data-job-field]")) {
    ensureTrackedJob(target.dataset.jobId);
    const value = target.dataset.jobField === "interviewAt" && target.value ? new Date(target.value).toISOString() : target.value;
    const patch = { [target.dataset.jobField]: value };
    if (target.dataset.jobField === "status") patch.status = normaliseStatus(value);
    updateJob(target.dataset.jobId, patch, "Application updated");
    renderJobDialog(target.dataset.jobId);
    return;
  }
  if (["alertEmail", "alertTelegram"].includes(target.name)) {
    state.preferences[target.name] = target.checked;
    postAction("save_preferences", { preferences: state.preferences });
  }
}

function handleDocumentSubmit(event) {
  if (event.target.id === "addJobForm") {
    event.preventDefault();
    addManualJob(new FormData(event.target));
    return;
  }
  if (event.target.id === "preferencesForm") {
    event.preventDefault();
    savePreferencesForm(event.target);
    return;
  }
  if (event.target.id === "profileForm") {
    event.preventDefault();
    saveProfileForm(event.target);
    return;
  }
  if (event.target.id === "sourceForm") {
    event.preventDefault();
    saveSourceForm(event.target);
  }
}

function handleDocumentKeydown(event) {
  if (!event.target.matches("[data-tag-input]")) return;
  if (event.key !== "Enter" && event.key !== ",") return;
  event.preventDefault();
  const value = event.target.value.trim().replace(/,$/, "");
  if (!value) return;
  const editor = event.target.closest(".tag-editor");
  const existing = [...editor.querySelectorAll(".editable-tag > span")].map((span) => span.textContent.toLowerCase());
  if (!existing.includes(value.toLowerCase())) {
    event.target.insertAdjacentHTML("beforebegin", editableTag(value));
  }
  event.target.value = "";
}

async function handleAction(action) {
  if (action === "clear-filters") {
    state.search = "";
    state.searchLocation = "all";
    state.discoverFilter = "week";
    state.searchLimit = 60;
    render();
  } else if (action === "show-all-search") {
    state.searchMode = "all";
    state.search = "";
    state.discoverFilter = "week";
    state.searchLimit = 60;
    render();
  } else if (action === "load-more") {
    state.searchLimit += 60;
    render();
  } else if (action === "mark-all-seen") {
    markAllSeen();
  } else if (action === "run-scout") {
    await runScout();
  } else if (action === "test-alert") {
    await postAction("test_alert", {}, { refresh: false });
    showToast("Test requested", "Check the alert inbox in a moment.", "success");
  } else if (action === "enable-notifications") {
    await enableNotifications();
  } else if (action === "install-app") {
    await installApp();
  } else if (action === "copy-message") {
    await copyMessage();
  } else if (action === "download-cv") {
    downloadCv();
  } else if (action === "resend-max-link") {
    await postAction("resend_max_link", {}, { refresh: false });
    showToast("Fresh link requested", "Max will receive a new private link; the previous Max link will stop working.", "success");
  } else if (action === "lock-device") {
    lockDevice();
  }
}

async function handleJobAction(action, jobId) {
  const job = action === "toggle-skip" ? findViewJob(jobId) : ensureTrackedJob(jobId);
  if (!job) return;
  if (action === "save") {
    updateJob(jobId, { status: "saved" }, "Saved for a focused review");
  } else if (action === "prepare") {
    updateJob(jobId, { status: "applying" }, "Application checklist started");
  } else if (action === "applied") {
    const appliedDate = localDateKey(new Date());
    updateJob(jobId, { status: "applied", appliedDate, nextActionAt: addDaysKey(appliedDate, state.preferences.followUpDays), checklist: { ...(job.checklist || {}), submitted: true } }, "Applied — follow-up scheduled");
  } else if (action === "copy-followup") {
    await copyText(buildMessage("followup", job, state.profile));
    showToast("Follow-up copied", "Personalise the name or one detail before sending.", "success");
  } else if (action === "toggle-skip") {
    document.querySelector("#skipPanel")?.classList.toggle("open");
    return;
  } else if (action === "confirm-skip") {
    const reasons = [...document.querySelectorAll('input[name="skipReason"]:checked')].map((input) => input.value);
    const other = document.querySelector("#skipOther")?.value.trim();
    if (other) reasons.push(other);
    const reason = reasons.join("; ") || "Not a fit for Max right now";
    job.status = "skipped";
    job.removed = true;
    job.removedReason = reason;
    job.tags = reasons.map((value) => value.toLowerCase());
    postAction("remove_job", { jobId, reason, tags: job.tags });
    showToast("Removed and learned", "Similar jobs will rank lower next time.", "success");
    jobDialog.close();
    render();
    return;
  } else if (action === "restore") {
    job.status = "saved";
    job.removed = false;
    job.removedReason = "";
    postAction("restore_job", { jobId });
    showToast("Job restored", "It is back in the interested column.", "success");
  } else if (action === "save-notes") {
    const notes = document.querySelector(`[data-job-notes="${CSS.escape(jobId)}"]`)?.value || "";
    updateJob(jobId, { notes }, "Notes saved");
  } else if (action === "open-cv") {
    state.cvJobId = jobId;
    jobDialog.close();
    navigate("cv");
    return;
  }
  render();
  if (jobDialog.open) renderJobDialog(jobId);
}

function addManualJob(form) {
  const raw = Object.fromEntries(form.entries());
  const job = normaliseJob({
    ...raw,
    id: `manual-${slugify(`${raw.company}-${raw.title}-${Date.now()}`)}`,
    salaryMin: Number(raw.salaryMin || 0),
    salaryMax: Number(raw.salaryMax || 0),
    source: `Added by ${state.person?.name || "Max"}`,
    sourceId: `manual-${Date.now()}`,
    discoveredAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    seenAt: new Date().toISOString(),
    status: "new",
  });
  const duplicate = state.jobs.find((item) => item.url && job.url && item.url === job.url);
  if (duplicate) {
    showToast("Already in the garden", `${duplicate.company} · ${duplicate.title}`, "error");
    return;
  }
  state.jobs.unshift(job);
  saveLocalWorkspace();
  postAction("upsert_job", { job });
  addJobDialog.close();
  state.view = "discover";
  render();
  showToast("Job added", "The match explanation is ready to review.", "success");
  openJob(job.id);
}

function savePreferencesForm(form) {
  const data = new FormData(form);
  const next = { ...state.preferences };
  ["minimumSalary", "preferredSalary", "maxDistanceKm", "reviewThreshold", "alertThreshold", "dailyApplicationGoal", "weeklyApplicationGoal", "followUpDays", "quietHoursStart", "quietHoursEnd"].forEach((key) => {
    if (data.has(key)) next[key] = Number(data.get(key));
  });
  next.workPatterns = data.getAll("workPatterns");
  next.contractTypes = data.getAll("contractTypes");
  ["targetTitles", "includeTerms", "excludeTerms", "preferredLocations", "mustHaveBenefits"].forEach((key) => {
    next[key] = readTags(key);
  });
  const detachedAlertEmail = document.querySelector('[name="alertEmail"]');
  const detachedAlertTelegram = document.querySelector('[name="alertTelegram"]');
  if (detachedAlertEmail) next.alertEmail = detachedAlertEmail.checked;
  if (detachedAlertTelegram) next.alertTelegram = detachedAlertTelegram.checked;
  state.preferences = normalisePreferences(next);
  applyTheme(state.preferences.theme);
  saveLocalWorkspace();
  postAction("save_preferences", { preferences: state.preferences });
  render();
  showToast("Search profile saved", "New and existing roles have been rescored.", "success");
}

function saveProfileForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const roles = [...form.querySelectorAll("[data-profile-role]")].map((editor) => ({
    title: editor.querySelector('[data-role-field="title"]')?.value.trim() || "",
    company: editor.querySelector('[data-role-field="company"]')?.value.trim() || "",
    location: editor.querySelector('[data-role-field="location"]')?.value.trim() || "",
    dates: editor.querySelector('[data-role-field="dates"]')?.value.trim() || "",
    bullets: splitLines(editor.querySelector('[data-role-field="bullets"]')?.value || ""),
  })).filter((role) => role.title && role.company && role.dates && role.bullets.length);
  const profile = {
    ...state.profile,
    ...data,
    skills: splitList(data.skills),
    tools: splitList(data.tools),
    certifications: splitLines(data.certifications),
    languages: splitLines(data.languages),
    roles,
  };
  state.profile = profile;
  saveLocalWorkspace();
  postAction("save_profile", { profile });
  render();
  showToast("CV facts saved", roles.length ? `Matched PDF unlocked with ${roles.length} role${roles.length === 1 ? "" : "s"}.` : "Add employment history to unlock the matched PDF.", roles.length ? "success" : "error");
}

function addProfileRoleEditor() {
  const list = document.querySelector("#employmentRoles");
  if (!list) return;
  list.querySelector(".employment-empty")?.remove();
  const index = list.querySelectorAll("[data-profile-role]").length;
  list.insertAdjacentHTML("beforeend", renderEmploymentRoleEditor({}, index));
  refreshEmploymentRoleNumbers();
  list.querySelector("[data-profile-role]:last-child input")?.focus();
}

function removeProfileRoleEditor(button) {
  const list = document.querySelector("#employmentRoles");
  button.closest("[data-profile-role]")?.remove();
  if (!list) return;
  if (!list.querySelector("[data-profile-role]")) list.innerHTML = `<div class="employment-empty"><strong>No employment history added yet</strong><span>Add Max’s latest role first. More positions can be added in any order.</span></div>`;
  refreshEmploymentRoleNumbers();
}

function refreshEmploymentRoleNumbers() {
  document.querySelectorAll("#employmentRoles [data-profile-role]").forEach((editor, index) => {
    const number = editor.querySelector(".employment-role-number");
    if (number) number.textContent = String(index + 1);
  });
  const count = document.querySelectorAll("#employmentRoles [data-profile-role]").length;
  const countLabel = document.querySelector(".history-count");
  if (countLabel) countLabel.textContent = `${count} role${count === 1 ? "" : "s"}`;
}

function saveSourceForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const source = { id: `custom-${slugify(`${data.name}-${Date.now()}`)}`, ...data, enabled: true, status: "Pending first scan" };
  state.sources.push(source);
  saveLocalWorkspace();
  postAction("upsert_source", { source });
  form.reset();
  render();
  showToast("Source added", "Scout will check it on the next run.", "success");
}

function toggleSource(sourceId) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) return;
  source.enabled = source.enabled === false;
  source.status = source.enabled ? "Pending next scan" : "Paused";
  saveLocalWorkspace();
  postAction("toggle_source", { sourceId, enabled: source.enabled });
  render();
  showToast(source.enabled ? "Source resumed" : "Source paused", source.name, "success");
}

function updateJob(jobId, patch, message = "Saved", silent = false) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  saveLocalWorkspace();
  postAction("update_job", { jobId, changes: patch }, { silent: true });
  if (!silent) showToast(message, `${job.company} · ${job.title}`, "success");
}

async function runScout() {
  if (state.syncing) return;
  if (state.mode === "local") {
    showToast("Scout is checking", "Scanning enabled sources for fresh roles.");
    return runLocalScout();
  }
  state.syncing = true;
  renderShell();
  showToast("Scout is checking", "Scanning enabled sources for fresh roles.");
  try {
    await postAction("run_scout", {}, { silent: true, refresh: false });
    window.setTimeout(() => refreshData(), 1800);
  } finally {
    window.setTimeout(() => { state.syncing = false; renderShell(); }, 2200);
  }
}

async function runLocalScout(options = {}) {
  if (state.syncing) return;
  state.syncing = true;
  document.querySelector("#refreshData")?.classList.add("spinning");
  renderShell();
  if (state.mode !== "local" || !navigator.onLine) {
    state.syncing = false;
    renderShell();
    return;
  }
  const existingKeys = new Set(state.jobs.flatMap((job) => [job.id, job.url].filter(Boolean)));
  const enabled = state.sources.filter((source) => source.enabled !== false);
  const startedAt = new Date();
  try {
    const settled = await Promise.allSettled(enabled.map(fetchLocalSource));
    if (!settled.some((result) => result.status === "fulfilled")) throw new Error("All enabled job sources were unavailable");
    const candidates = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const liveFeedKeys = new Set(candidates.flatMap((job) => [job.id, job.url].filter(Boolean)));
    state.jobs = state.jobs.filter((job) => {
      if (job.status !== "new" || !isManagedFeedJob(job)) return true;
      return liveFeedKeys.has(job.id) || liveFeedKeys.has(job.url);
    });
    const ranked = decorateJobs(uniqueJobs(candidates).filter(isMaxLocationEligible).filter(isMaxRoleEligible), state.preferences, state.jobs)
      .filter((job) => job.fit.score >= state.preferences.reviewThreshold)
      .sort((a, b) => String(b.postedDate).localeCompare(String(a.postedDate)) || b.fit.score - a.fit.score);
    const fresh = ranked.filter((job) => !existingKeys.has(job.id) && !existingKeys.has(job.url)).slice(0, 80);
    if (fresh.length) state.jobs = uniqueJobs([...fresh, ...state.jobs]);
    const now = new Date().toISOString();
    const sourceResults = new Map(enabled.map((source, index) => [source.id, settled[index]]));
    state.sources = state.sources.map((source) => {
      if (source.enabled === false) return source;
      const result = sourceResults.get(source.id);
      return { ...source, status: result?.status === "fulfilled" ? "Healthy" : "Temporarily unavailable", lastScanAt: now };
    });
    state.scout = { status: "healthy", lastRunAt: now, nextRunAt: new Date(Date.now() + 15 * 60000).toISOString(), lastNewCount: fresh.length, sourceCount: state.feedSourceCount || enabled.length };
    state.generatedAt = now;
    saveLocalWorkspace();
    if (fresh.length) await notifyNewJobs(fresh);
    render();
    renderConnection();
    if (!options.silent) showToast("Scout finished", fresh.length ? `${fresh.length} relevant role${fresh.length === 1 ? "" : "s"} added.` : "No new relevant roles this time.", "success");
  } catch (error) {
    state.scout = { ...state.scout, status: "error", lastRunAt: startedAt.toISOString(), detail: error.message };
    saveLocalWorkspace();
    render();
    if (!options.silent) showToast("Scout could not check", "Your saved workspace still works; try Refresh again shortly.", "error");
  } finally {
    state.syncing = false;
    document.querySelector("#refreshData")?.classList.remove("spinning");
    renderShell();
  }
}

async function fetchLocalSource(source) {
  if (source.id === "job-garden-curated") {
    const response = await fetch(`${source.endpoint}?v=${Date.now()}`, { cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Curated job watch returned ${response.status}`);
    const payload = await response.json();
    state.feedSourceCount = (payload.sources || []).length || state.feedSourceCount;
    state.feedFreshnessDays = Math.max(1, Math.min(7, Number(payload.freshnessWindowDays) || 7));
    state.searchIndex = (payload.searchJobs || payload.jobs || []).map(normaliseJob);
    state.generatedAt = payload.generatedAt || state.generatedAt;
    return (payload.jobs || []).map(normaliseJob);
  }
  if (source.id === "remotive") {
    const response = await fetch(source.endpoint, { cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Remotive returned ${response.status}`);
    const payload = await response.json();
    return (payload.jobs || []).map((job) => normaliseJob({
      id: `remotive-${job.id}`,
      sourceId: String(job.id || ""),
      title: job.title,
      company: job.company_name,
      location: job.candidate_required_location || "Remote",
      salary: job.salary,
      source: "Remotive",
      url: job.url,
      postedDate: job.publication_date,
      discoveredAt: new Date().toISOString(),
      workPattern: "remote",
      contractType: job.job_type,
      category: job.category,
      tags: job.tags,
      description: job.description,
      status: "new",
    }));
  }
  if (source.id === "arbeitnow") {
    const response = await fetch(source.endpoint, { cache: "no-store", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Arbeitnow returned ${response.status}`);
    const payload = await response.json();
    return (payload.data || []).map((job) => normaliseJob({
      id: `arbeitnow-${job.slug}`,
      sourceId: job.slug,
      title: job.title,
      company: job.company_name,
      location: job.location || (job.remote ? "Europe · Remote" : "Europe"),
      source: "Arbeitnow",
      url: job.url,
      postedDate: job.created_at,
      discoveredAt: new Date().toISOString(),
      workPattern: job.remote ? "remote" : "unknown",
      contractType: (job.job_types || []).join(" "),
      tags: job.tags,
      description: job.description,
      status: "new",
    }));
  }
  return [];
}

function markAllSeen() {
  const now = new Date().toISOString();
  state.jobs.filter((job) => job.status === "new" && !job.seenAt).forEach((job) => {
    job.seenAt = now;
    saveSeenId(job.id);
  });
  saveLocalWorkspace();
  postAction("mark_all_seen", {}, { silent: true });
  render();
  showToast("All caught up", "Fresh jobs will stand out again after the next scan.", "success");
}

async function refreshData(options = {}) {
  if (!state.connected) return;
  if (state.mode === "local") {
    await runLocalScout({ silent: options.silent });
    return;
  }
  if (state.syncing && !options.force) return;
  state.syncing = true;
  document.querySelector("#refreshData")?.classList.add("spinning");
  try {
    const before = new Set(state.jobs.map((job) => job.id));
    const payload = await jsonpRequest("bootstrap");
    if (!payload?.ok) throw new Error(payload?.error || "Refresh failed.");
    hydrate(payload);
    state.connected = true;
    state.offline = false;
    saveCache(payload);
    const fresh = state.jobs.filter((job) => !before.has(job.id));
    if (fresh.length) notifyNewJobs(fresh);
    render();
    renderConnection();
    if (!options.silent) showToast("Garden refreshed", fresh.length ? `${fresh.length} new role${fresh.length === 1 ? "" : "s"} found.` : "Everything is up to date.", "success");
  } catch (error) {
    state.offline = true;
    renderConnection();
    if (!options.silent) showToast("Could not refresh", "The cached garden is still available.", "error");
  } finally {
    state.syncing = false;
    document.querySelector("#refreshData")?.classList.remove("spinning");
  }
}

async function postAction(action, data = {}, options = {}) {
  if (state.mode === "local") {
    saveLocalWorkspace();
    return { ok: true, local: true };
  }
  const api = localStorage.getItem(KEYS.api);
  const access = localStorage.getItem(KEYS.access);
  if (!api || !access) throw new Error("Private access is missing.");
  const payload = { action, access, actor: state.person?.id || "", at: new Date().toISOString(), device: deviceLabel(), ...data };
  try {
    await fetch(api, {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (options.refresh !== false) scheduleRefresh();
    return { ok: true };
  } catch (error) {
    state.offline = true;
    renderConnection();
    if (!options.silent) showToast("Saved on this device", "The shared Sheet will update when the connection returns.", "error");
    throw error;
  }
}

function jsonpRequest(action, parameters = {}) {
  const api = localStorage.getItem(KEYS.api);
  const access = localStorage.getItem(KEYS.access);
  if (!api || !access) return Promise.reject(new Error("Private access is missing."));
  return new Promise((resolve, reject) => {
    const callback = `mjgcb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const url = new URL(api);
    url.searchParams.set("action", action);
    url.searchParams.set("access", access);
    url.searchParams.set("callback", callback);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => cleanup(new Error("The shared garden took too long to respond.")), 16000);
    function cleanup(error, value) {
      window.clearTimeout(timeout);
      delete window[callback];
      script.remove();
      error ? reject(error) : resolve(value);
    }
    window[callback] = (value) => cleanup(null, value);
    script.onerror = () => cleanup(new Error("The shared garden could not be reached."));
    script.referrerPolicy = "no-referrer";
    script.src = url.href;
    document.head.append(script);
  });
}

function navigate(view, settingsSection = "") {
  if (!VIEW_META[view]) view = "today";
  state.view = view;
  const hash = `#view=${encodeURIComponent(view)}`;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "settings" && settingsSection) requestAnimationFrame(() => scrollToSettings(settingsSection));
  requestAnimationFrame(() => viewContent.focus({ preventScroll: true }));
}

function scrollToSettings(section) {
  document.querySelectorAll("[data-settings-target]").forEach((button) => button.classList.toggle("active", button.dataset.settingsTarget === section));
  document.querySelector(`#settings-${CSS.escape(section)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderConnection() {
  if (state.mode === "local") {
    connectionBanner.hidden = true;
    return;
  }
  if (state.offline || !navigator.onLine) {
    connectionBanner.hidden = false;
    connectionBanner.className = "connection-banner error";
    connectionBanner.textContent = "Offline — showing the last synced garden. Changes will retry when the connection returns.";
    return;
  }
  connectionBanner.hidden = true;
}

function setAccessStatus(message, tone) {
  if (!accessStatus) return;
  accessStatus.className = `access-status ${tone || ""}`;
  accessStatus.querySelector("span:last-child").textContent = message;
}

function lockDevice() {
  [KEYS.access, KEYS.api, KEYS.cache, KEYS.workspace, KEYS.personHint, KEYS.seenIds].forEach((key) => localStorage.removeItem(key));
  window.clearInterval(state.pollTimer);
  accountDialog?.close();
  state.jobs = [];
  state.activity = [];
  state.preferences = normalisePreferences(DEFAULT_PREFERENCES);
  state.profile = structuredClone(maxProfile);
  state.scout = { status: "ready", sourceCount: 1 };
  state.connected = true;
  render();
  renderConnection();
  showToast("Device reset", "Local jobs and settings were removed from this browser.", "success");
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast("Not supported", "This browser does not provide web notifications.", "error");
    return;
  }
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") {
    showToast("Notifications remain off", "You can enable them later from this browser's site settings.", "error");
    render();
    return;
  }
  const sample = decoratedJobs().find((job) => job.fit.score >= state.preferences.alertThreshold) || decoratedJobs()[0];
  await showBrowserNotification(sample ? `${sample.fit.score}% match · ${sample.title}` : "Job Garden notifications are ready", sample ? `${sample.company} · ${sample.location}` : "Fresh roles will appear here.", sample?.url || "./#view=discover", "notification-test");
  render();
}

async function notifyNewJobs(freshJobs) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const decorated = decorateJobs(freshJobs, state.preferences, state.jobs).sort((a, b) => b.fit.score - a.fit.score);
  const best = decorated[0];
  if (!best || best.fit.score < state.preferences.alertThreshold) return;
  const extra = decorated.filter((job) => job.fit.score >= state.preferences.alertThreshold).length - 1;
  await showBrowserNotification(`${best.fit.score}% match · ${best.title}`, `${best.company} · ${best.location}${extra > 0 ? ` · +${extra} more` : ""}`, best.url || "./#view=discover", `job-${best.id}`);
}

async function showBrowserNotification(title, body, url, tag) {
  const registration = await navigator.serviceWorker?.ready;
  if (registration?.showNotification) {
    return registration.showNotification(title, { body, icon: "./assets/garden-mark-192.png", badge: "./assets/garden-mark-192.png", data: { url }, tag, renotify: true });
  }
  return new Notification(title, { body, icon: "./assets/garden-mark-192.png", tag });
}

async function installApp() {
  if (!state.installPrompt) return;
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  render();
}

async function copyMessage() {
  const selected = decoratedJobs().find((job) => job.id === state.cvJobId);
  if (!selected) return;
  await copyText(buildMessage(state.messageKind, selected, state.profile));
  showToast("Message copied", "Personalise the name and one specific detail before sending.", "success");
}

function downloadCv() {
  const selected = decoratedJobs().find((job) => job.id === state.cvJobId);
  if (!selected) return;
  try {
    downloadTailoredCv(selected, state.profile);
    postAction("cv_downloaded", { jobId: selected.id }, { silent: true, refresh: false });
    showToast("Matched CV downloaded", "Employment facts remain unchanged.", "success");
  } catch (error) {
    showToast("CV needs attention", error.message, "error");
  }
}

function decoratedJobs() {
  const seenIds = new Set(loadJson(KEYS.seenIds, []));
  const jobs = state.jobs.map((job) => seenIds.has(job.id) && !job.seenAt ? { ...job, seenAt: "this-device" } : job);
  return decorateJobs(jobs, state.preferences, jobs);
}

function decoratedSearchJobs() {
  const trackedById = new Map(state.jobs.map((job) => [job.id, job]));
  const trackedByUrl = new Map(state.jobs.filter((job) => job.url).map((job) => [job.url, job]));
  const jobs = state.searchIndex.map((job) => trackedById.get(job.id) || trackedByUrl.get(job.url) || job);
  return decorateJobs(uniqueJobs(jobs), state.preferences, state.jobs);
}

function findViewJob(jobId) {
  return decoratedJobs().find((job) => job.id === jobId) || decoratedSearchJobs().find((job) => job.id === jobId);
}

function ensureTrackedJob(jobId) {
  let job = state.jobs.find((item) => item.id === jobId);
  if (job) return job;
  const searchJob = state.searchIndex.find((item) => item.id === jobId);
  if (!searchJob) return null;
  job = normaliseJob({ ...searchJob, status: "new", seenAt: new Date().toISOString(), firstSeenAt: new Date().toISOString() });
  state.jobs.unshift(job);
  saveSeenId(job.id);
  saveLocalWorkspace();
  return job;
}

function matchesJobSearch(job, query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${job.title} ${job.company} ${job.location} ${job.description} ${job.source} ${(job.tags || []).join(" ")} ${job.category || ""}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function matchesSearchLocation(job, location) {
  if (!location || location === "all") return true;
  const rank = maxLocationRank(job);
  if (location === "glasgow") return rank === 0;
  if (location === "remote-uk") return rank === 1;
  if (location === "edinburgh") return rank === 2;
  if (location === "other-remote") return rank === 3;
  return true;
}

function isManagedFeedJob(job) {
  return Boolean(job.feedManaged) || / careers$/i.test(job.source || "") || ["Jobgether", "Arbeitnow", "Remote OK", "Remotive"].includes(job.source);
}

function scoreRing(fit) {
  const score = fit?.score || 0;
  const band = fit?.band || fitBand(score);
  return `<span class="score-ring ${band}" style="--score:${score}" aria-label="${score}% match, ${escapeHtml(bandLabel(band))}"><strong>${score}%</strong><small>match</small></span>`;
}

function matchBadge(fit) {
  const score = fit?.score || 0;
  const band = fit?.band || fitBand(score);
  return `<span class="match-badge ${band}" aria-label="${score}% CV match"><strong>${score}%</strong><span>CV match</span></span>`;
}

function metricCard(icon, label, value, detail, tone = "") {
  return `<article class="metric-card"><span class="metric-icon ${tone}"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span class="metric-copy"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></span></article>`;
}

function statusPill(status) {
  const clean = normaliseStatus(status);
  const labels = Object.fromEntries(PIPELINE.map((item) => [item.id, item.shortLabel]));
  const label = labels[clean] || ({ closed: "No response", withdrawn: "Withdrawn", skipped: "Skipped", hired: "Hired" })[clean] || titleCase(clean.replaceAll("_", " "));
  const tone = clean === "new" ? "new" : ["applied", "offer", "hired"].includes(clean) ? "good" : ["applying", "saved", "follow_up"].includes(clean) ? "warn" : clean === "interview" ? "interview" : ["rejected", "withdrawn", "closed", "skipped"].includes(clean) ? "bad" : "";
  return `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
}

function jobAge(job) {
  return daysSince(job.postedDate || job.discoveredAt);
}

function freshnessLabel(job) {
  const age = jobAge(job);
  if (age === 0) return "Posted today";
  if (age === 1) return "Posted yesterday";
  if (age !== null) return `Posted ${age} days ago`;
  return "Posting date unavailable";
}

function freshnessPill(job) {
  const age = jobAge(job);
  const label = age === 0 ? "Today" : age === 1 ? "Yesterday" : age !== null && age <= 3 ? `${age} days new` : age !== null ? `${age} days old` : "Date unknown";
  const tone = age !== null && age <= 1 ? "urgent" : age !== null && age <= 3 ? "recent" : "week";
  return `<span class="freshness-pill ${tone}"><svg aria-hidden="true"><use href="#icon-zap"></use></svg>${escapeHtml(label)}</span>`;
}

function decisionFact(icon, label, value) {
  return `<div class="decision-fact"><span class="decision-fact-icon"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span></div>`;
}

function advertSummary(value, maxLength = 260) {
  const sentences = advertSentences(value);
  const summary = sentences.slice(0, 2).join(" ");
  if (!summary) return "";
  return summary.length <= maxLength ? summary : `${summary.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function advertHighlights(value) {
  const sentences = advertSentences(value);
  const useful = sentences.filter((sentence) => /\b(?:manage|lead|own|deliver|support|partner|coordinate|onboard|experience|required|responsib|customer|client|stakeholder)\b/i.test(sentence));
  return uniqueList((useful.length ? useful : sentences).map((sentence) => sentence.length > 220 ? `${sentence.slice(0, 219).trimEnd()}…` : sentence)).slice(0, 4);
}

function advertSentences(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35)
    .filter((sentence) => !/equal opportun|privacy notice|personal data|how jobgether works|we appreciate your interest|all qualified applicants/i.test(sentence));
}

function metaPill(value, tone = "") {
  if (!value) return "";
  return `<span class="meta-pill ${tone}">${escapeHtml(value)}</span>`;
}

function filterChip(id, label, count) {
  return `<button class="filter-chip ${state.discoverFilter === id ? "active" : ""}" type="button" data-filter="${id}">${escapeHtml(label)}<span class="chip-count">${count}</span></button>`;
}

function locationChip(id, label, count) {
  return `<button class="filter-chip ${state.searchLocation === id ? "active" : ""}" type="button" data-search-location="${id}">${escapeHtml(label)}<span class="chip-count">${count}</span></button>`;
}

function renderEmpty(icon, title, body, buttonLabel = "", action = "") {
  return `<div class="empty-state"><div><span class="empty-icon"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>${buttonLabel ? `<button class="button quiet" type="button" data-action="${escapeHtml(action)}">${escapeHtml(buttonLabel)}</button>` : ""}</div></div>`;
}

function learningItem(icon, title, body) {
  return `<div class="learning-item"><span class="learning-item-icon"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg></span><span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></span></div>`;
}

function profileFact(icon, text) {
  return `<div class="profile-fact"><svg aria-hidden="true"><use href="#icon-${icon}"></use></svg><span>${escapeHtml(text)}</span></div>`;
}

function messageTab(kind, label) {
  return `<button class="segmented-button ${state.messageKind === kind ? "active" : ""}" type="button" role="tab" aria-selected="${state.messageKind === kind}" data-message-kind="${kind}">${escapeHtml(label)}</button>`;
}

function settingsNavButton(id, label) {
  return `<button type="button" data-settings-target="${id}">${escapeHtml(label)}</button>`;
}

function tagEditor(key, values, placeholder) {
  return `<div class="tag-editor" data-key="${escapeHtml(key)}">${(values || []).map(editableTag).join("")}<input data-tag-input="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" /></div>`;
}

function editableTag(value) {
  return `<span class="editable-tag"><span>${escapeHtml(value)}</span><button type="button" data-remove-tag aria-label="Remove ${escapeHtml(value)}"><svg aria-hidden="true"><use href="#icon-close"></use></svg></button></span>`;
}

function checkControl(name, value, label, selected) {
  return `<label class="check-control"><input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${(selected || []).includes(value) ? "checked" : ""}/>${escapeHtml(label)}</label>`;
}

function switchControl(name, checked) {
  const label = ({ alertEmail: "Immediate email alerts", alertTelegram: "Telegram alerts" })[name] || titleCase(name);
  return `<label class="switch"><input type="checkbox" name="${escapeHtml(name)}" aria-label="${escapeHtml(label)}" ${checked ? "checked" : ""}/><span aria-hidden="true"></span></label>`;
}

function renderSourceRow(source) {
  const canManage = state.person?.role === "supporter" || state.person?.role === "owner";
  const healthy = source.enabled !== false && !/error|failed|needs|paused/i.test(source.status || "");
  const status = source.enabled === false ? "Paused" : source.status || "Ready";
  const control = canManage ? `<button class="button quiet small" type="button" data-source-toggle="${escapeHtml(source.id)}" aria-label="${source.enabled === false ? "Resume" : "Pause"} ${escapeHtml(source.name || "source")}">${source.enabled === false ? "Resume" : "Pause"}</button>` : "";
  return `<div class="source-row"><span class="source-icon"><svg aria-hidden="true"><use href="#icon-${source.type === "rss" ? "inbox" : "search"}"></use></svg></span><span class="source-copy"><strong>${escapeHtml(source.name || source.id || "Job source")}</strong><span>${escapeHtml(titleCase(source.type || "source"))}${source.lastScanAt ? ` · checked ${timeAgo(source.lastScanAt)}` : ""}</span></span><span class="source-actions"><span class="health-badge ${healthy ? "" : "warn"}">${escapeHtml(status)}</span>${control}</span></div>`;
}

function pipelineOptions(selectedStatus) {
  const stages = [...PIPELINE, { id: "withdrawn", label: "Withdrawn" }, { id: "closed", label: "No response" }, { id: "skipped", label: "Skipped" }];
  return stages.map((stage) => `<option value="${stage.id}" ${stage.id === normaliseStatus(selectedStatus) ? "selected" : ""}>${escapeHtml(stage.label)}</option>`).join("");
}

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function salaryText(job) {
  if (job.salary && !/not listed/i.test(job.salary)) return job.salary;
  if (job.salaryMin && job.salaryMax && job.salaryMin !== job.salaryMax) return `${formatMoney(job.salaryMin)}–${formatMoney(job.salaryMax)}`;
  return formatMoney(job.salaryMax || job.salaryMin) || "Salary not listed";
}

function heroMessage(action) {
  if (action.kind === "follow_up") return "Close one open loop.";
  if (action.kind === "interview") return "Prepare the proof, not a performance.";
  if (action.kind === "deadline") return "One deadline deserves a decision.";
  if (action.kind === "fresh_match") return "A strong new match is worth ten minutes.";
  if (action.kind === "applying") return "Finish the application already in motion.";
  return "Make one clear decision.";
}

function scoutHealthy() {
  const status = String(state.scout.status || "").toLowerCase();
  return ["healthy", "ok", "ready", "success"].includes(status) || Boolean(state.scout.sourceCount > 0 && !["error", "failed"].includes(status));
}

function scoutStatusSentence() {
  if (state.mode === "local" && state.scout.lastRunAt) return `Scout checked ${timeAgo(state.scout.lastRunAt)} and will check again while Job Garden stays open.`;
  if (state.mode === "local") return "Scout is ready to check two no-key job feeds now.";
  if (state.scout.status === "sleeping") return "Scout is respecting quiet hours and will resume in the morning.";
  if (state.scout.lastRunAt) return `Scout checked ${timeAgo(state.scout.lastRunAt)}${state.scout.lastNewCount ? ` and found ${state.scout.lastNewCount} new` : ""}.`;
  if (state.scout.sourceCount > 0) return `Scout is watching ${state.scout.sourceCount} sources and only publishing roles from the last ${state.feedFreshnessDays} days.`;
  if (!state.scout.apiConfigured) return "Scout needs at least one active source.";
  return "Scout is waiting for its first scheduled run.";
}

function renderNoop() {}

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function readTags(key) {
  return [...document.querySelectorAll(`.tag-editor[data-key="${CSS.escape(key)}"] .editable-tag > span`)].map((span) => span.textContent.trim()).filter(Boolean);
}

function splitList(value) {
  return uniqueList(String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean));
}

function splitLines(value) {
  return uniqueList(String(value || "").split(/\n/).map((item) => item.trim()).filter(Boolean));
}

function setBadge(id, value, show) {
  const element = document.querySelector(`#${id}`);
  element.textContent = String(value);
  element.hidden = !show;
}

function initials(value) {
  return String(value || "M").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function initialView() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const view = params.get("view");
  return VIEW_META[view] ? view : "today";
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function uniqueJobs(items) {
  const byId = new Map();
  items.forEach((item) => {
    const job = normaliseJob(item);
    const key = job.id || job.sourceId || `${job.company}-${job.title}-${job.appliedDate}`;
    byId.set(key, { ...(byId.get(key) || {}), ...job });
  });
  return [...byId.values()];
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => refreshData({ silent: true }), 1400);
}

function startPolling() {
  window.clearInterval(state.pollTimer);
  state.pollTimer = window.setInterval(() => {
    if (!document.hidden && navigator.onLine) refreshData({ silent: true });
  }, 120000);
}

function startLocalScout() {
  window.clearInterval(state.pollTimer);
  window.setTimeout(() => {
    if (!document.hidden && navigator.onLine) runLocalScout({ silent: true });
  }, 900);
  state.pollTimer = window.setInterval(() => {
    if (!document.hidden && navigator.onLine) runLocalScout({ silent: true });
  }, 15 * 60000);
}

function saveLocalWorkspace() {
  if (state.mode !== "local") return;
  const payload = {
    profile: state.profile,
    preferences: state.preferences,
    jobs: state.jobs.slice(0, 500),
    sources: state.sources,
    activity: state.activity.slice(0, 250),
    scout: state.scout,
    generatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(KEYS.workspace, JSON.stringify(payload)); } catch { renderNoop(); }
}

function saveCache(payload) {
  try { localStorage.setItem(KEYS.cache, JSON.stringify({ payload, cachedAt: new Date().toISOString() })); } catch { renderNoop(); }
}

function loadCache() {
  const value = loadJson(KEYS.cache, null);
  if (!value?.payload) return null;
  const age = Date.now() - new Date(value.cachedAt || 0).getTime();
  return age < 30 * 86400000 ? value.payload : null;
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveSeenId(id) {
  const ids = new Set(loadJson(KEYS.seenIds, []));
  ids.add(id);
  localStorage.setItem(KEYS.seenIds, JSON.stringify([...ids].slice(-500)));
}

function applyTheme(theme) {
  const clean = ["light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = clean === "system" ? "" : clean;
  localStorage.setItem(KEYS.theme, clean);
}

function updateDialogBodyState() {
  document.body.classList.toggle("dialog-open", [jobDialog, addJobDialog, accountDialog].some((dialog) => dialog?.open));
}

function showToast(title, message = "", tone = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<svg aria-hidden="true"><use href="#icon-${tone === "error" ? "close" : tone === "success" ? "check" : "sprout"}"></use></svg><span><strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ""}</span>`;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function deviceLabel() {
  return `${window.innerWidth}px · ${navigator.maxTouchPoints > 0 ? "touch" : "pointer"}`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
