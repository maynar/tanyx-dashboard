import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ML_CLIENT_ID: process.env.ML_CLIENT_ID ? "OK" : "MISSING",
    ML_CLIENT_SECRET: process.env.ML_CLIENT_SECRET ? "OK" : "MISSING",
    ML_REDIRECT_URI: process.env.ML_REDIRECT_URI ?? "MISSING",
  });
} 
