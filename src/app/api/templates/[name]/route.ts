import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/session";

const ALLOWED = new Set(["villas", "employees", "inventory", "suppliers"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { name } = await params;
  if (!ALLOWED.has(name)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const csv = await readFile(path.join(process.cwd(), "templates", `${name}.csv`), "utf8");
  return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="template-${name}.csv"` } });
}
