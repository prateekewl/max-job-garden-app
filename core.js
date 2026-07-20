export const PIPELINE = Object.freeze([
  { id: "new", label: "New", shortLabel: "New" },
  { id: "saved", label: "Worth a look", shortLabel: "Saved" },
  { id: "applying", label: "Preparing", shortLabel: "Preparing" },
  { id: "applied", label: "Applied", shortLabel: "Applied" },
  { id: "follow_up", label: "Follow up", shortLabel: "Follow up" },
  { id: "interview", label: "Interview", shortLabel: "Interview" },
  { id: "offer", label: "Offer", shortLabel: "Offer" },
  { id: "rejected", label: "Closed", shortLabel: "Closed" },
]);

export const ACTIVE_STATUSES = new Set(["new", "saved", "applying", "applied", "follow_up", "interview", "offer"]);
export const APPLICATION_STATUSES = new Set(["applied", "follow_up", "interview", "offer", "rejected", "withdrawn", "closed", "hired"]);

export const DEFAULT_PREFERENCES = Object.freeze({
  targetTitles: [
    "Customer Success Manager",
    "Customer Success Team Lead",
    "Service Delivery Manager",
    "Service Delivery Lead",
    "Client Services Manager",
    "Client Operations Manager",
    "Account Manager",
    "Implementation Manager",
    "Implementation Consultant",
    "Onboarding Manager",
    "Supplier Engagement Manager",
    "Customer Experience Manager",
    "Service Operations Manager",
    "Customer Operations Manager",
    "Client Onboarding Manager",
    "Client Relationship Manager",
  ],
  includeTerms: [
    "client relationship",
    "service delivery",
    "customer success",
    "stakeholder",
    "onboarding",
    "workforce",
    "process improvement",
    "German",
    "DACH",
  ],
  excludeTerms: [
    "commission only",
    "door to door",
    "self-employed",
    "warehouse shift",
    "field sales",
    "security clearance required",
  ],
  preferredLocations: ["Glasgow", "Renfrewshire", "Edinburgh"],
  workPatterns: ["remote", "hybrid"],
  contractTypes: ["permanent", "full_time"],
  mustHaveBenefits: ["annual leave", "sick pay", "pension"],
  minimumSalary: 40000,
  preferredSalary: 48000,
  maxDistanceKm: 40,
  alertThreshold: 74,
  reviewThreshold: 54,
  dailyApplicationGoal: 2,
  weeklyApplicationGoal: 8,
  followUpDays: 5,
  quietHoursStart: 23,
  quietHoursEnd: 7,
  alertEmail: true,
  alertTelegram: false,
  theme: "system",
  compactCards: false,
});

const STATUS_ALIASES = Object.freeze({
  "to apply": "new",
  interested: "saved",
  shortlist: "saved",
  preparing: "applying",
  sent: "applied",
  "1. interview": "interview",
  "2. interview": "interview",
  "3. interview": "interview",
  "4. interview": "interview",
  hired: "offer",
  "no response": "closed",
  skipped: "skipped",
  removed: "skipped",
  withdrawn: "withdrawn",
});

const ROLE_TERMS = [
  "customer success",
  "client success",
  "service delivery",
  "client services",
  "client operations",
  "customer experience",
  "account manager",
  "account management",
  "implementation",
  "onboarding",
  "supplier engagement",
  "vendor management",
  "workforce",
  "stakeholder",
  "process improvement",
  "operations",
  "service manager",
];

