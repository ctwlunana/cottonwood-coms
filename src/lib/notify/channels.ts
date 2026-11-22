/**
 * External notification channel adapters. Each adapter reports whether it is
 * configured; unconfigured channels are recorded as "skipped" in the delivery
 * log (never silently dropped). In-app delivery is handled by the engine itself.
 */
import nodemailer from "nodemailer";

export type OutMessage = { to: string; subject: string; text: string; link?: string | null };
export type SendResult = { ok: true } | { ok: false; error: string; retryable: boolean };

export interface ChannelAdapter {
  name: "email" | "whatsapp";
  configured(): boolean;
  /** Contact address for a user on this channel, or null. */
  address(u: { email: string | null; phone: string | null }): string | null;
  send(msg: OutMessage): Promise<SendResult>;
}

let transporter: nodemailer.Transporter | null = null;

export const emailAdapter: ChannelAdapter = {
  name: "email",
  configured: () => Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM),
  address: (u) => u.email,
  async send(msg) {
    try {
      transporter ??= nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      const url = msg.link ? `${process.env.APP_URL ?? ""}${msg.link}` : null;
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: msg.to,
        subject: `[COMS] ${msg.subject}`,
        text: url ? `${msg.text}\n\nBuka: ${url}` : msg.text,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: true };
    }
  },
};

/**
 * WhatsApp Business Cloud API adapter (Meta). NOT verified against a live account:
 * business-initiated messages require an approved template, configured via
 * WHATSAPP_TEMPLATE (single body parameter = message text). Disabled unless
 * WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set.
 */
export const whatsappAdapter: ChannelAdapter = {
  name: "whatsapp",
  configured: () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE),
  address: (u) => (u.phone ? u.phone.replace(/[^\d]/g, "").replace(/^0/, "62") : null),
  async send(msg) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: msg.to,
          type: "template",
          template: {
            name: process.env.WHATSAPP_TEMPLATE,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "id" },
            components: [{ type: "body", parameters: [{ type: "text", text: `${msg.subject}: ${msg.text}`.slice(0, 1000) }] }],
          },
        }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, retryable: res.status >= 500 };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: true };
    }
  },
};

export const ADAPTERS: ChannelAdapter[] = [emailAdapter, whatsappAdapter];
