import { api, updatePaper, deletePaper } from "@/lib/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function PATCH(request: Request, context: Context) {
  return api(() => updatePaper(request, context));
}

export async function DELETE(request: Request, context: Context) {
  return api(() => deletePaper(request, context));
}