const HARD_TITLE_MISMATCH = /\b(?:executive|personal|administrative) assistant\b|\bassistant to\b|\bproject coordinator\b|\bprogramme coordinator\b|\bprogram coordinator\b|\bai operations\b|\bmarketing operations\b|\b(?:developer|engineer|architect|designer)\b|\btechnical support\b|\bhelp\s?desk\b|\bcustomer (?:service|support) (?:advisor|agent|representative)\b|\b(?:sales|channel|distribution|commercial|advertising|affiliate) account manager\b|\baccount executive\b|\bbusiness development\b/;
const PRIMARY_ROLE_TITLE = /\b(?:customer|client) success (?:manager|lead|team lead|executive)\b|\bservice delivery (?:manager|lead)\b|\bclient services? (?:manager|lead)\b|\b(?:manager|lead)[, -]+client services?\b|\bclient operations (?:manager|lead)\b|\bcustomer operations (?:manager|lead)\b|\bimplementation (?:manager|consultant|lead)\b|\bonboarding (?:manager|consultant|lead)\b|\b(?:manager|lead)\b.*\bclient onboarding\b|\bcustomer experience (?:manager|lead)\b|\bclient relationship manager\b/;
const ADJACENT_ROLE_TITLE = /\baccount manager\b|\bsupplier (?:engagement|relationship) manager\b|\bvendor relationship manager\b|\bworkforce (?:operations|planning) (?:manager|lead)\b|\bservice operations (?:manager|lead)\b|\bcustomer (?:support|service) (?:manager|lead|team lead)\b|\bteam (?:leader|lead)\b.*\bcustomer (?:support|service|operations)\b/;
const CLIENT_DELIVERY_EVIDENCE = [
  /\bclient(?:s|'s)?\b|\bcustomer(?:s|'s)?\b/,
  /\bservice delivery\b|\bservice level\b|\bsla\b/,
  /\bstakeholder\b|\brelationship management\b|\btrusted advisor\b/,
  /\bonboarding\b|\bimplementation\b|\bcustomer lifecycle\b/,
  /\bescalation\b|\bissue resolution\b|\bproblem solving\b/,
  /\bprocess improvement\b|\bcontinuous improvement\b|\boperational improvement\b/,
];

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "uk", "senior", "manager", "lead", "specialist",
]);

export function normalisePreferences(value = {}) {
  const merged = { ...DEFAULT_PREFERENCES, ...(value || {}) };
  const arrays = ["targetTitles", "includeTerms", "excludeTerms", "preferredLocations", "workPatterns", "contractTypes", "mustHaveBenefits"];
  arrays.forEach((key) => {
    merged[key] = uniqueList(toArray(merged[key]).map(String).map((item) => item.trim()).filter(Boolean));
  });
  ["minimumSalary", "preferredSalary", "maxDistanceKm", "alertThreshold", "reviewThreshold", "dailyApplicationGoal", "weeklyApplicationGoal", "followUpDays", "quietHoursStart", "quietHoursEnd"].forEach((key) => {
    merged[key] = finiteNumber(merged[key], DEFAULT_PREFERENCES[key]);
  });
  ["alertEmail", "alertTelegram", "compactCards"].forEach((key) => {
    merged[key] = toBoolean(merged[key], DEFAULT_PREFERENCES[key]);
  });
  merged.minimumSalary = clamp(merged.minimumSalary, 0, 500000);
  merged.preferredSalary = clamp(merged.preferredSalary, merged.minimumSalary, 500000);
  merged.maxDistanceKm = clamp(merged.maxDistanceKm, 0, 500);
  merged.reviewThreshold = clamp(merged.reviewThreshold, 0, 99);
  merged.alertThreshold = clamp(merged.alertThreshold, merged.reviewThreshold, 99);
  merged.dailyApplicationGoal = clamp(merged.dailyApplicationGoal, 0, 20);
  merged.weeklyApplicationGoal = clamp(merged.weeklyApplicationGoal, 0, 100);
  merged.followUpDays = clamp(merged.followUpDays, 1, 30);
  merged.quietHoursStart = clamp(merged.quietHoursStart, 0, 23);
  merged.quietHoursEnd = clamp(merged.quietHoursEnd, 0, 23);
  merged.theme = ["system", "light", "dark"].includes(merged.theme) ? merged.theme : "system";
  return merged;
}

