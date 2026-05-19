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
 *  strip <style>/external CSS). Cream bg, near-black text, the snip
 *  wordmark with the burnt-orange period. */
function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f0f0e8;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:90%;background:#f0f0e8;border:2px solid #1a1a1a;">
      <tr><td style="padding:24px 28px;border-bottom:2px solid #1a1a1a;">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.03em;color:#1a1a1a;">snip<span style="color:#C2410C;">.</span></span>
      </td></tr>
      <tr><td style="padding:28px;color:#1a1a1a;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a1a1a;color:#f0f0e8;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border:2px solid #1a1a1a;">${label}</a>`;
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
