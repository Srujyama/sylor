// Firebase uses popup-based OAuth, so no server-side code exchange is needed.
// This route is kept as a safety redirect in case old links point here.
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/dashboard`);
}