export function normaliseJob(input = {}) {
  const salaryMin = finiteNumber(input.salaryMin ?? input.salary_min, extractSalaryRange(input.salary || input.salaryText)[0]);
  const salaryMax = finiteNumber(input.salaryMax ?? input.salary_max, extractSalaryRange(input.salary || input.salaryText)[1]);
  const postedDate = dateKey(input.postedDate || input.created || input.posted_at || "");
  const discoveredAt = input.discoveredAt || input.firstSeenAt || input.created || "";
  const status = normaliseStatus(input.status || (input.appliedDate ? "applied" : "new"));
  const benefits = toArray(parseMaybeJson(input.benefits, input.benefits)).filter(Boolean);
  const tags = toArray(parseMaybeJson(input.tags, input.avoidTags)).filter(Boolean);

  return {
    ...input,
    id: String(input.id || input.jobId || input.sourceId || slugify(`${input.company || "company"}-${input.title || "role"}-${input.url || discoveredAt || Date.now()}`)),
    title: String(input.title || "Untitled role").trim(),
    company: String(input.company || "Company not listed").trim(),
    location: String(input.location || "Location not listed").trim(),
    description: stripHtml(String(input.description || input.notes || "")).trim(),
    salary: String(input.salary || input.salaryText || salaryLabel(salaryMin, salaryMax) || "Salary not listed").trim(),
    salaryMin,
    salaryMax,
    source: String(input.source || "Added manually").trim(),
    sourceId: String(input.sourceId || input.source_id || ""),
    url: safeUrl(input.url || input.jobUrl || ""),
    postedDate,
    discoveredAt,
    firstSeenAt: input.firstSeenAt || discoveredAt,
    seenAt: input.seenAt || "",
    status,
    workPattern: String(input.workPattern || inferWorkPattern(`${input.location || ""} ${input.description || ""}`)),
    contractType: String(input.contractType || input.contract_type || ""),
    category: String(input.category || ""),
    benefits,
    tags,
    matchReasons: toArray(parseMaybeJson(input.matchReasons, input.match_reasons)).filter(Boolean),
    concerns: toArray(parseMaybeJson(input.concerns)).filter(Boolean),
    checklist: parseMaybeJson(input.checklist, {}) || {},
    notes: String(input.notes || ""),
    appliedDate: dateKey(input.appliedDate || ""),
    deadline: dateKey(input.deadline || ""),
    nextActionAt: input.nextActionAt || "",
    interviewAt: input.interviewAt || "",
    updatedAt: input.updatedAt || "",
    removed: toBoolean(input.removed, false) || status === "skipped",
    removedReason: String(input.removedReason || input.outcomeReason || ""),
    priority: String(input.priority || ""),
    contactName: String(input.contactName || ""),
    contactEmail: String(input.contactEmail || ""),
    actor: String(input.actor || ""),
  };
}

export function isMaxLocationEligible(input = {}) {
  const job = normaliseJob(input);
  const location = String(job.location || "").toLowerCase().replace(/[·|/]/g, " ").replace(/\s+/g, " ").trim();
  const body = String(job.description || "").toLowerCase();
  const explicitCountryRestriction = body.match(/\b(?:must (?:live|reside|be based)|based|work) (?:in|from) (germany|united states|usa|canada|australia|india)\b/);
  if (explicitCountryRestriction && !/\bunited kingdom\b|\buk\b/.test(explicitCountryRestriction[0])) return false;
  if (/\bglasgow\b|\bedinburgh\b|\brenfrewshire\b/.test(location)) return true;

  const isRemote = job.workPattern === "remote" || /\bremote\b|work from home|home-based/.test(location);
  if (!isRemote) return false;

  if (/^(remote|anywhere|worldwide|global)$/.test(location)) return true;
  return /\bunited kingdom\b|\buk\b|\beurope\b|\bemea\b|\bworldwide\b|\banywhere\b|\bglobal\b/.test(location);
}

export function isMaxRoleEligible(input = {}) {
  const title = String(input.title || "").toLowerCase();
  const body = `${title} ${String(input.description || "").toLowerCase()}`;
  if (!isMaxSearchEligible(input)) return false;

  // Exact customer/client delivery families are backed by Max's recent CV evidence.
  if (PRIMARY_ROLE_TITLE.test(title)) {
    return true;
  }

  // Adjacent roles need evidence of client ownership and service delivery, not a
  // coincidental word such as “operations” or “account”.
  const evidenceCount = CLIENT_DELIVERY_EVIDENCE.filter((pattern) => pattern.test(body)).length;
  if (/\baccount manager\b/.test(title) && isSalesLedRole(body)) return false;
  if (/\bsupplier|\bvendor/.test(title) && /\bprocurement\b|\bsupply chain\b|\bcategory management\b/.test(body)) return false;
  if (/\bcustomer (?:support|service)\b|\bteam (?:leader|lead)\b.*\bcustomer (?:support|service|operations)\b/.test(title)) return false;
  return evidenceCount >= 2 && !/\btechnical account manager\b|\bstrategic account manager\b|\bbusiness relationship manager\b/.test(title);
}

export function isMaxSearchEligible(input = {}) {
  const title = String(input.title || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!title || HARD_TITLE_MISMATCH.test(title) || hasHardCvRequirementMismatch(input)) return false;
  if (/\btechnical account manager\b|\bstrategic account manager\b|\bkey account manager\b|\bbusiness relationship manager\b/.test(title)) return false;
  return PRIMARY_ROLE_TITLE.test(title) || ADJACENT_ROLE_TITLE.test(title);
}

