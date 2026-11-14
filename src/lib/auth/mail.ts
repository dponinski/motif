import nodemailer, { type Transporter } from "nodemailer";
import type { AuthConfig } from "./config";

// The email that carries a sign-in link. Plain text and a small HTML version; the link is the whole point.

export interface Message { to: string; subject: string; text: string; html: string }

export function loginMessage(to: string, link: string, minutes: number): Message {
  const text = `Sign in to Motif\n\nOpen this link to sign in (it works once, for ${minutes} minutes):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email: nobody is signed in unless the link is opened.\n`;
  const safe = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html = `<p>Sign in to Motif</p><p><a href="${safe}">Open this link to sign in</a> (it works once, for ${minutes} minutes).</p><p style="color:#666">If you didn't ask for this, you can ignore this email: nobody is signed in unless the link is opened.</p>`;
  return { to, subject: "Your Motif sign-in link", text, html };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// The invitation to a team: who asked, to what, and the link that takes them there (signing in first, with this address).
export function inviteMessage(to: string, team: string, from: string | null, link: string, days: number): Message {
  const who = from ?? "Someone";
  const text = `${who} invited you to the team "${team}" on Motif\n\nOpen this link, sign in with this address (${to}), and the team's design systems are yours to work on (the invitation lasts ${days} days):\n\n${link}\n\nIf you weren't expecting this, you can ignore this email: nothing happens unless the link is opened.\n`;
  const html = `<p>${escape(who)} invited you to the team <strong>${escape(team)}</strong> on Motif.</p><p><a href="${escape(link)}">Open the invitation</a>, sign in with this address (${escape(to)}), and the team's design systems are yours to work on (it lasts ${days} days).</p><p style="color:#666">If you weren't expecting this, you can ignore this email: nothing happens unless the link is opened.</p>`;
  return { to, subject: `${who} invited you to ${team} on Motif`, text, html };
}

export type Send = (message: Message) => Promise<void>;

const transports = new Map<string, Transporter>();

export function smtpSender(email: NonNullable<AuthConfig["email"]>): Send {
  let transport = transports.get(email.smtpUrl);
  if (!transport) { transport = nodemailer.createTransport(email.smtpUrl); transports.set(email.smtpUrl, transport); }
  const t = transport;
  return async (message) => { await t.sendMail({ from: email.from, ...message }); };
}
