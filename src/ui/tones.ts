import type { Tone } from "./Badge";

export const SALE_TONE: Record<string, Tone> = {
  open: "neutral",
  awaiting_payment: "warning",
  paid: "success",
  cancelled: "neutral",
  expired: "neutral",
};

export const PAYMENT_TONE: Record<string, Tone> = {
  pending: "warning",
  confirmed: "success",
  expired: "neutral",
  failed: "danger",
};

export const FISCAL_TONE: Record<string, Tone> = {
  pending: "warning",
  issued: "success",
  error: "danger",
};

export const COMMAND_TONE: Record<string, Tone> = {
  pending: "neutral",
  delivered: "brand",
  succeeded: "success",
  failed: "danger",
};