function hasHardCvRequirementMismatch(input = {}) {
  const title = String(input.title || "").toLowerCase();
  const body = `${title} ${String(input.description || "").toLowerCase()}`;
  if (/\b(?:arabic|french|spanish|italian|dutch|portuguese|polish|swedish|norwegian|danish) speaking\b/.test(title)) return true;
  if (/\b(?:arabic|french|spanish|italian|dutch|portuguese|polish|swedish|norwegian|danish) (?:language )?(?:skills?|fluency|proficiency)\b.{0,80}\b(?:required|requirement|essential|mandatory)\b/.test(body)) return true;
  if (/\bonboarding\b/.test(title) && /\b(?:anti[- ]money laundering|aml|kyc|fca|cass|fatca|financial crime)\b/.test(body)) return true;
  if (/\bsupplier|\bvendor/.test(title) && /\bprocurement\b|\bsupply chain\b|\bcategory management\b/.test(body)) return true;
  if (/\bcustomer success\b/.test(title) && /\btechnical degree\b/.test(body) && /\b(?:required|requirements?|looking for)\b/.test(body)) return true;
  return false;
}

function isSalesLedRole(body = "") {
  const signals = [
    /\bnew business\b/, /\bprospect(?:ing)?\b/, /\bcold call(?:ing)?\b/, /\bsales quota\b/,
    /\b(?:sales|revenue) target\b/, /\bclose deals?\b/, /\bsales pipeline\b/, /\bcommission\b/,
  ];
  return signals.filter((pattern) => pattern.test(body)).length >= 2;
}

export function maxLocationRank(input = {}) {
  const job = normaliseJob(input);
  const location = `${job.location} ${job.workPattern}`.toLowerCase().replace(/[·|/]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bglasgow\b|\brenfrewshire\b/.test(location)) return 0;
  const remote = /\bremote\b|work from home|home-based/.test(location);
  if (remote && /\bunited kingdom\b|\buk\b/.test(location)) return 1;
  if (/\bedinburgh\b/.test(location)) return 2;
  if (remote) return 3;
  return 4;
}

export function normaliseStatus(value = "new") {
  const clean = String(value).trim().toLowerCase().replaceAll("-", "_").replace(/\s+/g, " ");
  return STATUS_ALIASES[clean] || clean.replaceAll(" ", "_") || "new";
}

