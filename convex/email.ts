"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/**
 * Transactional email via Resend.
 *
 * Key-gated and non-breaking, same pattern as the Stripe/Mux/Gemini
 * fallbacks: with no RESEND_API_KEY (or no APP_URL for links) this
 * no-ops with a log — the underlying action still succeeds and the
 * in-app copy-link affordances keep working, so email is purely an
 * additive delivery channel.
 *
 * Plain `fetch` against the Resend REST API — no SDK dependency.
 *
 * Env:
 *   RESEND_API_KEY  — required to actually send
 *   EMAIL_FROM      — optional, defaults to Resend's shared test sender
 *                     (only delivers to the account owner until a
 *                     verified domain is set)
 *   APP_URL         — required for links in emails (e.g. https://snip.app
 *                     or http://localhost:5296 in dev)
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("email: RESEND_API_KEY not set — skipping send", {
      to: args.to,
      subject: args.subject,
    });
    return { sent: false, reason: "no_api_key" };
  }
  const from = process.env.EMAIL_FROM || "snip <onboarding@resend.dev>";
  const resp = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!resp.ok) {
    console.error("email: Resend send failed", {
      to: args.to,
      status: resp.status,
      body: (await resp.text()).slice(0, 300),
    });
    return { sent: false, reason: `resend_${resp.status}` };
  }
  return { sent: true };
}

/** Minimal on-brand HTML shell — inline styles only (email clients
 *  strip <style>/external CSS). Matches the client-surface look:
 *  white rounded card on a soft gray canvas, near-black text, the
 *  snip wordmark with the orange period. */
function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fafafa;padding:40px 0;font-family:'Inter Tight',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:90%;background:#ffffff;border:1px solid #e8e8ec;border-radius:16px;">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #e8e8ec;">
        <span style="font-size:21px;font-weight:600;letter-spacing:-0.03em;color:#131315;">snip<span style="color:#FF6600;">.</span></span>
      </td></tr>
      <tr><td style="padding:28px;color:#131315;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
    </table>
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:90%;"><tr>
      <td style="padding:16px 28px;color:#a0a0a5;font-size:12px;">Sent by snip — video review for creative teams.</td>
    </tr></table>
  </td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#131315;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:12px 24px;border-radius:9999px;">${label}</a>`;
}

export const sendTeamInvite = internalAction({
  args: {
    email: v.string(),
    token: v.string(),
    teamName: v.string(),
    inviterName: v.string(),
    role: v.string(),
  },
  handler: async (_ctx, args) => {
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      console.log(
        "email: APP_URL not set — skipping invite email (in-app copy link still works)",
        { email: args.email },
      );
      return;
    }
    const link = `${appUrl.replace(/\/$/, "")}/invite/${args.token}`;
    const subject = `${args.inviterName} invited you to ${args.teamName} on snip`;
    const text =
      `${args.inviterName} invited you to join "${args.teamName}" as ${args.role} on snip.\n\n` +
      `Accept: ${link}\n\nThis invite expires in 7 days.`;
    const html = shell(
      `<p style="margin:0 0 16px;"><strong>${args.inviterName}</strong> invited you to join ` +
        `<strong>${args.teamName}</strong> as <strong>${args.role}</strong> on snip.</p>` +
        `<p style="margin:0 0 24px;">${button(link, "Accept invite")}</p>` +
        `<p style="margin:0;color:#888;font-size:13px;">Or paste this link: <br/>` +
        `<span style="font-family:monospace;word-break:break-all;">${link}</span></p>` +
        `<p style="margin:20px 0 0;color:#888;font-size:12px;">This invite expires in 7 days. ` +
        `If you weren't expecting it, you can ignore this email.</p>`,
    );
    await sendViaResend({ to: args.email, subject, html, text });
  },
});

/**
 * One-time verification code for the signing ceremony (identity tier). The code
 * is generated + hashed server-side in contractsTable.issueSignOtp; we only ever
 * email the plaintext. Returns whether the email actually went out so the caller
 * can tell the signer to check their inbox vs. surface a config problem.
 */
