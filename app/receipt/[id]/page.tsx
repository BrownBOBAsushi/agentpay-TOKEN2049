import type { Metadata } from "next";
import { getReceipt } from "../../../src/web/receipt-data.server";
import { ReceiptView } from "../../../src/web/ReceiptView";

export const revalidate = 60;
type Props = { params: Promise<{ id: string }> };
export function generateStaticParams() { return [{ id: "example" }]; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getReceipt((await params).id);
  return { title: `Guard Receipt${data.kind === "receipt" ? ` — ${data.verdict}` : ""} · AgentPay Guard` };
}
export default async function ReceiptPage({ params }: Props) {
  return <ReceiptView data={await getReceipt((await params).id)} />;
}