export function scoreJob(jobInput, preferenceInput = DEFAULT_PREFERENCES, feedbackJobs = []) {
  const job = normaliseJob(jobInput);
  const preferences = normalisePreferences(preferenceInput);
  const title = job.title.toLowerCase();
  const body = `${job.title} ${job.company} ${job.location} ${job.description} ${job.benefits.join(" ")}`.toLowerCase();
  const reasons = [];
  const concerns = [];
  const breakdown = { role: 0, experience: 0, location: 0, salary: 0, practical: 0, freshness: 0, bonus: 0, penalties: 0 };

  const targetScores = preferences.targetTitles.map((target) => {
    const cleanTarget = target.toLowerCase();
    if (title === cleanTarget) return 30;
    if (title.includes(cleanTarget) || cleanTarget.includes(title)) return 28;
    const overlap = tokenOverlap(title, cleanTarget);
    return Math.round(overlap * 27);
  });
  breakdown.role = Math.max(0, ...targetScores);
  if (breakdown.role >= 23) reasons.push("Close title match");
  else if (breakdown.role >= 14) reasons.push("Related role family");
  else concerns.push("Title is outside the main search");

  const matchedRoleTerms = uniqueList(ROLE_TERMS.filter((term) => body.includes(term)));
  const matchedIncludeTerms = uniqueList(preferences.includeTerms.filter((term) => body.includes(term.toLowerCase())));
  breakdown.experience = Math.min(20, matchedRoleTerms.length * 3 + matchedIncludeTerms.length * 2);
  if (matchedRoleTerms.length) reasons.push(`Uses ${humanList(matchedRoleTerms.slice(0, 2))}`);
  if (/\bgerman\b|\bdach\b/.test(body)) {
    breakdown.bonus += 5;
    reasons.push("German / DACH advantage");
  }

  const locationText = `${job.location} ${job.workPattern}`.toLowerCase();
  const preferredLocation = preferences.preferredLocations.some((place) => job.location.toLowerCase().includes(String(place).toLowerCase()));
  if (locationText.includes("remote") && preferences.workPatterns.includes("remote")) {
    breakdown.location = 20;
    reasons.push("Remote works");
  } else if (preferredLocation) {
    breakdown.location = 20;
    reasons.push("Preferred area");
  } else if (locationText.includes("hybrid") && preferences.workPatterns.includes("hybrid")) {
    breakdown.location = 12;
    concerns.push("Check the office distance");
  } else if ((locationText.includes("onsite") || locationText.includes("on-site")) && preferences.workPatterns.includes("onsite")) {
    breakdown.location = 10;
    concerns.push("Check the commute");
  } else {
    breakdown.location = 5;
    concerns.push("Work pattern or location needs checking");
  }

  const upperSalary = job.salaryMax || job.salaryMin;
  if (!upperSalary) {
    breakdown.salary = 7;
    concerns.push("Salary is not listed");
  } else if (upperSalary >= preferences.preferredSalary) {
    breakdown.salary = 15;
    reasons.push(`Pay reaches ${formatMoney(preferences.preferredSalary)}+`);
  } else if (upperSalary >= preferences.minimumSalary) {
    breakdown.salary = 12;
    reasons.push("Pay is in range");
  } else {
    breakdown.salary = 1;
    breakdown.penalties -= 8;
    concerns.push(`Pay appears below ${formatMoney(preferences.minimumSalary)}`);
  }

  const contractText = `${job.contractType} ${body}`;
  const wantsPermanent = preferences.contractTypes.includes("permanent");
  const wantsContract = preferences.contractTypes.includes("contract");
  const wantsFullTime = preferences.contractTypes.includes("full_time");
  const wantsPartTime = preferences.contractTypes.includes("part_time");
  if (/permanent/.test(contractText) && wantsPermanent) {
    breakdown.practical += 6;
    reasons.push("Preferred contract");
  } else if (/contract|fixed.term|temporary/.test(contractText) && wantsContract) {
    breakdown.practical += 6;
    reasons.push("Preferred contract");
  } else if (!/permanent|contract|fixed.term|temporary/.test(contractText)) {
    breakdown.practical += 3;
  } else {
    concerns.push("Contract type is outside the preference");
  }
  if (/full.time|full time/.test(contractText) && wantsFullTime) breakdown.practical += 4;
  else if (/part.time|part time/.test(contractText) && wantsPartTime) breakdown.practical += 4;
  else if (/part.time|part time/.test(contractText)) concerns.push("Part-time hours");

  const matchedBenefits = preferences.mustHaveBenefits.filter((benefit) => body.includes(String(benefit).toLowerCase()));
  if (matchedBenefits.length) {
    breakdown.bonus += Math.min(3, matchedBenefits.length);
    reasons.push(`Mentions ${matchedBenefits[0]}`);
  }

  const age = daysSince(job.postedDate || job.discoveredAt);
  if (age === null) breakdown.freshness = 2;
  else if (age <= 2) {
    breakdown.freshness = 5;
    reasons.push(age === 0 ? "Posted today" : "Just posted");
  } else if (age <= 7) breakdown.freshness = 4;
  else if (age <= 14) breakdown.freshness = 2;
  else {
    concerns.push("Older advert");
    breakdown.freshness = 0;
  }

  const exclusions = preferences.excludeTerms.filter((term) => body.includes(term.toLowerCase()));
  if (exclusions.length) {
    breakdown.penalties -= Math.min(45, exclusions.length * 24);
    concerns.push(`Contains ${humanList(exclusions.slice(0, 2))}`);
  }

  const feedbackPenalty = learnedPenalty(job, feedbackJobs, preferences);
  if (feedbackPenalty > 0) {
    breakdown.penalties -= feedbackPenalty;
    concerns.push("Similar to a role previously skipped");
  }

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const score = Math.max(0, Math.min(99, Math.round(total)));
  return {
    score,
    band: fitBand(score),
    reasons: uniqueList(reasons).slice(0, 4),
    concerns: uniqueList(concerns).slice(0, 4),
    breakdown,
  };
}

export function fitBand(score) {
  if (score >= 82) return "excellent";
  if (score >= 68) return "strong";
  if (score >= 52) return "possible";
  return "low";
}

export function bandLabel(band) {
  return ({ excellent: "Top match", strong: "Strong match", possible: "Worth checking", low: "Low match" })[band] || "Match";
}

export function decorateJobs(items, preferences, feedbackJobs = items) {
  return toArray(items).map(normaliseJob).map((job) => ({ ...job, fit: scoreJob(job, preferences, feedbackJobs) }));
}

export function sortJobs(items, mode = "recommended") {
  return [...items].sort((a, b) => {
    if (mode === "location") return maxLocationRank(a) - maxLocationRank(b) || (b.fit?.score || 0) - (a.fit?.score || 0) || compareDates(b.postedDate || b.discoveredAt, a.postedDate || a.discoveredAt);
    if (mode === "newest") return compareDates(b.postedDate || b.discoveredAt, a.postedDate || a.discoveredAt) || (b.fit?.score || 0) - (a.fit?.score || 0);
    if (mode === "salary") return (b.salaryMax || b.salaryMin || 0) - (a.salaryMax || a.salaryMin || 0) || (b.fit?.score || 0) - (a.fit?.score || 0);
    if (mode === "deadline") return compareDates(a.deadline || "9999-12-31", b.deadline || "9999-12-31");
    return (b.fit?.score || 0) - (a.fit?.score || 0) || compareDates(b.postedDate || b.discoveredAt, a.postedDate || a.discoveredAt);
  });
}

