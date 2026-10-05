"use client";
import QRCode from "qrcode";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { formatBRL } from "@/lib/money";
import { formatCpfDraft } from "@/pdv/cpf";
import { paymentNotice } from "@/pdv/notice";
import { createScanner } from "@/pdv/scanner";
import { tokenFromHash } from "@/pdv/token";

const TOKEN_KEY = "m77_terminal_token";

type Item = { id: string; productName: string; quantity: number; unitPriceCents: number };
type Payment = { status: string; method: string; qrPayload: string | null; expiresAt: string } | null;
type PaymentFailure = { method: string; reason: string } | null;
type Sale = {
  id: string;
  status: string;
  totalCents: number;
  items: Item[];
  payment: Payment;
  paymentFailure: PaymentFailure;
  customerCpfMasked: string | null;
};
type Result = { ok: boolean; status: number; data: Partial<Sale> & { error?: string; message?: string } };

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const saveToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the token only lives until the page is closed
  }
};

async function call(token: string, method: string, path: string, body?: unknown): Promise<Result> {
  const res = await fetch(`/api/pdv${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

const page = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  gap: 16,
  padding: 24,
  fontSize: 28,
  fontFamily: "sans-serif",
  textAlign: "center" as const,
};
const keyButton: CSSProperties = { fontSize: 32, height: 72 };
const bigButton = { fontSize: 28, padding: "16px 32px", minWidth: 220 };

function Screen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main style={page}>
      <h1 style={{ fontSize: 40, margin: 0 }}>{title}</h1>
      {children}
    </main>
  );
}

export default function PdvApp() {
  const [token, setToken] = useState<string | null | undefined>(undefined); // undefined: not read yet
  const [sale, setSale] = useState<Sale | null>(null);
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [cpfDraft, setCpfDraft] = useState("");
  const saleRef = useRef<Sale | null>(null);
  saleRef.current = sale;
  const scanChainRef = useRef<Promise<void>>(Promise.resolve());
  const payingRef = useRef(false);
  const flashTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const applySale = useCallback((s: Sale | null) => {
    if (!s || s.status !== "open") setKeypad(false);
    saleRef.current = s;
    setSale(s);
  }, []);

  const flash = useCallback((text: string) => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setNotice(text);
    flashTimeoutRef.current = setTimeout(() => setNotice(""), 4000);
  }, []);

  useEffect(() => {
    // The totem agent opens /pdv#token=...: keep the token and clean the address bar.
    const fromAgent = tokenFromHash(window.location.hash);
    if (fromAgent) {
      saveToken(fromAgent);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      setToken(fromAgent);
      return;
    }
    setToken(readToken());
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Calls the API; handles offline and token problems. Returns null when the call did not complete. */
  const run = useCallback(
    async (method: string, path: string, body?: unknown): Promise<Result | null> => {
      if (!token) return null;
      try {
        const r = await call(token, method, path, body);
        setOffline(false);
        if (r.status === 401) {
          if (r.data.error === "terminal_revoked") setRevoked(true);
          else {
            saveToken(null);
            setToken(null);
          }
          return null;
        }
        return r;
      } catch {
        setOffline(true);
        return null;
      }
    },
    [token],
  );

  const scan = useCallback(
    async (barcode: string) => {
      try {
        const cur = saleRef.current;
        if (payingRef.current || (cur && cur.status !== "open")) return; // paying or not open: ignore scans
        let r = await run("POST", "/sales/items", { saleId: cur?.id, barcode });
        if (cur && (r?.data.error === "sale_not_found" || r?.data.error === "sale_not_editable")) {
          r = await run("POST", "/sales/items", { barcode }); // the cart is gone on the server: start a new one
        }
        if (!r) return;
        if (r.ok) applySale(r.data as Sale);
        else flash(r.data.message ?? "Erro inesperado.");
      } catch {
        // scan must not throw
      }
    },
    [run, flash, applySale],
  );

  useEffect(() => {
    if (!token || offline || revoked) return;
    const feed = createScanner((code) => {
      scanChainRef.current = scanChainRef.current.then(() => scan(code));
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") e.preventDefault();
      feed(e.key, Date.now());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [token, offline, revoked, scan]);

  const saleId = sale?.id;
  useEffect(() => {
    if (!token || !saleId || revoked || sale?.status === "paid") return;
    const id = setInterval(async () => {
      const cur = saleRef.current;
      if (!cur) return;
      const r = await run("GET", `/sales/${cur.id}`);
      if (r?.ok) applySale(r.data as Sale);
      else if (r?.status === 404) applySale(null);
    }, 2000);
    return () => clearInterval(id);
  }, [token, saleId, revoked, sale?.status, run, applySale]);

  useEffect(() => {
    if (!offline) return;
    const id = setInterval(() => void run("GET", "/ping"), 3000);
    return () => clearInterval(id);
  }, [offline, run]);

  useEffect(() => {
    if (!sale) return;
    if (sale.status === "paid") {
      const t = setTimeout(() => applySale(null), 6000);
      return () => clearTimeout(t);
    }
    if (sale.status === "expired" || sale.status === "cancelled") {
      if (sale.status === "expired") flash("Carrinho encerrado por inatividade.");
      applySale(null);
    }
  }, [sale?.status, sale?.id, flash, applySale]);

  const payload =
    sale?.status === "awaiting_payment" && sale.payment?.method !== "card"
      ? (sale.payment?.qrPayload ?? undefined)
      : undefined;
  useEffect(() => {
    if (!payload) {
      setQr("");
      return;
    }
    QRCode.toDataURL(payload, { margin: 1, width: 320 }).then(setQr).catch(() => setQr(""));
  }, [payload]);

  async function connect() {
    const candidate = draft.trim();
    try {
      const res = await call(candidate, "GET", "/ping");
      if (res.ok) {
        saveToken(candidate);
        setToken(candidate);
        setDraft("");
      } else flash(res.data.message ?? "Token inválido.");
    } catch {
      flash("Sem conexão.");
    }
  }

  async function changeQuantity(item: Item, delta: number) {
    if (!sale) return;
    const r = await run("PATCH", `/sales/${sale.id}/items/${item.id}`, { quantity: item.quantity + delta });
    if (r?.ok) applySale(r.data as Sale);
    else if (r) flash(r.data.message ?? "Erro inesperado.");
  }

  async function startPay(method: "pix" | "card") {
    if (!sale) return;
    try {
      payingRef.current = true;
      const r = await run("POST", `/sales/${sale.id}/pay`, { method });
      if (r?.ok) applySale(r.data as Sale);
      else if (r) flash(r.data.message ?? "Erro inesperado.");
    } finally {
      payingRef.current = false;
    }
  }

  async function cancelCardPayment() {
    if (!sale || cancelling) return;
    setCancelling(true);
    try {
      const r = await run("POST", `/sales/${sale.id}/payment/cancel`);
      if (r?.ok) applySale(r.data as Sale);
      else if (r) flash(r.data.message ?? "Erro inesperado.");
    } finally {
      setCancelling(false);
    }
  }

  async function cancel() {
    if (!sale) return;
    await run("POST", `/sales/${sale.id}/cancel`);
    applySale(null);
  }

  async function saveCpf(cpf: string | null) {
    if (!sale) return;
    const r = await run("PUT", `/sales/${sale.id}/customer`, { cpf });
    if (r?.ok) {
      applySale(r.data as Sale);
      setKeypad(false);
      setCpfDraft("");
    } else if (r) flash(r.data.message ?? "Erro inesperado.");
  }

  if (token === undefined) return null;
  if (!token) {
    return (
      <Screen title="Configurar totem">
        <p>Cole o token do totem (gerado no painel, em Totens).</p>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ fontSize: 24, padding: 12, width: "80%" }}
          aria-label="Token do totem"
        />
        <button style={bigButton} onClick={connect} disabled={!draft.trim()}>
          Conectar
        </button>
        {notice && <p role="alert">{notice}</p>}
      </Screen>
    );
  }
  if (revoked) return <Screen title="Totem desativado">Procure o responsável pela loja.</Screen>;
  if (offline) return <Screen title="Totem indisponível">Sem conexão. Tentando novamente...</Screen>;

  if (!sale) {
    return (
      <Screen title="Bem-vindo">
        <p>Escaneie um produto para começar.</p>
        {notice && <p role="alert">{notice}</p>}
      </Screen>
    );
  }
  if (sale.status === "paid") {
    return (
      <Screen title="Obrigado!">
        <p>Pagamento confirmado.</p>
      </Screen>
    );
  }
  if (sale.status === "awaiting_payment" && sale.payment?.method === "card") {
    const left = Math.max(0, Math.round((new Date(sale.payment.expiresAt).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} no cartão`}>
        <p>Siga as instruções na maquininha.</p>
        <p>
          Tempo restante: {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
        {notice && <p role="alert">{notice}</p>}
        <button style={bigButton} onClick={cancelCardPayment} disabled={cancelling}>
          Cancelar
        </button>
      </Screen>
    );
  }
  if (sale.status === "awaiting_payment") {
    const left = Math.max(0, Math.round((new Date(sale.payment?.expiresAt ?? 0).getTime() - now) / 1000));
    return (
      <Screen title={`Pague ${formatBRL(sale.totalCents)} com Pix`}>
        {qr && <img src={qr} alt="QR code do Pix" width={320} height={320} />}
        <p style={{ fontSize: 18, wordBreak: "break-all", maxWidth: 560 }}>{sale.payment?.qrPayload}</p>
        <p>Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>
      </Screen>
    );
  }
  if (keypad) {
    return (
      <Screen title="CPF na nota">
        <p style={{ fontSize: 36, letterSpacing: 2, minHeight: 48 }}>{formatCpfDraft(cpfDraft) || "Digite o CPF"}</p>
        {notice && <p role="alert">{notice}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 96px)", gap: 12, justifyContent: "center" }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} style={keyButton} onClick={() => setCpfDraft((v) => (v + d).slice(0, 11))}>
              {d}
            </button>
          ))}
          <button style={keyButton} onClick={() => setCpfDraft((v) => v.slice(0, -1))} aria-label="Apagar">
            Apagar
          </button>
          <button style={keyButton} onClick={() => setCpfDraft((v) => (v + "0").slice(0, 11))}>
            0
          </button>
          <button style={keyButton} onClick={() => setCpfDraft("")}>
            Limpar
          </button>
        </div>
        <button style={bigButton} onClick={() => saveCpf(cpfDraft)} disabled={cpfDraft.length !== 11}>
          Confirmar
        </button>
        <button style={{ ...bigButton, fontSize: 20 }} onClick={() => saveCpf(null)}>
          Sem CPF
        </button>
        <button
          style={{ ...bigButton, fontSize: 20 }}
          onClick={() => {
            setKeypad(false);
            setCpfDraft("");
          }}
        >
          Voltar
        </button>
      </Screen>
    );
  }
  return (
    <Screen title="Seu carrinho">
      {paymentNotice(sale) && <p role="alert">{paymentNotice(sale)}</p>}
      {notice && <p role="alert">{notice}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {sale.items.map((i) => (
          <li key={i.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center" }}>
            <button style={{ fontSize: 28, width: 56 }} onClick={() => changeQuantity(i, -1)} aria-label="Menos">
              -
            </button>
            <span>
              {i.quantity} x {i.productName} ({formatBRL(i.unitPriceCents)})
            </span>
            <button style={{ fontSize: 28, width: 56 }} onClick={() => changeQuantity(i, 1)} aria-label="Mais">
              +
            </button>
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: {formatBRL(sale.totalCents)}</strong>
      </p>
      <p>{sale.customerCpfMasked ? `CPF na nota: ${sale.customerCpfMasked}` : "Sem CPF na nota"}</p>
      <button style={{ ...bigButton, fontSize: 20 }} onClick={() => setKeypad(true)}>
        {sale.customerCpfMasked ? "Alterar CPF" : "CPF na nota"}
      </button>
      <button style={bigButton} onClick={() => startPay("pix")} disabled={sale.items.length === 0}>
        Pagar com Pix
      </button>
      <button style={bigButton} onClick={() => startPay("card")} disabled={sale.items.length === 0}>
        Pagar com cartão
      </button>
      <button style={{ ...bigButton, fontSize: 20 }} onClick={cancel}>
        Cancelar
      </button>
    </Screen>
  );
}
