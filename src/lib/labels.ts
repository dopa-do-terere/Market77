export const STATUS_LABEL: Record<string, string> = {
  open: "Em andamento",
  awaiting_payment: "Aguardando pagamento",
  paid: "Paga",
  cancelled: "Cancelada",
  expired: "Expirada",
};

export const PAYMENT_LABEL: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  expired: "Expirado",
  failed: "Falhou",
};

export const COMMAND_LABEL: Record<string, string> = {
  restart_pdv: "Reiniciar PDV",
  reboot: "Reboot",
  update: "Atualizar agente",
};

export const COMMAND_STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  delivered: "Enviado ao totem",
  succeeded: "Concluído",
  failed: "Falhou",
};

export const METHOD_LABEL: Record<string, string> = {
  pix: "Pix",
  card: "Cartão",
};

export const FAILURE_LABEL: Record<string, string> = {
  declined: "Recusado",
  cancelled: "Cancelado",
  expired: "Expirado",
};
