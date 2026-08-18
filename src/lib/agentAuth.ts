import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function authenticateAgent(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const apiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!apiKey) return null;

  const device = await prisma.device.findUnique({ where: { apiKey } });
  return device;
}
