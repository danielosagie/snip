/**
 * Contract template engine. Pure functions — no React, no Convex —
 * because the same code runs both client-side (wizard preview) and
 * server-side (clause generation on submit).
 *
 * Each project type defines:
 *   - typeSpecificQuestions: extra wizard prompts for that type
 *   - typeSpecificClauses: clauses unique to that type (e.g. raw footage
 *     ownership for video, CMS handoff for web)
 *
 * On top of that there's a SHARED clause set every contract gets
 * (scope, payment, IP transfer, kill fee, etc.) — those are the ones
 * marked `required` and protected from deletion by the mutation layer.
 */

export type ProjectType =
  | "logo_design"
  | "video_production"
  | "web_design"
  | "photography"
  | "brand_identity"
  | "copywriting"
  | "music"
  | "animation"
  | "custom";

export type AnswerValue = string | number | boolean | null;
export type WizardAnswers = Record<string, AnswerValue>;

export type WizardQuestion =
  | {
      id: string;
      prompt: string;
      help?: string;
      kind: "text" | "textarea" | "number" | "date" | "email";
      placeholder?: string;
      required?: boolean;
      /**
       * Optional chip-style suggestions rendered above the input.
       * Clicking a chip drops it into the field. Useful when most
       * users want one of a handful of common answers but we don't
       * want to force them into a hard `select`.
       */
      quickOptions?: { value: string; label: string }[];
    }
  | {
      id: string;
      prompt: string;
      help?: string;
      kind: "select";
      options: { value: string; label: string }[];
      required?: boolean;
    }
  | {
      id: string;
      prompt: string;
      help?: string;
      /**
       * Chip-style multi-select with a free-form add field. Output
       * is the picked values joined by "; ". Use for things like
       * deliverable formats where there's a finite quick-pick list
       * but the user might also want to add custom entries.
       */
      kind: "multiselect";
      options: { value: string; label: string }[];
      placeholder?: string;
      required?: boolean;
    }
  | {
      id: string;
      prompt: string;
      help?: string;
      kind: "boolean";
      required?: boolean;
    };

export interface ClauseDraft {
  id: string;
  sectionKey: string;
  title: string;
  bodyHtml: string;
  required: boolean;
  order: number;
  sourceAnswerId?: string;
}

export interface ProjectTypeTemplate {
  type: ProjectType;
  label: string;
  description: string;
  emoji: string;
  typeSpecificQuestions: WizardQuestion[];
  generateTypeClauses: (answers: WizardAnswers) => ClauseDraft[];
}

// ─── Universal wizard questions (every project type asks these) ───────────

export const UNIVERSAL_QUESTIONS: WizardQuestion[] = [
  {
    id: "clientName",
    prompt: "Client name",
    help: "Person or company you're contracting with.",
    kind: "text",
    placeholder: "Acme Co.",
    required: true,
  },
  {
    id: "clientEmail",
    prompt: "Client email",
    kind: "email",
    placeholder: "contact@acme.com",
    required: true,
  },
  {
    id: "approverName",
    prompt: "Who on the client side has authority to approve final delivery?",
    help: "This person's signature on 'Approve Final' triggers payment release.",
    kind: "text",
    placeholder: "Jane Doe, CMO",
    required: true,
  },
  {
    id: "approverEmail",
    prompt: "Approver email",
    kind: "email",
    placeholder: "jane@acme.com",
    required: true,
  },
  {
    id: "projectName",
    prompt: "Project name",
    kind: "text",
    placeholder: "Q4 brand launch",
    required: true,
  },
  {
    id: "deadline",
    prompt: "Final delivery deadline",
    kind: "date",
    required: true,
  },
  {
    id: "priceDollars",
    prompt: "Total project price (USD)",
    kind: "number",
    placeholder: "5000",
    required: true,
  },
  {
    id: "depositPercent",
    prompt: "Deposit % held in escrow at signing",
    help: "Standard is 50%. Set to 100% if you want the entire amount escrowed up-front.",
    kind: "select",
    options: [
      { value: "50", label: "50% (industry standard)" },
      { value: "100", label: "100% (full escrow)" },
      { value: "30", label: "30% (smaller deposit)" },
      { value: "0", label: "0% (pay on delivery, riskier)" },
    ],
    required: true,
  },
  {
    id: "revisionsAllowed",
    prompt: "Revision rounds included",
    help: "After this many rounds, additional revisions trigger a change order.",
    kind: "number",
    placeholder: "2",
    required: true,
  },
  {
    id: "jurisdiction",
    prompt: "Governing jurisdiction",
    help: "Usually the state or country where you (the agency) are based. Used if either party files in small claims.",
    kind: "text",
    placeholder: "California, USA",
    required: true,
    quickOptions: [
      { value: "California, USA", label: "California, USA" },
      { value: "New York, USA", label: "New York, USA" },
      { value: "Texas, USA", label: "Texas, USA" },
      { value: "England & Wales", label: "England & Wales" },
      { value: "Ontario, Canada", label: "Ontario, Canada" },
    ],
  },
];