export const sendContractOtp = internalAction({
  args: {
    email: v.string(),
    code: v.string(),
    contractTitle: v.string(),
  },
  returns: v.object({ sent: v.boolean() }),
  handler: async (_ctx, args): Promise<{ sent: boolean }> => {
    const subject = `Your snip signing code: ${args.code}`;
    const text =
      `Your verification code to sign "${args.contractTitle}" is ${args.code}.\n\n` +
      `It expires in 10 minutes. If you didn't request this, ignore this email.`;
    const html = shell(
      `<p style="margin:0 0 12px;">Use this code to verify your identity and sign ` +
        `<strong>${args.contractTitle}</strong>:</p>` +
        `<p style="margin:0 0 20px;font-family:monospace;font-size:32px;font-weight:700;` +
        `letter-spacing:0.15em;color:#131315;">${args.code}</p>` +
        `<p style="margin:0;color:#888;font-size:13px;">This code expires in 10 minutes. ` +
        `If you didn't request it, you can ignore this email.</p>`,
    );
    const result = await sendViaResend({ to: args.email, subject, html, text });
    return { sent: result.sent };
  },
});

/** Shared guard for notification emails: resolve the absolute link or
 *  bail (no APP_URL → skip; the in-app activity is unaffected). */
function linkOrSkip(path: string): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.log("email: APP_URL not set — skipping notification email");
    return null;
  }
  return `${appUrl.replace(/\/$/, "")}${path}`;
}

export const sendCommentReply = internalAction({
  args: {
    to: v.string(),
    replierName: v.string(),
    videoTitle: v.string(),
    path: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(args.path);
    if (!link) return;
    const subject = `${args.replierName} replied on "${args.videoTitle}"`;
    const text = `${args.replierName} replied to a comment thread you're in on "${args.videoTitle}".\n\nView: ${link}`;
    await sendViaResend({
      to: args.to,
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;"><strong>${args.replierName}</strong> replied to a comment thread you're in on <strong>${args.videoTitle}</strong>.</p>` +
          `<p style="margin:0 0 8px;">${button(link, "View thread")}</p>`,
      ),
    });
  },
});

/**
 * The signing invitation — sent to every recipient when the author clicks
 * "Send for signature". Signers/approvers get a "Review & sign" CTA;
 * viewers/cc get "View contract". The /sign/$token link is the same one the
 * UI surfaces for manual copy, so email stays a purely additive channel.
 */
