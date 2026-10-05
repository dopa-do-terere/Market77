import { customerHandler } from "@/pdv/http";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return customerHandler(req, (await params).id);
}
