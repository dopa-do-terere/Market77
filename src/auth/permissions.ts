export const ROLES = ["owner", "manager", "restocker"] as const;
export type Role = (typeof ROLES)[number];

const MATRIX = {
  owner: [
    "member:write", "market:write", "product:write", "price:write", "stock:move", "stock:read",
    "catalog:read", "terminal:write", "sale:read",
    "access:read", "access:write",
  ],
  manager: ["product:write", "price:write", "stock:move", "stock:read", "catalog:read", "sale:read"],
  restocker: ["stock:move", "stock:read", "catalog:read"],
} as const;

export type Action = (typeof MATRIX)["owner"][number];

export const can = (role: Role, action: Action): boolean =>
  (MATRIX[role] as readonly Action[]).includes(action);
