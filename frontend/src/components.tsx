import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText, request, statusNames } from "./api";
export type IconName =
  | "grid"
  | "wallet"
  | "arrows"
  | "pulse"
  | "arrow"
  | "plus"
  | "refresh"
  | "search"
  | "close"
  | "check"
  | "clock"
  | "chevron"
  | "leaf"
  | "copy"
  | "external"
  | "shield";
const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V6a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10H5a3 3 0 0 1-3-3V7" />
      <path d="M20 12h-5v5h5" />
    </>
  ),
  arrows: (
    <>
      <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
    </>
  ),
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  arrow: <path d="M6 18 18 6M6 6h12v12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  leaf: (
    <>
      <path d="M19 3C7 1 1 7 5 16c9 4 15-2 14-13Z" />
      <path d="M4 21 15 9" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="3" />
      <path d="M15 8V4H4v11h4" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function useResource<T>(url: string, revision = 0) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    void revision;
    request<T>(url).then(
      (data) => {
        if (active) setState({ data, loading: false });
      },
      (error) => {
        if (active) setState({ error: errorText(error), loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, [url, revision]);
  return state;
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status.toLowerCase()}`}>
      <span />
      {statusNames[status] ?? status}
    </span>
  );
}
export function Empty({
  title,
  children,
  icon = "wallet",
}: {
  title: string;
  children?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" aria-live="polite">
      <span className="spinner" /> Carregando dados locais…
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="error-box" role="alert">
      {message}
    </div>
  );
}
export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const prior = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        closing.current();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-header">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id="dialog-title">{title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Copy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="copy-value">
      <code>{value}</code>
      <button
        type="button"
        className="icon-button small"
        aria-label="Copiar identificador"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={16} />
      </button>
      {failed && <small aria-live="polite">Selecione o ID para copiar.</small>}
    </span>
  );
}
