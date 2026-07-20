import { buildTailoring, slugify, uniqueList } from "./core.js";

const TEMPLATE_PREFIX = "__cv_template_";
const ORIGINAL_SKILLS = [
  "Client & Stakeholder Management",
  "Service Delivery",
  "Account Coordination",
  "Operational Problem Solving",
  "Escalation & Issue Resolution",
  "Cross-functional Collaboration",
  "Process Improvement",
  "KPI & Performance Monitoring",
  "B2B Client Communication",
  "Workforce Planning Support",
];

export function extractPrivateCvTemplate(jobs = []) {
  return jobs
    .filter((job) => String(job?.id || "").startsWith(TEMPLATE_PREFIX))
    .sort((a, b) => Number(String(a.id).slice(TEMPLATE_PREFIX.length)) - Number(String(b.id).slice(TEMPLATE_PREFIX.length)))
    .map((job) => `${job.description || ""}${job.notes || ""}`)
    .join("");
}

export function withoutPrivateCvTemplate(jobs = []) {
  return jobs.filter((job) => !String(job?.id || "").startsWith(TEMPLATE_PREFIX));
}

export function buildExactCvTailoring(job, profile = {}) {
  const skills = rankExistingSkills(job, profile.skills || ORIGINAL_SKILLS);
  const paragraphs = tailoredProfileParagraphs(skills);
  return {
    headline: profile.headline || "Client Operations & Service Delivery",
    summary: paragraphs.join("\n\n"),
    paragraphs,
    skills,
    keywords: skills.slice(0, 5),
  };
}

export async function downloadTailoredCv(job, profile, template) {
  if (!template) throw new Error("Max’s exact master CV is not available on this device yet.");
  const bytes = await createTailoredPdfBytes(job, profile, template);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slugify(profile?.name || "max-schacher")}-cv-${slugify(job.company)}-${slugify(job.title)}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function createTailoredPdfBytes(job, profile, template) {
  const lib = globalThis.window?.PDFLib || globalThis.PDFLib;
  if (!lib?.PDFDocument) throw new Error("The exact-format PDF engine is unavailable.");

  const source = typeof template === "string" ? base64ToBytes(template) : template;
  const pdf = await lib.PDFDocument.load(source, { updateMetadata: false });
  const page = pdf.getPages()[0];
  if (!page) throw new Error("Max’s master CV has no first page.");

  const regular = existingFont(page, pdf, "F5", lib);
  const roleTailoring = buildTailoring(job, profile);
  const tailoring = buildExactCvTailoring(job, profile);
  const skills = tailoring.skills;
  const paragraphs = tailoring.paragraphs;
  const pageHeight = page.getHeight();

  // These are the only two editable areas in Max's master CV. The original
  // headline, employment history, dates, qualifications and tools remain.
  removeOriginalMatchedText(page, pdf, new Set([9, 11, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]), lib);
  page.drawRectangle({ x: 20.5, y: pageHeight - 264, width: 560, height: 117, color: lib.rgb(1, 1, 1) });
  page.drawRectangle({ x: 419, y: pageHeight - 407, width: 158, height: 119, color: lib.rgb(1, 1, 1) });

  const summaryWidth = 555;
  const firstLines = fitLines(paragraphs[0], regular, 10, summaryWidth, 2);
  const secondLines = fitLines(paragraphs[1], regular, 10, summaryWidth, 3);
  const summaryLines = [...firstLines, "", ...secondLines];
  let summaryY = pageHeight - 159.4008;
  summaryLines.forEach((line, index) => {
    if (line) {
      const paragraphEnd = index === firstLines.length - 1 || index === summaryLines.length - 1;
      drawLine(page, regular, line, 22.5, summaryY, 10, lib, paragraphEnd ? 0 : justifiedSpacing(line, regular, 10, summaryWidth));
    }
    summaryY -= 13.2239;
  });

  let skillY = pageHeight - 300.041;
  skills.slice(0, 10).forEach((skill) => {
    drawLine(page, regular, `· ${cleanPdfText(skill)}`, 420.75, skillY, 9, lib);
    skillY -= 10.3491;
  });

  pdf.setTitle(`CV - Max Schacher - ${tailoring.headline}`);
  pdf.setSubject(`Role-matched emphasis for ${job.title} at ${job.company}; employment history unchanged.`);
  pdf.setCreator("Max’s Job Garden");
  pdf.setProducer("Max’s Job Garden exact-template PDF workflow");
  pdf.setKeywords(uniqueList([job.title, job.company, ...roleTailoring.keywords]).map(cleanPdfText));
  return pdf.save({ useObjectStreams: false, addDefaultPage: false });
}

