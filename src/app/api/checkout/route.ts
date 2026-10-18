import { NextRequest, NextResponse } from "next/server";
import { createCheckout, CheckoutRequest } from "../../../../src/lib/checkout";

/**
 * POST /api/checkout
 * 创建结账（mock 模式）→ 返回托管页 URL + checkoutId。
 * 真实模式（后续）：读 env LEMON_SQUEEZY_*，POST Lemon Squeezy /v1/checkouts。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CheckoutRequest;
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (req.headers.get("host")
        ? `https://${req.headers.get("host")}`
        : "http://localhost:3000");
    const result = await createCheckout(body, baseUrl);
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "checkout failed", detail },
      { status: 500 }
    );
  }
}