export function nextActionFor(jobInput, preferences = DEFAULT_PREFERENCES) {
  const job = normaliseJob(jobInput);
  const fit = jobInput.fit || scoreJob(job, preferences);
  const today = localDateKey(new Date());
  if (job.status === "interview") {
    return { kind: "interview", label: "Prepare for interview", detail: job.interviewAt ? `Interview ${formatRelativeDate(job.interviewAt)}` : "Add the interview time and prepare three proof stories.", priority: 100 };
  }
  if (job.status === "offer") return { kind: "offer", label: "Review the offer", detail: "Compare pay, flexibility, progression, and the people you met.", priority: 98 };
  if (["applied", "follow_up"].includes(job.status)) {
    const due = job.nextActionAt ? dateKey(job.nextActionAt) : addDaysKey(job.appliedDate, preferences.followUpDays);
    if (due && due <= today) return { kind: "follow_up", label: "Follow up today", detail: `Applied ${formatDate(job.appliedDate)}. A short, polite follow-up is ready.`, priority: 94 };
    return { kind: "waiting", label: "Waiting", detail: due ? `Follow up ${formatRelativeDate(due)}.` : "Add an application date to schedule the follow-up.", priority: 30 };
  }
  if (job.deadline && job.deadline <= addDaysKey(today, 2)) return { kind: "deadline", label: "Deadline soon", detail: `Apply by ${formatDate(job.deadline)}.`, priority: 92 };
  if (job.status === "applying") return { kind: "applying", label: "Finish this application", detail: "Use the checklist, tailor the truthful evidence, then submit.", priority: 88 };
  const age = daysSince(job.postedDate || job.discoveredAt);
  if (fit.score >= 82 && age !== null && age <= 3) return { kind: "fresh_match", label: "Review this first", detail: `${fit.score}% match and recently posted. Check the advert before spending time tailoring.`, priority: 86 };
  if (job.status === "saved") return { kind: "saved", label: "Decide or archive", detail: "Confirm salary, location, and must-haves; then apply or clear it out.", priority: 65 };
  return { kind: "review", label: fit.score >= 68 ? "Worth a look" : "Quick screen", detail: fit.concerns[0] || "Check the advert and make a fast yes/no decision.", priority: fit.score };
}

export function deriveStats(items, now = new Date(), preferences = DEFAULT_PREFERENCES) {
  const jobs = toArray(items).map(normaliseJob);
  const statusCounts = jobs.reduce((counts, job) => {
    counts[job.status] = (counts[job.status] || 0) + 1;
    return counts;
  }, {});
  const applications = jobs.filter((job) => APPLICATION_STATUSES.has(job.status) || job.appliedDate);
  const interviews = jobs.filter((job) => job.status === "interview" || job.interviewAt || /\binterview\b|assessment/i.test(`${job.notes} ${job.removedReason}`));
  const offers = jobs.filter((job) => ["offer", "hired"].includes(job.status));
  const active = jobs.filter((job) => ["applying", "applied", "follow_up", "interview", "offer"].includes(job.status));
  const newMatches = jobs.filter((job) => job.status === "new" && !job.seenAt);
  const followUps = jobs.filter((job) => nextActionFor(job, preferences).kind === "follow_up");
  const weekStart = startOfWeek(now);
  const weeklyApplied = applications.filter((job) => {
    const value = parseDate(job.appliedDate);
    return value && value >= weekStart && value <= now;
  }).length;
  const today = localDateKey(now);
  const appliedToday = applications.filter((job) => job.appliedDate === today).length;

  return {
    totalJobs: jobs.length,
    applications: applications.length,
    interviews: interviews.length,
    offers: offers.length,
    active: active.length,
    newMatches: newMatches.length,
    followUps: followUps.length,
    weeklyApplied,
    appliedToday,
    weeklyGoal: preferences.weeklyApplicationGoal,
    dailyGoal: preferences.dailyApplicationGoal,
    interviewRate: applications.length ? Math.round((interviews.length / applications.length) * 100) : 0,
    statusCounts,
  };
}

