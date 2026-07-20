import { buildTailoring, slugify, titleCase, uniqueList } from "./core.js";

export function downloadTailoredCv(job, profile) {
  if (!window.jspdf?.jsPDF) throw new Error("The PDF library is unavailable.");
  if (!profile?.name || !Array.isArray(profile.roles) || !profile.roles.length) {
    throw new Error("Add Max’s CV profile before creating a PDF.");
  }
  const tailoring = buildTailoring(job, profile);
  const doc = createTailoredPdf(profile, tailoring);
  doc.save(`${slugify(profile.name) || "max"}-cv-${slugify(job.company)}-${slugify(job.title)}.pdf`);
}

export function createTailoredPdf(profile, tailoring) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const page = { width: 595.28, height: 841.89, margin: 36 };
  const palette = {
    ink: [24, 40, 33],
    muted: [93, 105, 99],
    green: [45, 112, 78],
    greenSoft: [232, 242, 234],
    line: [220, 226, 219],
  };
  const leftX = page.margin;
  const rightX = 424;
  const rightW = 136;
  const dateW = 94;
  const contentX = leftX + dateW + 18;
  const firstPageContentW = 254;
  const fullContentW = page.width - contentX - page.margin;
  let pageNo = 1;
  let y = 72;
  const prioritySkills = uniqueList([...(tailoring.keywords || []), ...(profile.skills || [])]).slice(0, 11);

  function setText(size, style = "normal", color = palette.ink) {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }

  function sectionBar(text, x, width, yy) {
    doc.setFillColor(...palette.greenSoft);
    doc.roundedRect(x, yy, width, 19, 3, 3, "F");
    setText(9.8, "bold", palette.green);
    doc.text(String(text).toUpperCase(), x + 7, yy + 13.5);
  }

  function writeWrapped(text, x, width, yy, size = 9.4, style = "normal", color = palette.ink, gap = 12.4) {
    setText(size, style, color);
    const parts = doc.splitTextToSize(String(text || ""), width);
    doc.text(parts, x, yy);
    return yy + parts.length * gap;
  }

  function ensureSpace(needed) {
    if (y + needed < page.height - 48) return;
    doc.addPage();
    pageNo += 1;
    y = 52;
  }

  function bullet(text, x, width, yy) {
    setText(9.1, "normal", palette.green);
    doc.text("•", x, yy);
    return writeWrapped(text, x + 12, width - 12, yy, 9.1, "normal", palette.ink, 12.2) + 2;
  }

  function drawHeader() {
    setText(21, "bold");
    doc.text(String(profile.name).toUpperCase(), leftX, 56);
    setText(12.4, "bold", palette.green);
    doc.text(tailoring.headline, leftX, 76);
    setText(9.5, "normal", palette.muted);
    doc.text(profile.location || "Glasgow, UK", leftX, 94);

    const contactX = page.width - page.margin;
    const contactLines = [profile.email, profile.phone].filter(Boolean);
    contactLines.forEach((line, index) => {
      setText(9.3, "normal", palette.ink);
      doc.text(String(line), contactX, 56 + index * 16, { align: "right" });
    });
    if (profile.linkedinUrl) {
      const label = profile.linkedin || "LinkedIn";
      setText(9.3, "normal", [47, 101, 161]);
      const linkY = 56 + contactLines.length * 16;
      doc.text(label, contactX, linkY, { align: "right" });
      const width = doc.getTextWidth(label);
      doc.link(contactX - width, linkY - 10, width, 13, { url: profile.linkedinUrl });
    }

    doc.setDrawColor(...palette.line);
    doc.line(leftX, 108, page.width - page.margin, 108);
    writeWrapped(tailoring.summary, leftX, 524, 132, 10, "normal", palette.ink, 14);
    y = 198;
  }

  function drawSidebar() {
    let sy = 198;
    const groups = [
      ["Key skills", prioritySkills.map(titleCase)],
      ["Tools", (profile.tools || []).slice(0, 10)],
      ["Certifications", profile.certifications || []],
      ["Languages", profile.languages || []],
    ].filter(([, items]) => items.length);

    groups.forEach(([label, items]) => {
      sectionBar(label, rightX, rightW, sy);
      sy += 31;
      items.forEach((item) => {
        sy = writeWrapped(`• ${item}`, rightX + 5, rightW - 10, sy, 8.25, "normal", palette.ink, 10.2);
      });
      sy += 11;
    });
  }

  drawHeader();
  drawSidebar();

  sectionBar("Experience", leftX, 366, y);
  y += 39;
  (profile.roles || []).forEach((role) => {
    const bullets = Array.isArray(role.bullets) ? role.bullets : [];
    const estimatedHeight = 54 + Math.min(bullets.length, 5) * 25;
    ensureSpace(Math.min(estimatedHeight, 132));
    const contentW = pageNo === 1 ? firstPageContentW : fullContentW;
    setText(9.1, "normal", palette.muted);
    doc.text(String(role.dates || ""), leftX, y);
    setText(10.2, "bold");
    doc.text(String(role.title || ""), contentX, y);
    y += 14;
    setText(9.35, "bold", palette.green);
    doc.text(String(role.company || ""), contentX, y);
    y += 12;
    if (role.location) {
      setText(8.4, "normal", palette.muted);
      doc.text(String(role.location), contentX, y);
      y += 17;
    }
    bullets.forEach((item) => {
      ensureSpace(30);
      y = bullet(item, contentX + 4, contentW - 4, y);
    });
    y += 8;
  });

  if (profile.education) {
    ensureSpace(82);
    sectionBar("Education", leftX, page.width - page.margin * 2, y);
    y += 34;
    y = writeWrapped(profile.education, leftX, page.width - page.margin * 2, y, 9.2);
  }

  for (let index = 1; index <= pageNo; index += 1) {
    doc.setPage(index);
    doc.setDrawColor(...palette.line);
    doc.line(leftX, page.height - 34, page.width - page.margin, page.height - 34);
    setText(7.4, "normal", palette.muted);
    doc.text(`Tailored emphasis for ${tailoring.headline} · facts and employment history unchanged`, leftX, page.height - 20);
    doc.text(String(index), page.width - page.margin, page.height - 20, { align: "right" });
  }

  return doc;
}
