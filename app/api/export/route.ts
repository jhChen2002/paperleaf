import { api, exportLibrary } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return api(() => exportLibrary());
}

