import { requireOrgPage } from "@/auth/guard";
import { withOrg } from "@/db/tenant";
import { getBranding } from "@/domain/branding";
import { message } from "@/lib/messages";
import { Alert, PageHeader } from "@/ui";
import { BrandingForm } from "./BrandingForm";

export default async function BrandingPage({ params, searchParams }: { params: Promise<{orgId: string}>; searchParams: Promise<{error?: string; saved?: string}> }) {
  const { orgId } = await params;
  await requireOrgPage(orgId, "branding:write");
  const brand = await withOrg(orgId, getBranding);
  const { error, saved } = await searchParams;
  return <main className="space-y-6">
    <PageHeader icon="market" title="Sua marca" description="Dê a sua identidade ao painel e ao autoatendimento dos seus mercados." />
    {error && <Alert tone="danger">{message(error)}</Alert>}
    {saved === "1" && <Alert tone="success">Sua marca foi atualizada.</Alert>}
    <BrandingForm orgId={orgId} brand={brand} />
  </main>;
}
