import { api, getPaperFile, attachPaperFile } from "@/lib/server";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: Request, context: Context) {
  return api(() => getPaperFile(request, context));
}

export async function POST(request: Request, context: Context) {
  return api(() => attachPaperFile(request, context));
}

