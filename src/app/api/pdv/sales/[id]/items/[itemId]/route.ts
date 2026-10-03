import { setQuantityHandler } from "@/pdv/http";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  return setQuantityHandler(req, id, itemId);
}