function removeOriginalMatchedText(page, pdf, mcids, lib) {
  const contents = page.node.Contents();
  if (!(contents instanceof lib.PDFRawStream)) throw new Error("Max’s master CV structure has changed; no safe edit was made.");
  const decoded = lib.decodePDFRawStream(contents).decode();
  const source = new TextDecoder("latin1").decode(decoded);
  const lines = source.split("\n");
  let removingDepth = 0;
  const cleaned = [];

  lines.forEach((line) => {
    const starts = /\bBDC\b/.test(line);
    const ends = /\bEMC\b/.test(line);
    const match = line.match(/\/MCID\s+(\d+)/);
    if (!removingDepth && starts && match && mcids.has(Number(match[1]))) {
      cleaned.push(line); // Keep the tagged-document anchor, but empty it.
      removingDepth = 1;
      return;
    }
    if (removingDepth) {
      if (starts) removingDepth += 1;
      if (ends) {
        removingDepth -= 1;
        if (!removingDepth) cleaned.push(line);
      }
      return;
    }
    cleaned.push(line);
  });

  if (removingDepth) throw new Error("Max’s master CV structure could not be edited safely.");
  const stream = pdf.context.flateStream(cleaned.join("\n"));
  page.node.set(lib.PDFName.of("Contents"), pdf.context.register(stream));
}

function existingFont(page, pdf, name, lib) {
  const resources = page.node.Resources();
  const fonts = resources.lookup(lib.PDFName.of("Font"), lib.PDFDict);
  const font = fonts.lookup(lib.PDFName.of(name), lib.PDFDict);
  const cmap = font.lookup(lib.PDFName.of("ToUnicode"), lib.PDFRawStream);
  const decoded = lib.decodePDFRawStream(cmap).decode();
  const text = new TextDecoder("latin1").decode(decoded);
  const unicodeToCid = invertCMap(text);
  const descendant = font.lookup(lib.PDFName.of("DescendantFonts"), lib.PDFArray).lookup(0, lib.PDFDict);
  const widths = readWidths(descendant, lib);
  return { name, unicodeToCid, widths, defaultWidth: numberValue(descendant.get(lib.PDFName.of("DW"))) || 1000, pdf };
}

function invertCMap(cmap) {
  const map = new Map();
  const lines = cmap.split(/\r?\n/).map((line) => line.trim());
  lines.forEach((line) => {
    const one = line.match(/^<([0-9A-F]+)>\s+<([0-9A-F]+)>$/i);
    if (one) map.set(String.fromCodePoint(parseInt(one[2], 16)), parseInt(one[1], 16));
    const range = line.match(/^<([0-9A-F]+)>\s+<([0-9A-F]+)>\s+<([0-9A-F]+)>$/i);
    if (!range) return;
    const start = parseInt(range[1], 16);
    const end = parseInt(range[2], 16);
    const unicode = parseInt(range[3], 16);
    for (let cid = start; cid <= end; cid += 1) map.set(String.fromCodePoint(unicode + cid - start), cid);
  });
  return map;
}

function readWidths(descendant, lib) {
  const result = new Map();
  const widths = descendant.lookupMaybe(lib.PDFName.of("W"), lib.PDFArray);
  if (!widths) return result;
  const values = widths.asArray();
  for (let index = 0; index < values.length;) {
    const start = numberValue(values[index]);
    const next = values[index + 1];
    if (next instanceof lib.PDFArray) {
      next.asArray().forEach((width, offset) => result.set(start + offset, numberValue(width)));
      index += 2;
    } else {
      const end = numberValue(next);
      const width = numberValue(values[index + 2]);
      for (let cid = start; cid <= end; cid += 1) result.set(cid, width);
      index += 3;
    }
  }
  return result;
}

function numberValue(value) {
  return typeof value?.asNumber === "function" ? value.asNumber() : Number(value || 0);
}

