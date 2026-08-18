import { NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE } from "../../../lib/admin-auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ADMIN_AUTH_COOKIE);
  return response;
}