export function groupPipeline(items) {
  const groups = Object.fromEntries(PIPELINE.map((stage) => [stage.id, []]));
  groups.closed = [];
  toArray(items).map(normaliseJob).forEach((job) => {
    const key = groups[job.status] ? job.status : ["withdrawn", "closed", "skipped"].includes(job.status) ? "rejected" : "new";
    groups[key].push(job);
  });
  return groups;
}

export function buildTailoring(jobInput, profile = {}) {
  const job = normaliseJob(jobInput);
  const sourceText = `${job.title} ${job.description}`.toLowerCase();
  const skills = uniqueList(toArray(profile.skills));
  const evidenceTerms = uniqueList([
    ...ROLE_TERMS.filter((term) => sourceText.includes(term)),
    ...skills.filter((skill) => sourceText.includes(String(skill).toLowerCase())),
  ]).slice(0, 10);
  const headline = chooseHeadline(String(job.title || "").toLowerCase(), "") || chooseHeadline(sourceText, profile.headline || "Client Operations & Service Delivery");
  const proof = evidenceTerms.length ? humanList(evidenceTerms.slice(0, 4).map(titleCase)) : "client-facing service delivery, stakeholder communication, issue resolution, and process improvement";
  const summary = `${headline} professional with experience across ${proof}. Based in ${profile.location || "Glasgow"} and experienced in keeping client needs, operational detail, and cross-functional follow-through visible across remote and international teams.`;
  return { headline, summary, keywords: evidenceTerms, sourceHeadline: profile.headline || "Client Operations & Service Delivery" };
}

export function buildMessage(kind, jobInput, profile = {}) {
  const job = normaliseJob(jobInput);
  const firstName = String(profile.name || "Max").split(/\s+/)[0];
  const tailoring = buildTailoring(job, profile);
  if (kind === "followup") {
    return `Hi [Name],\n\nI applied for the ${job.title} role at ${job.company} and wanted to briefly follow up. My recent experience is closely aligned with ${humanList(tailoring.keywords.slice(0, 3).map(titleCase)) || "client-facing service delivery and operational coordination"}. I would be very happy to share any additional context that would be useful.\n\nBest,\n${firstName}`;
  }
  if (kind === "thankyou") {
    return `Hi [Name],\n\nThank you for the conversation about the ${job.title} role. I especially enjoyed discussing [specific topic]. It reinforced how relevant my experience in ${humanList(tailoring.keywords.slice(0, 3).map(titleCase)) || "client operations and service delivery"} could be to the team.\n\nBest,\n${firstName}`;
  }
  return `Hi [Name],\n\nI saw the ${job.title} role at ${job.company}. It looks closely aligned with my experience in ${humanList(tailoring.keywords.slice(0, 3).map(titleCase)) || "client operations, stakeholder communication, and service delivery"}. I am based in ${profile.location || "Glasgow"} and would be glad to share more context if helpful.\n\nBest,\n${firstName}`;
}

export function applicationChecklist(jobInput) {
  const job = normaliseJob(jobInput);
  const saved = job.checklist || {};
  return [
    { id: "advert", label: "Read the whole advert", detail: "Confirm the outcomes, must-haves, location, and salary.", done: toBoolean(saved.advert, false) },
    { id: "evidence", label: "Choose three proof points", detail: "Use only examples Max has genuinely done.", done: toBoolean(saved.evidence, false) },
    { id: "cv", label: "Tailor the CV emphasis", detail: "Mirror the role language without changing facts, dates, or titles.", done: toBoolean(saved.cv, false) },
    { id: "questions", label: "Record any concerns", detail: "Pay, travel, targets, contract, or progression questions.", done: toBoolean(saved.questions, false) },
    { id: "submitted", label: "Submit and save the date", detail: "The garden will schedule a follow-up automatically.", done: Boolean(job.appliedDate) || toBoolean(saved.submitted, false) },
  ];
}

export function formatDate(value, options = {}) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(options.year === false ? {} : { year: "numeric" }) }).format(date);
}

