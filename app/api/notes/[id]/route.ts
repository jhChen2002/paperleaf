import { api, updateNote, deleteNote } from "@/lib/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function PATCH(request: Request, context: Context) {
  return api(() => updateNote(request, context));
}

export async function DELETE(request: Request, context: Context) {
  return api(() => deleteNote(request, context));
}