export const sendSignatureRequest = internalAction({
  args: {
    to: v.string(),
    recipientName: v.string(),
    role: v.string(),
    senderName: v.string(),
    contractTitle: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(`/sign/${args.token}`);
    if (!link) return;
    const isSigner = args.role === "signer" || args.role === "approver";
    const subject = isSigner
      ? `${args.senderName} sent you "${args.contractTitle}" to sign`
      : `${args.senderName} shared "${args.contractTitle}" with you`;
    const days = Math.max(
      1,
      Math.round((args.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    const cta = isSigner ? "Review & sign" : "View contract";
    const action = isSigner
      ? "has sent you a contract to review and sign"
      : "has shared a contract with you";
    const text =
      `Hi ${args.recipientName},\n\n${args.senderName} ${action}: "${args.contractTitle}".\n\n` +
      `${cta}: ${link}\n\nThis link expires in ${days} days. ` +
      `If you weren't expecting this, you can ignore this email.`;
    const html = shell(
      `<p style="margin:0 0 16px;">Hi <strong>${args.recipientName}</strong>,</p>` +
        `<p style="margin:0 0 16px;"><strong>${args.senderName}</strong> ${action}: ` +
        `<strong>${args.contractTitle}</strong>.</p>` +
        `<p style="margin:0 0 24px;">${button(link, cta)}</p>` +
        `<p style="margin:0;color:#888;font-size:13px;">Or paste this link: <br/>` +
        `<span style="font-family:monospace;word-break:break-all;">${link}</span></p>` +
        `<p style="margin:20px 0 0;color:#888;font-size:12px;">This link expires in ${days} days. ` +
        `If you weren't expecting this, you can ignore this email.</p>`,
    );
    await sendViaResend({ to: args.to, subject, html, text });
  },
});

/**
 * Completion receipt — every signer + approver finished, the contract is
 * executed. Sent to each recipient; their token page now renders the
 * completed state with the signed-package download.
 */
export const sendContractCompleted = internalAction({
  args: {
    to: v.string(),
    recipientName: v.string(),
    contractTitle: v.string(),
    token: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(`/sign/${args.token}`);
    if (!link) return;
    const subject = `Fully signed: "${args.contractTitle}"`;
    const text =
      `Hi ${args.recipientName},\n\nEveryone has signed "${args.contractTitle}" — it's now fully executed.\n\n` +
      `View the signed contract: ${link}`;
    const html = shell(
      `<p style="margin:0 0 16px;">Hi <strong>${args.recipientName}</strong>,</p>` +
        `<p style="margin:0 0 16px;">Everyone has signed <strong>${args.contractTitle}</strong> — ` +
        `it's now fully executed.</p>` +
        `<p style="margin:0 0 8px;">${button(link, "View signed contract")}</p>`,
    );
    await sendViaResend({ to: args.to, subject, html, text });
  },
});

export const sendContractSigned = internalAction({
  args: {
    to: v.string(),
    projectName: v.string(),
    signedByName: v.string(),
    path: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(args.path);
    if (!link) return;
    const subject = `Contract signed — ${args.projectName}`;
    const text = `${args.signedByName} signed the contract on "${args.projectName}".\n\nView: ${link}`;
    await sendViaResend({
      to: args.to,
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;">The contract on <strong>${args.projectName}</strong> was signed by <strong>${args.signedByName}</strong>.</p>` +
          `<p style="margin:0 0 8px;">${button(link, "View contract")}</p>`,
      ),
    });
  },
});

export const sendUploadFinished = internalAction({
  args: {
    to: v.string(),
    videoTitle: v.string(),
    path: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(args.path);
    if (!link) return;
    const subject = `Ready: "${args.videoTitle}" finished processing`;
    const text = `Your upload "${args.videoTitle}" finished processing and is ready to review.\n\nOpen: ${link}`;
    await sendViaResend({
      to: args.to,
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;">Your upload <strong>${args.videoTitle}</strong> finished processing and is ready to review.</p>` +
          `<p style="margin:0 0 8px;">${button(link, "Open video")}</p>`,
      ),
    });
  },
});

export const sendUploadFailed = internalAction({
  args: {
    to: v.string(),
    videoTitle: v.string(),
    errorMessage: v.optional(v.string()),
    path: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(args.path);
    if (!link) return;
    const subject = `Upload didn't process: "${args.videoTitle}"`;
    const reason = args.errorMessage
      ? ` Reason: ${args.errorMessage}.`
      : "";
    const text = `Your upload "${args.videoTitle}" failed to process.${reason}\n\nOpen: ${link}`;
    await sendViaResend({
      to: args.to,
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 12px;">Your upload <strong>${args.videoTitle}</strong> failed to process.</p>` +
          (args.errorMessage
            ? `<p style="margin:0 0 16px;color:#888;font-size:13px;">${args.errorMessage}</p>`
            : "") +
          `<p style="margin:0 0 8px;">${button(link, "Open video")}</p>`,
      ),
    });
  },
});

export const sendInviteAccepted = internalAction({
  args: {
    to: v.string(),
    accepterName: v.string(),
    teamName: v.string(),
    path: v.string(),
  },
  handler: async (_ctx, args) => {
    const link = linkOrSkip(args.path);
    if (!link) return;
    const subject = `${args.accepterName} joined ${args.teamName}`;
    const text = `${args.accepterName} accepted your invite and joined "${args.teamName}".\n\nOpen team: ${link}`;
    await sendViaResend({
      to: args.to,
      subject,
      text,
      html: shell(
        `<p style="margin:0 0 16px;"><strong>${args.accepterName}</strong> accepted your invite and joined <strong>${args.teamName}</strong>.</p>` +
          `<p style="margin:0 0 8px;">${button(link, "Open team")}</p>`,
      ),
    });
  },
});