function encodeText(text, font) {
  return [...cleanPdfText(text)].map((character) => {
    const cid = font.unicodeToCid.get(character) ?? font.unicodeToCid.get(" ");
    return Number(cid || 0).toString(16).padStart(4, "0");
  }).join("");
}

function textWidth(text, font, size) {
  const units = [...cleanPdfText(text)].reduce((total, character) => {
    const cid = font.unicodeToCid.get(character) ?? font.unicodeToCid.get(" ");
    return total + (font.widths.get(cid) || font.defaultWidth);
  }, 0);
  return units * size / 1000;
}

function drawLine(page, font, text, x, y, size, lib, wordSpacing = 0) {
  const operators = [
    lib.beginText(),
    lib.setFontAndSize(lib.PDFName.of(font.name), size),
  ];
  if (wordSpacing) operators.push(lib.setWordSpacing(wordSpacing));
  operators.push(
    lib.setTextMatrix(1, 0, 0, 1, x, y),
    lib.showText(lib.PDFHexString.of(encodeText(text, font))),
    lib.endText(),
  );
  page.pushOperators(...operators);
}

function fitLines(text, font, size, maxWidth, maxLines) {
  const words = cleanPdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || textWidth(candidate, font, size) <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  });
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  // Preserve the wording but allow a very small size-independent tightening by
  // dropping the final context phrase before ever changing the CV's font size.
  const shortened = text.replace(/ across remote and international teams\.?$/i, ".");
  if (shortened !== text) return fitLines(shortened, font, size, maxWidth, maxLines);
  throw new Error("The matched wording does not fit Max’s original CV layout safely.");
}

function justifiedSpacing(line, font, size, maxWidth) {
  const spaces = (line.match(/ /g) || []).length;
  if (!spaces) return 0;
  const extra = (maxWidth - textWidth(line, font, size)) / spaces;
  return extra > 0 && extra < 8 ? extra : 0;
}

function tailoredProfileParagraphs(skills) {
  const selected = skills.slice(0, 5);
  const first = `Client-facing professional with experience across ${lowerList(selected.slice(0, 4))} within fast-paced B2B environments.`;
  const second = `Experienced in supporting enterprise clients, coordinating operational processes, and managing stakeholder communication. Strong background in ${lowerList(uniqueList([selected[0], selected[1], "Cross-functional Collaboration"]).slice(0, 3))} across remote and international teams.`;
  return [first, second];
}

function rankExistingSkills(job, profileSkills) {
  const source = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const skills = uniqueList([...profileSkills, ...ORIGINAL_SKILLS]).filter((skill) => ORIGINAL_SKILLS.includes(skill));
  const hints = {
    "Client & Stakeholder Management": ["client", "stakeholder", "relationship", "customer success", "account"],
    "Service Delivery": ["service delivery", "service manager", "customer success", "client services"],
    "Account Coordination": ["account", "coordination", "onboarding", "implementation"],
    "Operational Problem Solving": ["operations", "problem", "issue", "delivery"],
    "Escalation & Issue Resolution": ["escalation", "issue", "resolution", "support"],
    "Cross-functional Collaboration": ["cross-functional", "collaboration", "internal teams", "stakeholder"],
    "Process Improvement": ["process", "improvement", "efficiency", "optimisation", "excellence"],
    "KPI & Performance Monitoring": ["kpi", "performance", "metrics", "reporting", "target"],
    "B2B Client Communication": ["b2b", "communication", "client", "dach", "german"],
    "Workforce Planning Support": ["workforce", "staffing", "recruitment", "planning", "supplier"],
  };
  return skills
    .map((skill, index) => ({ skill, index, score: (hints[skill] || []).reduce((score, hint) => score + (source.includes(hint) ? (hint.includes(" ") ? 3 : 1) : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.skill);
}

function lowerList(items) {
  const clean = items.filter(Boolean).map((item) => String(item).toLowerCase().replace(/\b(b2b|kpi|crm|dach)\b/g, (term) => term.toUpperCase()));
  if (clean.length < 2) return clean[0] || "client operations and service delivery";
  return `${clean.slice(0, -1).join(", ")}, and ${clean.at(-1)}`;
}

function cleanPdfText(value) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E·®]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base64ToBytes(value) {
  const binary = atob(String(value || "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
