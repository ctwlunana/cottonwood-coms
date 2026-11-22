/**
 * External delivery channels. Policy (Nov 2026): all communication happens inside
 * COMS — no WhatsApp, no email. In-app notifications are written by the engine itself.
 * The adapter interface is kept so browser push notifications (Web Push to the staff
 * member's own phone, still part of the app) can be added without touching callers.
 */
export type ChannelName = "push";
export type OutMessage = { to: string; subject: string; text: string; link?: string | null };
export type SendResult = { ok: true } | { ok: false; error: string; retryable: boolean };

export interface ChannelAdapter {
  name: ChannelName;
  configured(): boolean;
  /** Delivery address for the user on this channel (e.g. push subscription), or null. */
  address(u: { id: string }): string | null;
  send(msg: OutMessage): Promise<SendResult>;
}

export const ADAPTERS: ChannelAdapter[] = [];