export function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatRelativeDate(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return "";
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return `in ${diff} days`;
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`;
  return formatDate(value);
}

export function timeAgo(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return "Never";
  const seconds = Math.max(0, Math.round((now - date) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(value);
}

export function formatMoney(value) {
  const amount = finiteNumber(value, 0);
  if (!amount) return "";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(amount);
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysKey(value, days) {
  const date = parseDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return localDateKey(date);
}

export function daysSince(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return null;
  const cleanDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const cleanNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((cleanNow - cleanDate) / 86400000));
}

export function isJobFresh(input = {}, maxDays = 7, now = new Date()) {
  const age = daysSince(input.postedDate || input.discoveredAt, now);
  return age !== null && age <= Math.max(0, Number(maxDays) || 0);
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value);
  const string = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(string)) {
    const [year, month, day] = string.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(string);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKey(value) {
  const date = parseDate(value);
  return date ? localDateKey(date) : "";
}

export function titleCase(value) {
  const acronyms = new Set(["b2b", "crm", "dach", "emea", "itil", "kpi", "saas", "uk"]);
  return String(value || "").replace(/\w\S*/g, (word) => {
    const clean = word.toLowerCase();
    if (acronyms.has(clean)) return clean.toUpperCase();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  });
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function uniqueList(items) {
  return [...new Set(toArray(items).filter(Boolean))];
}

export function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return fallback ?? trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return fallback;
  }
}

function chooseHeadline(text, fallback) {
  if (/implementation|onboarding/.test(text)) return "Client Implementation & Service Delivery";
  if (/supplier|vendor|workforce/.test(text)) return "Supplier, Workforce & Client Operations";
  if (/customer success|client success/.test(text)) return "Customer Success & Client Operations";
  if (/account manager|account management|relationship/.test(text)) return "Client Relationship & Account Management";
  if (/service delivery|service manager/.test(text)) return "Service Delivery & Client Operations";
  if (/operations excellence|process improvement|client operations/.test(text)) return "Client Operations & Process Improvement";
  return fallback;
}

function learnedPenalty(job, feedbackJobs, preferences) {
  const body = `${job.title} ${job.location} ${job.description}`.toLowerCase();
  const feedback = toArray(feedbackJobs)
    .map(normaliseJob)
    .filter((item) => item.removed || item.status === "skipped")
    .flatMap((item) => [...item.tags, item.removedReason])
    .join(" ")
    .toLowerCase();
  if (!feedback) return 0;
  let penalty = 0;
  const salary = job.salaryMax || job.salaryMin;
  if (/salary too low|low salary|pay too low/.test(feedback) && salary && salary < preferences.minimumSalary) penalty += 6;
  if (/wrong location|travel|commute|onsite/.test(feedback)) {
    const preferred = preferences.preferredLocations.some((place) => body.includes(String(place).toLowerCase()));
    if ((!preferred && !body.includes("remote")) || /onsite|on-site|office.based/.test(body)) penalty += 6;
  }
  if (/sales.led|too sales|commission|sales target/.test(feedback) && /sales|business development|new business|revenue|quota|commission/.test(body)) penalty += 6;
  if (/too senior|director|head of/.test(feedback) && /director|head of|vice president|\bvp\b|chief|principal/.test(body)) penalty += 6;
  if (/contract|temporary|fixed.term/.test(feedback) && /contract|temporary|fixed.term/.test(body)) penalty += 6;
  if (/work.life|shift|weekend|on.call|rota/.test(feedback) && /shift|weekend|evening|on.call|rota|frequent travel/.test(body)) penalty += 6;
  return Math.min(18, penalty);
}

function tokenOverlap(a, b) {
  const left = new Set(tokenise(a));
  const right = new Set(tokenise(b));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function tokenise(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function extractSalaryRange(value) {
  const numbers = [...String(value || "").toLowerCase().matchAll(/(?:£|gbp\s*)?(\d{2,3})(?:[,.](\d{3}))?\s*(k)?/g)]
    .map((match) => {
      let amount = Number(match[1]);
      if (match[2]) amount = Number(`${match[1]}${match[2]}`);
      else if (match[3] || amount < 1000) amount *= 1000;
      return amount;
    })
    .filter((amount) => amount >= 10000 && amount <= 500000);
  return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : [0, 0];
}

function salaryLabel(min, max) {
  if (!min && !max) return "";
  if (min && max && min !== max) return `${formatMoney(min)}–${formatMoney(max)}`;
  return formatMoney(max || min);
}

function inferWorkPattern(value) {
  const text = String(value || "").toLowerCase();
  if (/remote|work from home|home.based/.test(text)) return "remote";
  if (/hybrid/.test(text)) return "hybrid";
  if (/onsite|on-site|office.based/.test(text)) return "onsite";
  return "unknown";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

function humanList(items) {
  const list = toArray(items).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list.at(-1)}`;
}

function compareDates(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") return value.split(/\s*[,\n]\s*/).filter(Boolean);
  return [value];
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    if (["true", "yes", "1", "on"].includes(value.toLowerCase())) return true;
    if (["false", "no", "0", "off"].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function startOfWeek(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}
