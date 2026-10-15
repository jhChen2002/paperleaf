import { api, createFolder } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return api(() => createFolder(request));
}

