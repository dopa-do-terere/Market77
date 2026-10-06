import { notFound } from "next/navigation";
import { DashboardOverview } from "@/ui/DashboardOverview";

// Isolated visual fixture: never loads tenant data and never exists in production.
export default function DashboardPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <DashboardOverview base="/ui/dashboard" canCreateMarket={false} today={{ totalCents: 248750, count: 87 }} offline={1} fiscalErrors={0} markets={[
            { id: "aurora", name: "Residencial Aurora", address: "Rua das Palmeiras, 120", lowCount: 3, expired: 0 },
            { id: "jardins", name: "Condomínio Jardins", address: "Av. Central, 850", lowCount: 0, expired: 0 },
            { id: "parque", name: "Parque das Flores", address: "Rua dos Ipês, 42", lowCount: 2, expired: 1 },
          ]} />
  );
}
