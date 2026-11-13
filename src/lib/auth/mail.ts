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

export type Send = (message: Message) => Promise<void>;

const transports = new Map<string, Transporter>();

export function smtpSender(email: NonNullable<AuthConfig["email"]>): Send {
  let transport = transports.get(email.smtpUrl);
  if (!transport) { transport = nodemailer.createTransport(email.smtpUrl); transports.set(email.smtpUrl, transport); }
  const t = transport;
  return async (message) => { await t.sendMail({ from: email.from, ...message }); };
}
