export type FiscalItem = {
  description: string;
  ncm: string | null;
  cest: string | null;
  cfop: string;
  csosn: string;
  unit: string;
  origin: number;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

/** The snapshot of a paid sale that goes to the provider. Missing fiscal data is null here and refused before issuing. */
export type FiscalPayload = {
  emitter: {
    cnpj: string | null;
    stateRegistration: string | null;
    uf: string | null;
    series: number;
    regime: string;
  };
  customer: { cpf: string } | null;
  items: FiscalItem[];
  totalCents: number;
  paymentMethod: string;
  paidAt: string;
};

export type FiscalIssued = { externalId: string; number: number; accessKey: string; danfeUrl: string };

/** The provider refused the data: retrying cannot help. */
export class FiscalRejected extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FiscalRejected";
  }
}

/** The provider is down or too slow: retry later. */
export class FiscalUnavailable extends Error {
  constructor(message = "fiscal provider unavailable") {
    super(message);
    this.name = "FiscalUnavailable";
  }
}

export interface FiscalProvider {
  name: string;
  /** Idempotent by ref: asking twice with the same ref returns the same note. */
  issueNfce(ref: string, payload: FiscalPayload): Promise<FiscalIssued>;
  /** The note issued for this ref, or null when none was. */
  getByRef(ref: string): Promise<FiscalIssued | null>;
}