// ─── Helpers for HTML generation ──────────────────────────────────────────

function escape(value: AnswerValue): string {
  if (value == null) return "[TBD]";
  const s = String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function dollars(answers: WizardAnswers, key = "priceDollars"): string {
  const v = answers[key];
  if (v == null) return "[$ TBD]";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return "[$ TBD]";
  return `$${n.toLocaleString()}`;
}

function depositDollars(answers: WizardAnswers): string {
  const price =
    typeof answers.priceDollars === "number"
      ? answers.priceDollars
      : parseFloat(String(answers.priceDollars ?? "0"));
  const pct =
    typeof answers.depositPercent === "number"
      ? answers.depositPercent
      : parseFloat(String(answers.depositPercent ?? "50"));
  if (!Number.isFinite(price) || !Number.isFinite(pct)) return "[deposit TBD]";
  return `$${((price * pct) / 100).toLocaleString()}`;
}

/**
 * Multi-select answers are stored as "Option A; Option B; Custom".
 * For clause bodies we want a <ul> instead of a comma-mash, so this
 * splits the answer back into rows and renders each as a list item.
 * Falls back to a single-line note when nothing was picked.
 */
function renderListFromMultiselect(value: AnswerValue): string {
  if (value == null) return "<p><em>as specified in scope</em></p>";
  const parts = String(value)
    .split(/;\s*|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return "<p><em>as specified in scope</em></p>";
  return `<ul>${parts.map((p) => `<li>${escape(p)}</li>`).join("")}</ul>`;
}

function balanceDollars(answers: WizardAnswers): string {
  const price =
    typeof answers.priceDollars === "number"
      ? answers.priceDollars
      : parseFloat(String(answers.priceDollars ?? "0"));
  const pct =
    typeof answers.depositPercent === "number"
      ? answers.depositPercent
      : parseFloat(String(answers.depositPercent ?? "50"));
  if (!Number.isFinite(price) || !Number.isFinite(pct)) return "[balance TBD]";
  return `$${(price - (price * pct) / 100).toLocaleString()}`;
}

// ─── Shared clauses (every project gets these, in this order) ─────────────

export function buildSharedClauses(
  answers: WizardAnswers,
  startOrder = 0,
): ClauseDraft[] {
  let order = startOrder;
  return [
    {
      id: "scope",
      sectionKey: "scope",
      title: "Scope of work",
      required: true,
      order: order++,
      bodyHtml: `<p>This agreement covers the work described as <strong>${escape(answers.projectName)}</strong>. Anything outside this scope requires a signed change order before work begins.</p>`,
    },
    {
      id: "timeline",
      sectionKey: "timeline",
      title: "Timeline",
      required: true,
      order: order++,
      bodyHtml: `<p>Final delivery is targeted for <strong>${escape(answers.deadline)}</strong>. Client review turnaround on any deliverable is <strong>48 hours</strong>. Delays in client review extend the deadline by the equivalent amount.</p>`,
    },
    {
      id: "revisions",
      sectionKey: "revisions",
      title: "Revisions",
      required: true,
      order: order++,
      bodyHtml: `<p>This agreement includes <strong>${escape(answers.revisionsAllowed)} round(s)</strong> of revisions per deliverable. After the included rounds are used, additional revisions trigger a change order (new scope + new deposit) which must be signed by both parties before work continues.</p>`,
    },
    {
      id: "payment",
      sectionKey: "payment",
      title: "Payment",
      required: true,
      order: order++,
      bodyHtml: `<p>Total project fee: <strong>${dollars(answers)}</strong>.</p>
<ul>
  <li><strong>${depositDollars(answers)}</strong> (${escape(answers.depositPercent)}%) is held in escrow at signing. Work does not begin until escrow is confirmed.</li>
  <li><strong>${balanceDollars(answers)}</strong> balance is released from escrow when the named approver clicks "Approve Final".</li>
</ul>`,
    },
    {
      id: "approval",
      sectionKey: "approval",
      title: "Approval authority",
      required: true,
      order: order++,
      bodyHtml: `<p>The only person authorized to approve the final deliverable on the client's behalf is <strong>${escape(answers.approverName)}</strong> (<a href="mailto:${escape(answers.approverEmail)}">${escape(answers.approverEmail)}</a>). Approval is signaled by that person clicking "Approve Final" inside the snip platform.</p>`,
    },
    {
      id: "ip_transfer",
      sectionKey: "ip_transfer",
      title: "Intellectual property transfer",
      required: true,
      order: order++,
      bodyHtml: `<p>The agency retains all rights, title, and interest in the final deliverable until the full project fee has been received. Upon receipt of final payment, ownership transfers to the client subject to the usage rights described elsewhere in this agreement. Preview / watermarked versions are licensed for review only and may not be distributed or used in production.</p>`,
    },
    {
      id: "kill_fee",
      sectionKey: "kill_fee",
      title: "Cancellation (kill fee)",
      required: true,
      order: order++,
      bodyHtml: `<p>If the client cancels the project after signing but before final approval, the escrowed deposit is released to the agency immediately as a kill fee. Any escrow amounts beyond the deposit are returned to the client. If the agency cancels, the deposit is returned in full unless the client has materially breached this agreement.</p>`,
    },
    {
      id: "stalled",
      sectionKey: "stalled",
      title: "Stalled project",
      required: true,
      order: order++,
      bodyHtml: `<p>If the client neither approves nor requests revisions within <strong>14 days</strong> of a deliverable being marked "Ready for Review", snip will issue an automated reminder. If no response is received within an additional <strong>14 days</strong>, escrow is released to the agency and the project is considered closed. This clock pauses if the client formally requests an extension.</p>`,
    },
    {
      id: "dispute",
      sectionKey: "dispute",
      title: "Dispute resolution",
      required: true,
      order: order++,
      bodyHtml: `<p>Any dispute arising from this agreement is governed by the laws of <strong>${escape(answers.jurisdiction)}</strong>. The parties agree to first attempt resolution in good faith. If unresolved within 30 days, either party may file in the small-claims court of the agency's jurisdiction. The 24-hour buffer between "Approve Final" and escrow release exists to flag any last-second concerns.</p>`,
    },
  ];
}

// ─── Project-type-specific templates ──────────────────────────────────────

const VIDEO_PRODUCTION: ProjectTypeTemplate = {
  type: "video_production",
  label: "Video production",
  description: "Promo, brand film, music video, short-form social content, etc.",
  emoji: "🎬",
  typeSpecificQuestions: [
    {
      id: "deliverableFormats",
      prompt: "What master file format does the client need?",
      kind: "select",
      options: [
        { value: "prores_422_1080p", label: "ProRes 422, 1080p" },
        { value: "prores_422_4k", label: "ProRes 422, 4K UHD" },
        { value: "h264_1080p", label: "H.264, 1080p (web-ready)" },
        { value: "dnxhd", label: "DNxHD (broadcast)" },
        { value: "custom_video", label: "Other (specify in scope)" },
      ],
      required: true,
    },
    {
      id: "cutdowns",
      prompt: "Which cutdowns / aspect-ratio versions are included?",
      help: "Pick what you'll deliver and add anything custom.",
      kind: "multiselect",
      options: [
        { value: "60s hero", label: "60s hero" },
        { value: "30s edit", label: "30s edit" },
        { value: "15s social cutdown", label: "15s social cutdown" },
        { value: "6s bumper", label: "6s bumper" },
        { value: "9:16 vertical", label: "9:16 vertical" },
        { value: "1:1 square", label: "1:1 square" },
        { value: "captioned version", label: "Captioned version" },
        { value: "no-music version", label: "No-music version (for VO recut)" },
      ],
      placeholder: "Add another (e.g. \"45s broadcast spot\")",
      required: true,
    },
    {
      id: "rawFootageOwnership",
      prompt: "Who keeps the raw footage and project files?",
      kind: "select",
      options: [
        { value: "agency_keeps", label: "Agency keeps raw + project files" },
        { value: "client_keeps", label: "Client receives raw + project files at handoff" },
        { value: "extra_fee", label: "Available to client for an additional fee" },
      ],
      required: true,
    },
    {
      id: "musicLicensing",
      prompt: "How is music licensed?",
      kind: "select",
      options: [
        { value: "agency_licenses", label: "Agency licenses, included in fee" },
        { value: "client_provides", label: "Client provides licensed tracks" },
        { value: "stock_only", label: "Stock library only (Artlist / Musicbed / etc.)" },
      ],
      required: true,
    },
    {
      id: "usageRights",
      prompt: "Where can the client use the finished video?",
      kind: "select",
      options: [
        { value: "web_social", label: "Web + social only" },
        { value: "broadcast", label: "Broadcast + web + social" },
        { value: "paid_media", label: "Paid media (all platforms, geo-restricted)" },
        { value: "perpetual_worldwide", label: "Perpetual, worldwide, all media" },
      ],
      required: true,
    },
  ],
  generateTypeClauses: (answers) => {
    const formatLabel: Record<string, string> = {
      prores_422_1080p: "ProRes 422, 1920×1080",
      prores_422_4k: "ProRes 422, 3840×2160 (UHD)",
      h264_1080p: "H.264, 1920×1080",
      dnxhd: "DNxHD",
      custom_video: "Custom format (specified in scope)",
    };
    const rawLabel: Record<string, string> = {
      agency_keeps:
        "The agency retains raw footage and project files. Client receives the finished deliverable only.",
      client_keeps:
        "Raw footage and project files transfer to the client at final payment.",
      extra_fee:
        "Raw footage and project files are available to the client for an additional fee, billed separately.",
    };
    const musicLabel: Record<string, string> = {
      agency_licenses:
        "Music licensing is handled by the agency and included in the project fee. Licenses cover the usage rights described in this contract; expansions require a license upgrade.",
      client_provides:
        "Client provides music tracks with valid licenses for the intended use. Agency is not liable for music-licensing infringement on client-provided tracks.",
      stock_only:
        "Only stock-library music (Artlist, Musicbed, or equivalent) will be used. Licenses are tied to the agency account and cover the usage scope described herein.",
    };
    const usageLabel: Record<string, string> = {
      web_social: "Web + social media only.",
      broadcast: "Broadcast, web, and social media.",
      paid_media: "Paid media across all platforms (geographic restrictions may apply per channel).",
      perpetual_worldwide: "Perpetual, worldwide, across all media.",
    };

    return [
      {
        id: "deliverables_video",
        sectionKey: "deliverables",
        title: "Deliverables",
        required: true,
        order: 100,
        bodyHtml: `<p>Final master format: <strong>${escape(formatLabel[String(answers.deliverableFormats)] ?? answers.deliverableFormats)}</strong>.</p>
<p>Cutdowns / additional versions:</p>
${renderListFromMultiselect(answers.cutdowns)}`,
        sourceAnswerId: "deliverableFormats",
      },
      {
        id: "raw_footage",
        sectionKey: "raw_footage",
        title: "Raw footage & project files",
        required: false,
        order: 110,
        bodyHtml: `<p>${escape(rawLabel[String(answers.rawFootageOwnership)] ?? answers.rawFootageOwnership)}</p>`,
        sourceAnswerId: "rawFootageOwnership",
      },
      {
        id: "music_licensing",
        sectionKey: "music_licensing",
        title: "Music licensing",
        required: false,
        order: 120,
        bodyHtml: `<p>${escape(musicLabel[String(answers.musicLicensing)] ?? answers.musicLicensing)}</p>`,
        sourceAnswerId: "musicLicensing",
      },
      {
        id: "usage_rights_video",
        sectionKey: "usage_rights",
        title: "Usage rights",
        required: true,
        order: 130,
        bodyHtml: `<p>Upon final payment, client receives a license to use the deliverables as follows: <strong>${escape(usageLabel[String(answers.usageRights)] ?? answers.usageRights)}</strong></p>`,
        sourceAnswerId: "usageRights",
      },
    ];
  },
};

const LOGO_DESIGN: ProjectTypeTemplate = {
  type: "logo_design",
  label: "Logo design",
  description: "Mark / wordmark / lockup with file deliverables.",
  emoji: "🎨",
  typeSpecificQuestions: [
    {
      id: "logoFormats",
      prompt: "Which file formats are delivered?",
      kind: "select",
      options: [
        { value: "vector_pack", label: "Vector pack (AI + SVG + PDF) + PNG exports" },
        { value: "svg_png_only", label: "SVG + PNG exports only" },
        { value: "full_brand_kit", label: "Full brand kit (vector + PNG + favicon + social profile sizes)" },
      ],
      required: true,
    },
    {
      id: "colorVariants",
      prompt: "Number of color variants",
      help: "Full color, monochrome, reversed, etc.",
      kind: "number",
      placeholder: "3",
    },
    {
      id: "exclusivity",
      prompt: "Exclusivity",
      kind: "select",
      options: [
        { value: "exclusive", label: "Exclusive to client (agency cannot reuse direction)" },
        { value: "shared", label: "Agency retains rights to reuse stylistic elements" },
      ],
      required: true,
    },
  ],
  generateTypeClauses: (answers) => {
    const formatLabel: Record<string, string> = {
      vector_pack: "Vector pack: AI, SVG, PDF, plus PNG exports at standard sizes.",
      svg_png_only: "SVG + PNG exports only.",
      full_brand_kit:
        "Full brand kit: vector files, PNG exports, favicon, and social profile sizes pre-rendered.",
    };
    const exclLabel: Record<string, string> = {
      exclusive:
        "The final mark is exclusive to the client. The agency will not reuse the direction or substantially similar concepts for other clients.",
      shared:
        "The final mark is exclusive to the client, but the agency retains the right to reuse stylistic elements (typography choices, color theory) on other projects.",
    };
    return [
      {
        id: "deliverables_logo",
        sectionKey: "deliverables",
        title: "Deliverables",
        required: true,
        order: 100,
        bodyHtml: `<p>${escape(formatLabel[String(answers.logoFormats)] ?? answers.logoFormats)}</p>
<p>Color variants: <strong>${escape(answers.colorVariants)}</strong>.</p>`,
        sourceAnswerId: "logoFormats",
      },
      {
        id: "exclusivity",
        sectionKey: "exclusivity",
        title: "Exclusivity",
        required: false,
        order: 110,
        bodyHtml: `<p>${escape(exclLabel[String(answers.exclusivity)] ?? answers.exclusivity)}</p>`,
        sourceAnswerId: "exclusivity",
      },
    ];
  },
};

const WEB_DESIGN: ProjectTypeTemplate = {
  type: "web_design",
  label: "Web design + build",
  description: "Marketing site, landing page, or component library with code delivery.",
  emoji: "🌐",
  typeSpecificQuestions: [
    {
      id: "cms",
      prompt: "CMS / framework",
      kind: "select",
      options: [
        { value: "static", label: "Static site (no CMS)" },
        { value: "next_static", label: "Next.js (statically generated)" },
        { value: "next_dynamic", label: "Next.js (dynamic / server components)" },
        { value: "webflow", label: "Webflow" },
        { value: "wordpress", label: "WordPress" },
        { value: "custom_web", label: "Other (specify in scope)" },
      ],
      required: true,
    },
    {
      id: "hostingHandoff",
      prompt: "Who hosts after handoff?",
      kind: "select",
      options: [
        { value: "client_hosts", label: "Client (agency hands off repo + setup docs)" },
        { value: "agency_hosts", label: "Agency hosts on retainer (separate agreement)" },
        { value: "managed_handoff", label: "Agency sets up client's hosting then hands off keys" },
      ],
      required: true,
    },
    {
      id: "browserSupport",
      prompt: "Browser support floor",
      kind: "select",
      options: [
        { value: "evergreen", label: "Evergreen browsers (last 2 versions of Chrome / Firefox / Safari / Edge)" },
        { value: "evergreen_safari14", label: "Evergreen + Safari 14+" },
        { value: "broad", label: "Broad support (including IE 11) — costs more" },
      ],
      required: true,
    },
    {
      id: "contentResponsibility",
      prompt: "Who provides the content (copy + imagery)?",
      kind: "select",
      options: [
        { value: "client_content", label: "Client provides all final copy and imagery" },
        { value: "agency_placeholder", label: "Agency provides placeholder; client supplies final" },
        { value: "agency_writes", label: "Agency writes copy (additional fee may apply)" },
      ],
      required: true,
    },
  ],
  generateTypeClauses: (answers) => {
    return [
      {
        id: "tech_stack",
        sectionKey: "deliverables",
        title: "Technical stack & deliverables",
        required: true,
        order: 100,
        bodyHtml: `<p>Stack: <strong>${escape(answers.cms)}</strong>. Hosting after handoff: <strong>${escape(answers.hostingHandoff)}</strong>. Browser support: <strong>${escape(answers.browserSupport)}</strong>.</p>`,
      },
      {
        id: "content_responsibility",
        sectionKey: "content_responsibility",
        title: "Content responsibility",
        required: false,
        order: 110,
        bodyHtml: `<p>Content (copy + imagery): <strong>${escape(answers.contentResponsibility)}</strong>. Delivery delays caused by content not arriving extend the project deadline by the equivalent amount.</p>`,
      },
    ];
  },
};

const PHOTOGRAPHY: ProjectTypeTemplate = {
  type: "photography",
  label: "Photography",
  description: "Commercial, editorial, product, or portrait shoot with usage licensing.",
  emoji: "📸",
  typeSpecificQuestions: [
    {
      id: "selectedImages",
      prompt: "Number of retouched / selected images included",
      kind: "number",
      placeholder: "20",
      required: true,
    },
    {
      id: "rawNegatives",
      prompt: "Raw / unedited files",
      kind: "select",
      options: [
        { value: "agency_keeps", label: "Agency retains raw files" },
        { value: "client_keeps", label: "Client receives raw files at final payment" },
      ],
      required: true,
    },
    {
      id: "modelReleases",
      prompt: "Who handles model releases?",
      kind: "select",
      options: [
        { value: "agency", label: "Agency obtains releases" },
        { value: "client", label: "Client obtains releases" },
        { value: "na", label: "No people in frame (N/A)" },
      ],
      required: true,
    },
    {
      id: "usageScope",
      prompt: "Usage license",
      kind: "select",
      options: [
        { value: "internal_only", label: "Internal use only (intranet / decks)" },
        { value: "web_social", label: "Web + social" },
        { value: "broad_commercial", label: "Broad commercial (including paid media + print)" },
        { value: "perpetual_worldwide", label: "Perpetual, worldwide, all media" },
      ],
      required: true,
    },
  ],
  generateTypeClauses: (answers) => {
    return [
      {
        id: "shot_count",
        sectionKey: "deliverables",
        title: "Selected images",
        required: true,
        order: 100,
        bodyHtml: `<p>The agency delivers <strong>${escape(answers.selectedImages)}</strong> retouched images selected from the shoot. Additional retouched images can be added via change order at the per-image rate stated in scope.</p>`,
      },
      {
        id: "raw_files_photo",
        sectionKey: "raw_files",
        title: "Raw files",
        required: false,
        order: 110,
        bodyHtml: `<p>Raw file handling: <strong>${escape(answers.rawNegatives)}</strong>.</p>`,
      },
      {
        id: "model_releases",
        sectionKey: "model_releases",
        title: "Model releases",
        required: false,
        order: 120,
        bodyHtml: `<p>Responsibility for obtaining model and location releases: <strong>${escape(answers.modelReleases)}</strong>.</p>`,
      },
      {
        id: "usage_rights_photo",
        sectionKey: "usage_rights",
        title: "Usage rights",
        required: true,
        order: 130,
        bodyHtml: `<p>Upon final payment, client receives a license to use the selected images as follows: <strong>${escape(answers.usageScope)}</strong>.</p>`,
      },
    ];
  },
};

const CUSTOM: ProjectTypeTemplate = {
  type: "custom",
  label: "Custom / other",
  description: "Catch-all template with just the universal clauses. Add custom sections after.",
  emoji: "✨",
  typeSpecificQuestions: [
    {
      id: "scopeDescription",
      prompt: "What are you delivering?",
      help: "Free-text scope — agency-paragraph length is fine.",
      kind: "textarea",
      placeholder: "Two-day onsite workshop facilitation, plus a written deliverable summarizing the outcomes…",
      required: true,
    },
  ],
  generateTypeClauses: (answers) => [
    {
      id: "deliverables_custom",
      sectionKey: "deliverables",
      title: "Deliverables",
      required: true,
      order: 100,
      bodyHtml: `<p>${escape(answers.scopeDescription)}</p>`,
    },
  ],
};

// Brand identity, copywriting, music, animation share the universal-only
// shape for now — agency can add custom sections after generation. Each
// gets a labeled card in the wizard so the picker feels comprehensive.

const BRAND_IDENTITY: ProjectTypeTemplate = {
  ...CUSTOM,
  type: "brand_identity",
  label: "Brand identity",
  description: "Full brand system (mark + type + color + guidelines).",
  emoji: "🖼",
};
const COPYWRITING: ProjectTypeTemplate = {
  ...CUSTOM,
  type: "copywriting",
  label: "Copywriting",
  description: "Long-form or short-form copy with revision rounds.",
  emoji: "✍️",
};
const MUSIC: ProjectTypeTemplate = {
  ...CUSTOM,
  type: "music",
  label: "Music / audio",
  description: "Composition, sound design, or mix engineering.",
  emoji: "🎵",
};
const ANIMATION: ProjectTypeTemplate = {
  ...CUSTOM,
  type: "animation",
  label: "Animation",
  description: "2D / 3D / motion graphics with shot-level delivery.",
  emoji: "🎞",
};

export const PROJECT_TYPE_TEMPLATES: ProjectTypeTemplate[] = [
  VIDEO_PRODUCTION,
  LOGO_DESIGN,
  WEB_DESIGN,
  PHOTOGRAPHY,
  BRAND_IDENTITY,
  COPYWRITING,
  MUSIC,
  ANIMATION,
  CUSTOM,
];

export function getTemplate(type: ProjectType): ProjectTypeTemplate {
  return (
    PROJECT_TYPE_TEMPLATES.find((t) => t.type === type) ?? CUSTOM
  );
}

/**
 * The main entry point used by the wizard submit handler. Merges shared
 * + type-specific clauses, sorts by order, returns the array ready to
 * patch into the contract.
 */
export function generateClausesFromAnswers(
  type: ProjectType,
  answers: WizardAnswers,
): ClauseDraft[] {
  const template = getTemplate(type);
  const shared = buildSharedClauses(answers, 0);
  const specific = template.generateTypeClauses(answers);
  return [...shared, ...specific].sort((a, b) => a.order - b.order);
}

/**
 * Renders clauses back into a single HTML document for the .docx export
 * + legacy contentHtml field. Section titles become H2s.
 */
/**
 * Maps each section (clause `sectionKey`) to the wizard answer keys
 * whose values flow into that section's body. Used by the outline
 * editor so the user can edit the answers inline per section instead
 * of re-running the whole wizard.
 *
 * Sections that are pure boilerplate (no user-tunable inputs) are
 * intentionally omitted — there's nothing to surface for them.
 */
export const SECTION_TO_ANSWER_KEYS: Record<string, string[]> = {
  scope: ["projectName"],
  timeline: ["deadline"],
  revisions: ["revisionsAllowed"],
  payment: ["priceDollars", "depositPercent"],
  approval_authority: ["approverName", "approverEmail"],
  dispute_resolution: ["jurisdiction"],
  // Video-specific clauses
  deliverables: ["deliverableFormats", "cutdowns"],
  raw_footage: ["rawFootageOwnership"],
  music: ["musicLicensing"],
  usage: ["usageRights"],
};

/**
 * Find a WizardQuestion by answer key. Walks the universal list first,
 * then every project type's type-specific questions. Returns undefined
 * if the key isn't backed by a question (rare — only when the contract
 * was authored before a question existed).
 */
export function findQuestionByKey(
  key: string,
  projectType?: ProjectType,
): WizardQuestion | undefined {
  for (const q of UNIVERSAL_QUESTIONS) {
    if (q.id === key) return q;
  }
  const types = projectType
    ? [getTemplate(projectType)]
    : PROJECT_TYPE_TEMPLATES;
  for (const t of types) {
    for (const q of t.typeSpecificQuestions) {
      if (q.id === key) return q;
    }
  }
  return undefined;
}

export function renderClausesAsHtml(
  clauses: Array<{ title: string; bodyHtml: string; order: number }>,
): string {
  const sorted = [...clauses].sort((a, b) => a.order - b.order);
  return sorted
    .map((c) => `<h2>${escape(c.title)}</h2>\n${c.bodyHtml}`)
    .join("\n\n");
}
