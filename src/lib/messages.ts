const MESSAGES: Record<string, string> = {
  invalid_input: "Dados inválidos. Confira os campos.",
  email_taken: "Já existe uma conta com este e-mail.",
  invalid_credentials: "E-mail ou senha incorretos.",
  barcode_taken: "Este código de barras já está em uso.",
  not_found: "Item não encontrado.",
  already_member: "Este usuário já faz parte da organização.",
  forbidden: "Você não tem permissão para isso.",
};

export const message = (code: string): string => MESSAGES[code] ?? "Erro inesperado.";
