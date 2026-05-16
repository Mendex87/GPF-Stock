"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import {
  createAdminUser,
  createCategory,
  createItem,
  createLocation,
  createPhysicalAdjustment,
  createStockEntry,
  createStockExit,
  loadCatalogs,
  loadProfile,
  saveCustomer,
  setCustomerActive,
  setItemActive,
  setLocationActive,
  updateItem,
  uploadItemPhoto,
} from "@/lib/api";
import { createBrowserSupabaseClient, usernameToEmail } from "@/lib/supabase";
import type {
  AdminUser,
  Category,
  Customer,
  Item,
  Location,
  Profile,
  ReplenishmentItem,
  StockMovement,
  UnitOfMeasure,
} from "@/lib/types";

type View =
  | "dashboard"
  | "items"
  | "entry"
  | "exit"
  | "inventory"
  | "customers"
  | "locations"
  | "history"
  | "labels"
  | "replenishment"
  | "admin";

type LayoutMode = "desktop" | "mobile";

type ModuleTone = "cyan" | "green" | "orange" | "red" | "yellow" | "blue";
type ItemStatusFilter = "all" | "active" | "inactive";
type ItemStockFilter = "all" | "negative" | "low" | "ok" | "no-location";
type ItemSort = "code" | "name" | "stock-asc" | "stock-desc";

type AppData = {
  categories: Category[];
  units: UnitOfMeasure[];
  locations: Location[];
  customers: Customer[];
  items: Item[];
  movements: StockMovement[];
  replenishment: ReplenishmentItem[];
  adminUsers: AdminUser[];
};

type ActionRunner = (
  label: string,
  action: () => Promise<void>,
) => Promise<void>;

const emptyData: AppData = {
  categories: [],
  units: [],
  locations: [],
  customers: [],
  items: [],
  movements: [],
  replenishment: [],
  adminUsers: [],
};

const navItems: Array<{ view: View; label: string; adminOnly?: boolean }> = [
  { view: "dashboard", label: "Panel" },
  { view: "items", label: "Items" },
  { view: "entry", label: "Entrada" },
  { view: "exit", label: "Salida" },
  { view: "inventory", label: "Inventario" },
  { view: "customers", label: "Clientes" },
  { view: "locations", label: "Ubicaciones" },
  { view: "history", label: "Historial" },
  { view: "labels", label: "Etiquetas" },
  { view: "replenishment", label: "Reposicion" },
  { view: "admin", label: "Admin", adminOnly: true },
];

const APP_VERSION = "1.0.0";

const dashboardModules: Array<{
  view: View;
  label: string;
  shortLabel: string;
  meta: string;
  icon: string;
  tone: ModuleTone;
}> = [
  {
    view: "items",
    label: "Items",
    shortLabel: "Items",
    meta: "Catalogo + QR",
    icon: "/icons/gpf-new/items-catalog.png",
    tone: "cyan",
  },
  {
    view: "customers",
    label: "Clientes",
    shortLabel: "Clientes",
    meta: "Asignacion taller",
    icon: "/icons/gpf-new/clients.png",
    tone: "red",
  },
  {
    view: "history",
    label: "Historial",
    shortLabel: "Historial",
    meta: "Trazabilidad",
    icon: "/icons/gpf-new/history.png",
    tone: "orange",
  },
  {
    view: "labels",
    label: "Etiquetas",
    shortLabel: "Etiquetas",
    meta: "PDF / escaneo",
    icon: "/icons/gpf-new/labels-qr.png",
    tone: "blue",
  },
  {
    view: "replenishment",
    label: "Reposicion",
    shortLabel: "Reposicion",
    meta: "Minimos activos",
    icon: "/icons/gpf-new/replenishment.png",
    tone: "yellow",
  },
  {
    view: "locations",
    label: "Ubicaciones",
    shortLabel: "Ubicaciones",
    meta: "Rack / zona",
    icon: "/icons/gpf-new/locations.png",
    tone: "green",
  },
];

const ITEMS_PAGE_SIZE = 10;

export function GpfCloudApp() {
  const [client] = useState<SupabaseClient | null>(() =>
    createBrowserSupabaseClient(),
  );
  const layoutMode = useLayoutMode();
  const [booting, setBooting] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [data, setData] = useState<AppData>(emptyData);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [loadingData, setLoadingData] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setBooting(false);
      return;
    }
    const supabase = client;
    let mounted = true;

    async function boot() {
      try {
        const { data: sessionData } = await withTimeout(
          supabase.auth.getSession(),
          5000,
          "No se pudo verificar la sesion local. Mostrando login.",
        );
        if (mounted) setAuthUser(sessionData.session?.user ?? null);
      } catch (bootError) {
        if (mounted) setError(errorMessage(bootError));
      } finally {
        if (mounted) setBooting(false);
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAuthUser(session?.user ?? null);
      },
    );

    void boot();
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (client && profile) {
      void refresh();
    }
  }, [client, profile?.id]);

  useEffect(() => {
    if (!client || booting) return;

    if (!authUser) {
      setProfile(null);
      setData(emptyData);
      setProfileLoading(false);
      return;
    }

    const supabase = client;
    const user = authUser;
    let cancelled = false;

    async function loadGpfProfile() {
      setProfileLoading(true);
      setError(null);
      try {
        const appProfile = await withTimeout(
          loadProfile(supabase, user.id),
          8000,
          "Supabase tardo demasiado en cargar el perfil GPF.",
        );
        if (cancelled) return;

        if (!appProfile || !appProfile.isActive) {
          setError("El usuario no tiene un perfil GPF activo.");
          setProfile(null);
          setData(emptyData);
          await supabase.auth.signOut();
          if (!cancelled) setAuthUser(null);
          return;
        }

        setProfile(appProfile);
      } catch (profileError) {
        if (!cancelled) {
          setError(errorMessage(profileError));
          setProfile(null);
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    void loadGpfProfile();
    return () => {
      cancelled = true;
    };
  }, [client, booting, authUser?.id, profileRetry]);

  async function refresh() {
    if (!client) return;
    setLoadingData(true);
    setError(null);
    try {
      setData(await loadCatalogs(client));
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setLoadingData(false);
    }
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setWorking(label);
    setError(null);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(`${label}: listo.`);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setWorking(null);
    }
  }

  async function signOut() {
    await client?.auth.signOut();
    setAuthUser(null);
    setProfile(null);
    setData(emptyData);
    setActiveView("dashboard");
  }

  if (!client) return <EnvMissing />;
  if (booting) return <Splash />;
  if (authUser && !profile) {
    return (
      <ProfileLoading
        error={error}
        loading={profileLoading}
        onRetry={() => setProfileRetry((value) => value + 1)}
        onSignOut={signOut}
      />
    );
  }
  if (!profile)
    return <LoginScreen client={client} onError={setError} error={error} />;

  const visibleData = filterByRole(data, profile);
  const activeScreen = (
    <ActiveScreen
      activeView={activeView}
      layoutMode={layoutMode}
      client={client}
      visibleData={visibleData}
      data={data}
      profile={profile}
      runAction={runAction}
      setActiveView={setActiveView}
    />
  );

  if (layoutMode === "mobile") {
    return (
      <MobileShell
        activeView={activeView}
        data={visibleData}
        profile={profile}
        loadingData={loadingData}
        notice={notice}
        error={error}
        working={working}
        setActiveView={setActiveView}
        refresh={refresh}
        signOut={signOut}
      >
        {activeScreen}
      </MobileShell>
    );
  }

  return (
    <div className="cloud-shell">
      <aside className="rail">
        <div className="brand-lockup">
          <img src="/brand/app-icon.png" alt="GPF" />
          <div>
            <strong>GPF Cloud</strong>
            <span>{profile.isAdmin ? "Admin tecnico" : "Operacion"}</span>
          </div>
        </div>
        <nav>
          {navItems
            .filter((item) => !item.adminOnly || profile.isAdmin)
            .map((item) => (
              <button
                type="button"
                key={item.view}
                className={activeView === item.view ? "active" : ""}
                onClick={() => setActiveView(item.view)}
              >
                {item.label}
              </button>
            ))}
        </nav>
        <div className="rail-footer">
          <span>{profile.displayName}</span>
          <span className="app-version">GPF Cloud v{APP_VERSION}</span>
          <button type="button" onClick={signOut}>
            Salir
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Supabase conectado</p>
            <h1>{titleFor(activeView)}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="ghost"
              type="button"
              onClick={refresh}
              disabled={loadingData}
            >
              Recargar
            </button>
            <button className="danger ghost" type="button" onClick={signOut}>
              Cerrar sesion
            </button>
          </div>
        </header>

        <OpsTicker data={visibleData} />

        {(notice || error || working) && (
          <div className={`status-line ${error ? "error" : ""}`}>
            {working ?? error ?? notice}
          </div>
        )}

        <section className="screen-card">{activeScreen}</section>
      </main>
    </div>
  );
}

function ActiveScreen({
  activeView,
  layoutMode,
  client,
  visibleData,
  data,
  profile,
  runAction,
  setActiveView,
}: {
  activeView: View;
  layoutMode: LayoutMode;
  client: SupabaseClient;
  visibleData: AppData;
  data: AppData;
  profile: Profile;
  runAction: ActionRunner;
  setActiveView: (view: View) => void;
}) {
  if (activeView === "dashboard") {
    return layoutMode === "mobile" ? (
      <DashboardMobile
        data={visibleData}
        profile={profile}
        setView={setActiveView}
      />
    ) : (
      <Dashboard data={visibleData} profile={profile} setView={setActiveView} />
    );
  }
  if (activeView === "items")
    return (
      <ItemsView
        client={client}
        data={visibleData}
        profile={profile}
        runAction={runAction}
      />
    );
  if (activeView === "entry")
    return (
      <EntryView
        client={client}
        items={visibleData.items}
        runAction={runAction}
      />
    );
  if (activeView === "exit")
    return (
      <ExitView
        client={client}
        items={visibleData.items}
        customers={visibleData.customers}
        runAction={runAction}
      />
    );
  if (activeView === "inventory")
    return (
      <InventoryView
        client={client}
        items={visibleData.items}
        runAction={runAction}
      />
    );
  if (activeView === "customers")
    return (
      <CustomersView
        client={client}
        customers={visibleData.customers}
        profile={profile}
        runAction={runAction}
      />
    );
  if (activeView === "locations")
    return (
      <LocationsView
        client={client}
        locations={visibleData.locations}
        profile={profile}
        runAction={runAction}
      />
    );
  if (activeView === "history")
    return (
      <HistoryView
        movements={visibleData.movements}
        items={visibleData.items}
      />
    );
  if (activeView === "labels") return <LabelsView items={visibleData.items} />;
  if (activeView === "replenishment")
    return (
      <ReplenishmentView
        rows={visibleData.replenishment}
        setView={setActiveView}
      />
    );
  if (activeView === "admin" && profile.isAdmin)
    return <AdminView client={client} data={data} runAction={runAction} />;
  return (
    <Dashboard data={visibleData} profile={profile} setView={setActiveView} />
  );
}

function OpsTicker({ data, compact = false }: { data: AppData; compact?: boolean }) {
  const items = buildOpsTickerItems(data);

  return (
    <div className={`ops-ticker ${compact ? "compact" : ""}`} aria-hidden="true">
      <div className="ops-ticker-track">
        {[...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function buildOpsTickerItems(data: AppData) {
  const activeItems = data.items.filter((item) => item.isActive);
  const negative = activeItems.filter((item) => item.currentStock < 0);
  const low = activeItems.filter(
    (item) =>
      item.minimumStock !== null &&
      item.currentStock >= 0 &&
      item.currentStock <= item.minimumStock,
  );
  const withoutLocation = activeItems.filter((item) => !item.locationId);
  const activeCustomers = data.customers.filter((customer) => customer.isActive);
  const stockValue = activeItems.reduce(
    (sum, item) => sum + item.currentStock * (item.currentPurchaseCost ?? 0),
    0,
  );
  const latestMovement = [...data.movements].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )[0];
  const priorityItem = negative[0] ?? low[0];

  return [
    priorityItem
      ? `${negative[0] ? "STOCK NEGATIVO" : "BAJO MINIMO"}: ${priorityItem.code} · ${formatNumber(priorityItem.currentStock)} ${priorityItem.unitSymbol}`
      : "SIN ALERTAS DE STOCK",
    `REPOSICION: ${data.replenishment.length} items pendientes`,
    latestMovement
      ? `ULTIMO MOV: ${latestMovement.typeLabel} ${latestMovement.number ?? `#${latestMovement.id}`} · ${latestMovement.lines.length} lineas`
      : "SIN MOVIMIENTOS REGISTRADOS",
    `ITEMS ACTIVOS: ${activeItems.length}`,
    `SIN UBICACION: ${withoutLocation.length}`,
    `CLIENTES ACTIVOS: ${activeCustomers.length}`,
    `VALOR STOCK: ${currency(stockValue)}`,
  ];
}

function MobileShell({
  activeView,
  data,
  profile,
  loadingData,
  notice,
  error,
  working,
  setActiveView,
  refresh,
  signOut,
  children,
}: {
  activeView: View;
  data: AppData;
  profile: Profile;
  loadingData: boolean;
  notice: string | null;
  error: string | null;
  working: string | null;
  setActiveView: (view: View) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const primaryNav: View[] = [
    "dashboard",
    "items",
    "entry",
    "exit",
    "inventory",
  ];
  const availableNav = navItems.filter(
    (item) => !item.adminOnly || profile.isAdmin,
  );

  return (
    <div className="mobile-shell">
      <header className="mobile-topbar">
        <div className="mobile-brand">
          <img src="/brand/app-icon.png" alt="GPF" />
          <div>
            <strong>GPF Cloud</strong>
            <span>{profile.displayName}</span>
            <span className="app-version">v{APP_VERSION}</span>
          </div>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => void refresh()}
          disabled={loadingData}
        >
          Recargar
        </button>
      </header>

      <div className="mobile-section-switcher">
        <label>
          Pantalla
          <select
            value={activeView}
            onChange={(event) => setActiveView(event.target.value as View)}
          >
            {availableNav.map((item) => (
              <option key={item.view} value={item.view}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="danger ghost"
          onClick={() => void signOut()}
        >
          Salir
        </button>
      </div>

      <OpsTicker data={data} compact />

      {(notice || error || working) && (
        <div className={`status-line ${error ? "error" : ""}`}>
          {working ?? error ?? notice}
        </div>
      )}

      <main className="mobile-workspace">{children}</main>

      <nav className="mobile-bottom-nav" aria-label="Navegacion movil">
        {primaryNav.map((view) => {
          const item = navItems.find((candidate) => candidate.view === view)!;
          return (
            <button
              type="button"
              key={view}
              className={activeView === view ? "active" : ""}
              onClick={() => setActiveView(view)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function EnvMissing() {
  return (
    <div className="login-stage">
      <div className="env-card">
        <img src="/brand/app-icon.png" alt="GPF" />
        <h1>Faltan variables de entorno</h1>
        <p>
          Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en
          Vercel o en .env.local.
        </p>
      </div>
    </div>
  );
}

function Splash() {
  return (
    <div className="login-stage">
      <div className="splash-mark">
        <img src="/brand/app-icon.png" alt="GPF" />
        <span>Inicializando GPF Cloud...</span>
      </div>
    </div>
  );
}

function ProfileLoading({
  error,
  loading,
  onRetry,
  onSignOut,
}: {
  error: string | null;
  loading: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="login-stage">
      <div className="splash-mark">
        <img src="/brand/app-icon.png" alt="GPF" />
        <span>
          {loading ? "Cargando perfil GPF..." : "No se pudo cargar el perfil."}
        </span>
        {error && <div className="form-error">{error}</div>}
        <div className="topbar-actions">
          <button type="button" onClick={onRetry}>
            Reintentar
          </button>
          <button type="button" className="ghost danger" onClick={onSignOut}>
            Volver al login
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({
  client,
  onError,
  error,
}: {
  client: SupabaseClient;
  onError: (value: string | null) => void;
  error: string | null;
}) {
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setLoading(true);
    onError(null);
    try {
      const { error: loginError } = await client.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (loginError) throw loginError;
    } catch (loginError) {
      onError(errorMessage(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-stage">
      <div className="login-art">
        <img src="/brand/app-icon.png" alt="GPF" />
        <p>Inventario cloud para taller, mostrador y campo.</p>
      </div>
      <form className="login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Acceso privado</p>
        <h1>GPF Cloud</h1>
        <label>
          Usuario
          <input
            name="username"
            autoComplete="username"
            placeholder="admin"
            required
          />
        </label>
        <label>
          Clave
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={loading}>
          {loading ? "Entrando..." : "Entrar al sistema"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({
  data,
  profile,
  setView,
}: {
  data: AppData;
  profile: Profile;
  setView: (view: View) => void;
}) {
  const activeItems = data.items.filter((item) => item.isActive);
  const negative = activeItems.filter((item) => item.currentStock < 0);
  const low = activeItems.filter(
    (item) =>
      item.minimumStock !== null &&
      item.currentStock >= 0 &&
      item.currentStock <= item.minimumStock,
  );
  const stockValue = activeItems.reduce(
    (sum, item) => sum + item.currentStock * (item.currentPurchaseCost ?? 0),
    0,
  );

  return (
    <div className="dashboard-grid">
      <div className="hero-panel">
        <div>
          <p className="eyebrow">Bienvenido, {profile.displayName}</p>
          <div className="system-badges">
            <span>OPERACION LOCAL</span>
            <span>QR READY</span>
            <span>STOCK LIVE</span>
          </div>
        </div>
        <h2>
          Operaciones del taller: entradas, salidas, inventario y reposicion.
        </h2>
        <div className="hero-actions">
          <button className="danger" onClick={() => setView("exit")}>
            <img src="/icons/gpf-new/stock-exit.png" alt="" />
            Registrar salida
          </button>
          <button className="primary" onClick={() => setView("entry")}>
            <img src="/icons/gpf-new/stock-entry.png" alt="" />
            Registrar entrada
          </button>
          <button className="ghost" onClick={() => setView("inventory")}>
            <img src="/icons/gpf-new/inventory.png" alt="" />
            Inventario fisico
          </button>
        </div>
      </div>
      <Metric
        label="Items activos"
        value={activeItems.length.toString()}
        tone="cyan"
      />
      <Metric
        label="Alertas"
        value={(negative.length + low.length).toString()}
        tone={negative.length ? "red" : "orange"}
      />
      <Metric
        label="Valor estimado"
        value={currency(stockValue)}
        tone="steel"
      />
      <div className="quick-grid">
        {dashboardModules.map((module, index) => (
          <button
            key={module.view}
            className={`quick-tile tone-${module.tone}`}
            onClick={() => setView(module.view)}
            aria-label={`Abrir ${module.label}`}
          >
            <span className="quick-tile-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="quick-tile-light" aria-hidden="true" />
            <span className="quick-tile-icon">
              <img src={module.icon} alt="" />
            </span>
            <span className="quick-tile-copy">
              <b>{module.label}</b>
              <small>{module.meta}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="alert-panel">
        <h3>Prioridad operativa</h3>
        {negative
          .concat(low)
          .slice(0, 8)
          .map((item) => (
            <div className="alert-row" key={item.id}>
              <strong>{item.code}</strong>
              <span>{item.name}</span>
              <b>
                {formatNumber(item.currentStock)} {item.unitSymbol}
              </b>
            </div>
          ))}
        {!negative.length && !low.length && (
          <p className="muted">No hay alertas de stock activas.</p>
        )}
      </div>
    </div>
  );
}

function DashboardMobile({
  data,
  profile,
  setView,
}: {
  data: AppData;
  profile: Profile;
  setView: (view: View) => void;
}) {
  const activeItems = data.items.filter((item) => item.isActive);
  const negative = activeItems.filter((item) => item.currentStock < 0);
  const low = activeItems.filter(
    (item) =>
      item.minimumStock !== null &&
      item.currentStock >= 0 &&
      item.currentStock <= item.minimumStock,
  );
  const alerts = negative.concat(low);

  return (
    <div className="mobile-dashboard">
      <section className="mobile-ops-panel">
        <p className="eyebrow">Operacion</p>
        <h2>Trabajo rapido del taller</h2>
        <div className="mobile-primary-actions">
          <button
            className="danger"
            type="button"
            onClick={() => setView("exit")}
          >
            <img src="/icons/gpf-new/stock-exit.png" alt="" />
            Salida
          </button>
          <button
            className="primary"
            type="button"
            onClick={() => setView("entry")}
          >
            <img src="/icons/gpf-new/stock-entry.png" alt="" />
            Entrada
          </button>
          <button type="button" onClick={() => setView("inventory")}>
            <img src="/icons/gpf-new/inventory.png" alt="" />
            Inventario
          </button>
        </div>
      </section>

      <section className="mobile-metrics-row">
        <Metric
          label="Items"
          value={activeItems.length.toString()}
          tone="cyan"
        />
        <Metric
          label="Alertas"
          value={alerts.length.toString()}
          tone={negative.length ? "red" : "orange"}
        />
      </section>

      <section className="mobile-shortcuts">
        {dashboardModules.map((module, index) => (
          <button
            key={module.view}
            className={`mobile-shortcut tone-${module.tone}`}
            type="button"
            onClick={() => setView(module.view)}
            aria-label={`Abrir ${module.label}`}
          >
            <span className="mobile-shortcut-code">M{index + 1}</span>
            <img src={module.icon} alt="" />
            <span>{module.shortLabel}</span>
          </button>
        ))}
        {profile.isAdmin && (
          <button
            className="mobile-shortcut tone-red"
            type="button"
            onClick={() => setView("admin")}
          >
            <span className="mobile-shortcut-code">ADM</span>
            <img src="/icons/gpf-new/admin-settings.png" alt="" />
            <span>Admin</span>
          </button>
        )}
      </section>

      <section className="mobile-alerts-panel">
        <div>
          <p className="eyebrow">Prioridad</p>
          <h3>Alertas de stock</h3>
        </div>
        {alerts.slice(0, 5).map((item) => (
          <button
            key={item.id}
            className="mobile-alert-row"
            type="button"
            onClick={() => setView("items")}
          >
            <strong>{item.code}</strong>
            <span>{item.name}</span>
            <b>
              {formatNumber(item.currentStock)} {item.unitSymbol}
            </b>
          </button>
        ))}
        {!alerts.length && <p className="muted">Sin alertas activas.</p>}
      </section>
    </div>
  );
}

function ItemsView({
  client,
  data,
  profile,
  runAction,
}: {
  client: SupabaseClient;
  data: AppData;
  profile: Profile;
  runAction: ActionRunner;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ItemStatusFilter>("all");
  const [stockFilter, setStockFilter] = useState<ItemStockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [sortMode, setSortMode] = useState<ItemSort>("code");
  const [editing, setEditing] = useState<Item | null>(null);
  const [viewing, setViewing] = useState<Item | null>(null);
  const [page, setPage] = useState(1);
  const activeItems = data.items.filter((item) => item.isActive);
  const lowItems = activeItems.filter((item) => itemStockTone(item) === "orange");
  const negativeItems = activeItems.filter((item) => itemStockTone(item) === "red");
  const noLocationItems = activeItems.filter((item) => !item.locationId);
  const archivedItems = data.items.filter((item) => !item.isActive);
  const categoryOptions = data.categories.filter((category) => category.isActive);
  const locationOptions = data.locations.filter((location) => location.isActive);
  const hasFilters =
    query.trim() ||
    statusFilter !== "all" ||
    stockFilter !== "all" ||
    categoryFilter !== "all" ||
    locationFilter !== "all" ||
    sortMode !== "code";
  const items = sortItems(
    search(data.items, query, itemSearchText)
      .filter((item) =>
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? item.isActive
            : !item.isActive,
      )
      .filter((item) =>
        categoryFilter === "all" ? true : item.categoryId === Number(categoryFilter),
      )
      .filter((item) =>
        locationFilter === "all"
          ? true
          : locationFilter === "none"
            ? !item.locationId
            : item.locationId === Number(locationFilter),
      )
      .filter((item) => matchesItemStockFilter(item, stockFilter)),
    sortMode,
  );
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstIndex = (currentPage - 1) * ITEMS_PAGE_SIZE;
  const pageItems = items.slice(firstIndex, firstIndex + ITEMS_PAGE_SIZE);
  const firstVisible = items.length ? firstIndex + 1 : 0;
  const lastVisible = Math.min(firstIndex + ITEMS_PAGE_SIZE, items.length);

  useEffect(() => {
    setPage(1);
  }, [
    query,
    statusFilter,
    stockFilter,
    categoryFilter,
    locationFilter,
    sortMode,
    data.items.length,
  ]);

  return (
    <div className="two-column items-layout">
      <div className="items-panel">
        <div className="items-hero">
          <SectionHeader
            title="Items"
            subtitle="Catalogo maestro, QR, foto y stock actual"
          />
          <div className="items-kpis" aria-label="Resumen de items">
            <ItemKpi label="Activos" value={activeItems.length} tone="cyan" />
            <ItemKpi label="Bajo min." value={lowItems.length} tone="orange" />
            <ItemKpi label="Negativos" value={negativeItems.length} tone="red" />
            <ItemKpi label="Sin ubic." value={noLocationItems.length} tone="green" />
            {profile.isAdmin && (
              <ItemKpi label="Archivados" value={archivedItems.length} tone="steel" />
            )}
          </div>
        </div>

        <div className="items-toolbar">
          <label className="items-search">
            Busqueda operativa
            <input
              className="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Codigo, nombre, categoria, ubicacion, notas..."
            />
          </label>
          <label>
            Estado
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as ItemStatusFilter)
              }
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              {profile.isAdmin && <option value="inactive">Archivados</option>}
            </select>
          </label>
          <label>
            Stock
            <select
              value={stockFilter}
              onChange={(event) =>
                setStockFilter(event.target.value as ItemStockFilter)
              }
            >
              <option value="all">Todos</option>
              <option value="negative">Negativo</option>
              <option value="low">Bajo minimo</option>
              <option value="ok">OK</option>
              <option value="no-location">Sin ubicacion</option>
            </select>
          </label>
          <label>
            Categoria
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ubicacion
            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value="all">Todas</option>
              <option value="none">Sin ubicacion</option>
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.displayCode} · {location.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Orden
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as ItemSort)}
            >
              <option value="code">Codigo</option>
              <option value="name">Nombre</option>
              <option value="stock-asc">Menor stock</option>
              <option value="stock-desc">Mayor stock</option>
            </select>
          </label>
          <div className="items-toolbar-actions">
            <strong>{items.length} resultados</strong>
            {hasFilters && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setStockFilter("all");
                  setCategoryFilter("all");
                  setLocationFilter("all");
                  setSortMode("code");
                }}
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
        <div className="item-list">
          {pageItems.map((item) => (
            <article
              className={`item-card stock-${itemStockTone(item)} ${!item.isActive ? "inactive" : ""}`}
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setViewing(item)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setViewing(item);
                }
              }}
            >
              <div className="item-media">
                <ItemPhotoThumb item={item} />
              </div>
              <div className="item-summary">
                <div className="item-summary-top">
                  <p className="code">{item.code}</p>
                  <span className={`item-state stock-${itemStockTone(item)}`}>
                    {itemStockLabel(item)}
                  </span>
                </div>
                <h3>{item.name}</h3>
                <div className="item-tags">
                  <span>{item.categoryName}</span>
                  <span>{item.locationName ?? "Sin ubicacion"}</span>
                  {!item.isActive && <span>Archivado</span>}
                </div>
                <strong className={`item-stock stock-${itemStockTone(item)}`}>
                  {formatNumber(item.currentStock)} {item.unitSymbol}
                </strong>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setViewing(item);
                  }}
                >
                  Ver
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditing(item);
                  }}
                >
                  Editar
                </button>
                {profile.isAdmin && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      runAction(
                        item.isActive ? "Item archivado" : "Item reactivado",
                        () => setItemActive(client, item.id, !item.isActive),
                      );
                    }}
                  >
                    {item.isActive ? "Archivar" : "Reactivar"}
                  </button>
                )}
              </div>
            </article>
          ))}
          {!items.length && <EmptyState title="Sin items para mostrar" />}
        </div>
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={items.length}
          firstVisible={firstVisible}
          lastVisible={lastVisible}
          onPrevious={() => setPage((value) => Math.max(1, value - 1))}
          onNext={() => setPage((value) => Math.min(totalPages, value + 1))}
        />
      </div>
      <div>
        <FormPanel
          title="Nuevo item"
          subtitle="El codigo se genera con el prefijo de la categoria"
        >
          <form
            onSubmit={(event) =>
              submitForm(event, (form) =>
                runAction("Item creado", () => createItem(client, form)),
              )
            }
          >
            <ItemFields
              categories={data.categories}
              units={data.units}
              locations={data.locations}
            />
            <button className="primary">Crear item</button>
          </form>
        </FormPanel>
      </div>
      {editing && (
        <Modal
          title={`Editar ${editing.code}`}
          onClose={() => setEditing(null)}
        >
          <ItemPhotoEditor
            item={editing}
            onUpload={(file) =>
              runAction("Foto actualizada", async () => {
                const preparedFile = await prepareItemPhotoFile(file);
                const photoPath = await uploadItemPhoto(
                  client,
                  editing.id,
                  preparedFile,
                );
                setEditing((current) =>
                  current && current.id === editing.id
                    ? { ...current, photoPath }
                    : current,
                );
              })
            }
          />
          <form
            onSubmit={(event) =>
              submitForm(event, async (form) => {
                await runAction("Item actualizado", () =>
                  updateItem(client, editing, form),
                );
                setEditing(null);
              })
            }
          >
            <ItemFields
              categories={data.categories}
              units={data.units}
              locations={data.locations}
              item={editing}
            />
            <button className="primary">Guardar cambios</button>
          </form>
        </Modal>
      )}
      {viewing && (
        <ItemDetailModal
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={(item) => {
            setViewing(null);
            setEditing(item);
          }}
        />
      )}
    </div>
  );
}

function EntryView({
  client,
  items,
  runAction,
}: {
  client: SupabaseClient;
  items: Item[];
  runAction: ActionRunner;
}) {
  const [itemId, setItemId] = useState<number | null>(null);
  const selected = items.find((item) => item.id === itemId) ?? null;
  return (
    <OperationPanel
      title="Entrada rapida"
      subtitle="Suma stock y actualiza costo de compra"
      accent="cyan"
    >
      <QrScanner items={items} onItem={(item) => setItemId(item.id)} />
      <form
        onSubmit={(event) =>
          submitForm(event, (form) =>
            runAction("Entrada registrada", () =>
              createStockEntry(
                client,
                numInput(form, "itemId"),
                numInput(form, "quantity"),
                nullableInput(form, "unitCost"),
              ),
            ),
          )
        }
      >
        <ItemSelect
          items={items}
          value={itemId}
          onChange={setItemId}
          name="itemId"
          required
        />
        <label>
          {" "}
          Cantidad{" "}
          <input
            name="quantity"
            type="number"
            step="0.001"
            min="0"
            required
          />{" "}
        </label>
        <label>
          {" "}
          Costo unitario{" "}
          <input
            name="unitCost"
            type="number"
            step="0.01"
            min="0"
            defaultValue={selected?.currentPurchaseCost ?? ""}
          />{" "}
        </label>
        {selected && <ItemStrip item={selected} />}
        <button className="primary">Guardar entrada</button>
      </form>
    </OperationPanel>
  );
}

type ExitLine = { key: string; itemId: number; quantity: number };

function ExitView({
  client,
  items,
  customers,
  runAction,
}: {
  client: SupabaseClient;
  items: Item[];
  customers: Customer[];
  runAction: ActionRunner;
}) {
  const [lines, setLines] = useState<ExitLine[]>([]);
  const [draftItemId, setDraftItemId] = useState<number | null>(null);
  const [draftQuantity, setDraftQuantity] = useState("1");
  const draftItem = items.find((item) => item.id === draftItemId) ?? null;
  const totalQuantity = lines.reduce((total, line) => total + line.quantity, 0);

  function addDraftLine() {
    if (!draftItemId) {
      alert("Selecciona un item para agregar a la salida.");
      return;
    }

    const quantity = Number(draftQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      alert("Ingresa una cantidad valida mayor a cero.");
      return;
    }

    setLines((current) => {
      const existing = current.find((line) => line.itemId === draftItemId);
      if (existing) {
        return current.map((line) =>
          line.itemId === draftItemId
            ? { ...line, quantity: line.quantity + quantity }
            : line,
        );
      }
      return [
        ...current,
        { key: crypto.randomUUID(), itemId: draftItemId, quantity },
      ];
    });
    setDraftItemId(null);
    setDraftQuantity("1");
  }

  function updateLineQuantity(key: string, quantity: string) {
    const parsed = Number(quantity);
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, quantity: Number.isFinite(parsed) ? parsed : 0 }
          : line,
      ),
    );
  }

  return (
    <OperationPanel
      title="Salida rapida"
      subtitle="Descuenta una o varias piezas y genera numero SAL"
      accent="red"
    >
      <div className="exit-builder">
        <section className="exit-step">
          <div>
            <p className="eyebrow">Paso 1</p>
            <h3>Agregar items y cantidades</h3>
          </div>
          <QrScanner
            items={items}
            onItem={(item) => {
              setDraftItemId(item.id);
              setDraftQuantity("1");
            }}
          />
          <div className="exit-add-row">
            <ItemSelect
              items={items}
              value={draftItemId}
              onChange={setDraftItemId}
            />
            <label>
              Cantidad
              <input
                value={draftQuantity}
                onChange={(event) => setDraftQuantity(event.target.value)}
                type="number"
                step="0.001"
                min="0"
                placeholder="Cant."
              />
            </label>
            <button type="button" className="primary" onClick={addDraftLine}>
              Agregar
            </button>
          </div>
          {draftItem && <ItemStrip item={draftItem} />}
        </section>

        <section className="exit-step">
          <div className="exit-step-header">
            <div>
              <p className="eyebrow">Paso 2</p>
              <h3>Revisar salida</h3>
            </div>
            <strong>
              {lines.length} items · {formatNumber(totalQuantity)} unidades
            </strong>
          </div>
          {!lines.length && (
            <EmptyState title="Todavia no agregaste items a la salida" />
          )}
          {!!lines.length && (
            <div className="exit-lines">
              {lines.map((line) => {
                const item = items.find(
                  (candidate) => candidate.id === line.itemId,
                );
                if (!item) return null;
                const nextStock = item.currentStock - line.quantity;
                return (
                  <article className="exit-line" key={line.key}>
                    <div>
                      <p className="code">{item.code}</p>
                      <strong>{item.name}</strong>
                      <span>
                        Stock actual {formatNumber(item.currentStock)} {item.unitSymbol} · queda {formatNumber(nextStock)} {item.unitSymbol}
                      </span>
                    </div>
                    <label>
                      Cantidad
                      <input
                        value={line.quantity}
                        onChange={(event) =>
                          updateLineQuantity(line.key, event.target.value)
                        }
                        type="number"
                        step="0.001"
                        min="0"
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((row) => row.key !== line.key),
                        )
                      }
                    >
                      Quitar
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <form
          className="exit-step exit-confirm"
          onSubmit={(event) =>
            submitForm(event, (form) => {
              const payloadLines = lines
                .map((line) => ({
                  itemId: line.itemId,
                  quantity: line.quantity,
                }))
                .filter((line) => line.itemId > 0 && line.quantity > 0);
              if (!payloadLines.length)
                throw new Error("Agrega al menos una linea valida.");

              const confirmed = window.confirm(
                `Confirmar salida de ${payloadLines.length} items por ${formatNumber(totalQuantity)} unidades?`,
              );
              if (!confirmed) return Promise.resolve(false);

              return runAction("Salida registrada", async () => {
                await createStockExit(client, {
                  customerId: nullableInput(form, "customerId"),
                  customerName: textInput(form, "customerName"),
                  workDescription: textInput(form, "workDescription"),
                  workOrderNumber: textInput(form, "workOrderNumber"),
                  notes: textInput(form, "notes"),
                  lines: payloadLines,
                });
                setLines([]);
                setDraftItemId(null);
                setDraftQuantity("1");
              });
            })
          }
        >
          <div className="exit-step-header">
            <div>
              <p className="eyebrow">Paso 3</p>
              <h3>Cliente y confirmacion</h3>
            </div>
            <strong>
              {lines.length ? "Lista para confirmar" : "Agrega items primero"}
            </strong>
          </div>
          <label>
            Cliente guardado
            <select name="customerId" defaultValue="">
              <option value="">Sin cliente</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cliente rapido
            <input
              name="customerName"
              placeholder="Nombre si no esta cargado"
            />
          </label>
          <label>
            Trabajo <input name="workDescription" />
          </label>
          <label>
            Orden <input name="workOrderNumber" />
          </label>
          <label>
            Notas <textarea name="notes" rows={3} />
          </label>
          <button className="primary danger" disabled={!lines.length}>
            Confirmar salida
          </button>
        </form>
      </div>
    </OperationPanel>
  );
}

function InventoryView({
  client,
  items,
  runAction,
}: {
  client: SupabaseClient;
  items: Item[];
  runAction: ActionRunner;
}) {
  const [itemId, setItemId] = useState<number | null>(null);
  const [counted, setCounted] = useState("");
  const selected = items.find((item) => item.id === itemId) ?? null;
  const difference =
    selected && counted !== "" ? Number(counted) - selected.currentStock : null;
  return (
    <OperationPanel
      title="Inventario fisico"
      subtitle="Compara sistema vs conteo real y corrige diferencias"
      accent="steel"
    >
      <QrScanner items={items} onItem={(item) => setItemId(item.id)} />
      <form
        onSubmit={(event) =>
          submitForm(event, () => {
            if (!itemId) throw new Error("Selecciona un item.");
            return runAction("Inventario ajustado", () =>
              createPhysicalAdjustment(client, itemId, Number(counted)),
            );
          })
        }
      >
        <ItemSelect
          items={items}
          value={itemId}
          onChange={setItemId}
          required
        />
        <label>
          {" "}
          Conteo real{" "}
          <input
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            type="number"
            step="0.001"
            min="0"
            required
          />{" "}
        </label>
        {selected && (
          <ItemStrip
            item={selected}
            extra={
              difference === null
                ? undefined
                : `Diferencia: ${formatNumber(difference)} ${selected.unitSymbol}`
            }
          />
        )}
        <button className="primary">Confirmar ajuste</button>
      </form>
    </OperationPanel>
  );
}

function CustomersView({
  client,
  customers,
  profile,
  runAction,
}: {
  client: SupabaseClient;
  customers: Customer[];
  profile: Profile;
  runAction: ActionRunner;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const rows = search(
    customers,
    query,
    (customer) =>
      `${customer.name} ${customer.phone ?? ""} ${customer.address ?? ""}`,
  );
  return (
    <div className="two-column">
      <div>
        <SectionHeader
          title="Clientes"
          subtitle="Clientes para salidas y trazabilidad"
        />
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar cliente"
        />
        <DataList
          rows={rows}
          render={(customer) => (
            <article
              className={`data-row ${!customer.isActive ? "inactive" : ""}`}
              key={customer.id}
            >
              <div>
                <strong>{customer.name}</strong>
                <span>
                  {customer.phone ?? "Sin telefono"} ·{" "}
                  {customer.address ?? "Sin direccion"}
                </span>
              </div>
              <div className="row-actions">
                <button onClick={() => setEditing(customer)}>Editar</button>
                {profile.isAdmin && (
                  <button
                    onClick={() =>
                      runAction(
                        customer.isActive
                          ? "Cliente archivado"
                          : "Cliente reactivado",
                        () =>
                          setCustomerActive(
                            client,
                            customer.id,
                            !customer.isActive,
                          ),
                      )
                    }
                  >
                    {customer.isActive ? "Archivar" : "Reactivar"}
                  </button>
                )}
              </div>
            </article>
          )}
        />
      </div>
      <FormPanel
        title="Nuevo cliente"
        subtitle="Disponible inmediatamente para salidas"
      >
        <form
          onSubmit={(event) =>
            submitForm(event, (form) =>
              runAction("Cliente guardado", () => saveCustomer(client, form)),
            )
          }
        >
          <CustomerFields />
          <button className="primary">Guardar cliente</button>
        </form>
      </FormPanel>
      {editing && (
        <Modal title="Editar cliente" onClose={() => setEditing(null)}>
          <form
            onSubmit={(event) =>
              submitForm(event, async (form) => {
                await runAction("Cliente actualizado", () =>
                  saveCustomer(client, form, editing.id),
                );
                setEditing(null);
              })
            }
          >
            <CustomerFields customer={editing} />
            <button className="primary">Guardar cambios</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function LocationsView({
  client,
  locations,
  profile,
  runAction,
}: {
  client: SupabaseClient;
  locations: Location[];
  profile: Profile;
  runAction: ActionRunner;
}) {
  const [query, setQuery] = useState("");
  const rows = search(
    locations,
    query,
    (location) =>
      `${location.name} ${location.displayCode} ${location.description ?? ""}`,
  );
  return (
    <div className="two-column">
      <div>
        <SectionHeader
          title="Ubicaciones"
          subtitle="Estanterias, filas y columnas"
        />
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar ubicacion"
        />
        <DataList
          rows={rows}
          render={(location) => (
            <article
              className={`data-row ${!location.isActive ? "inactive" : ""}`}
              key={location.id}
            >
              <div>
                <strong>{location.displayCode}</strong>
                <span>{location.description ?? "Sin descripcion"}</span>
              </div>
              {profile.isAdmin && (
                <button
                  onClick={() =>
                    runAction(
                      location.isActive
                        ? "Ubicacion archivada"
                        : "Ubicacion reactivada",
                      () =>
                        setLocationActive(
                          client,
                          location.id,
                          !location.isActive,
                        ),
                    )
                  }
                >
                  {location.isActive ? "Archivar" : "Reactivar"}
                </button>
              )}
            </article>
          )}
        />
      </div>
      <FormPanel
        title="Nueva ubicacion"
        subtitle="Se genera codigo visible por fila/columna"
      >
        <form
          onSubmit={(event) =>
            submitForm(event, (form) =>
              runAction("Ubicacion creada", () => createLocation(client, form)),
            )
          }
        >
          <label>
            Nombre base
            <input name="name" required placeholder="Estanteria" />
          </label>
          <label>
            Fila
            <input name="rowNumber" type="number" min="1" />
          </label>
          <label>
            Columna
            <input name="columnLetter" maxLength={3} placeholder="A" />
          </label>
          <label>
            Descripcion
            <textarea name="description" rows={3} />
          </label>
          <button className="primary">Crear ubicacion</button>
        </form>
      </FormPanel>
    </div>
  );
}

function HistoryView({
  movements,
  items,
}: {
  movements: StockMovement[];
  items: Item[];
}) {
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState<number | null>(null);
  const rows = search(
    movements.filter(
      (movement) =>
        !itemId || movement.lines.some((line) => line.itemId === itemId),
    ),
    query,
    (movement) =>
      `${movement.typeLabel} ${movement.number ?? ""} ${movement.customerName ?? ""} ${movement.lines.map((line) => `${line.itemCode} ${line.itemName}`).join(" ")}`,
  );
  return (
    <div>
      <SectionHeader
        title="Historial"
        subtitle="Movimientos de stock y trazabilidad"
      />
      <div className="filter-bar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar movimiento"
        />
        <ItemSelect items={items} value={itemId} onChange={setItemId} />
      </div>
      <div className="timeline">
        {rows.map((movement) => (
          <article key={movement.id} className={`movement ${movement.type}`}>
            <div>
              <strong>{movement.typeLabel}</strong>
              <span>
                {new Date(movement.createdAt).toLocaleString("es-AR")} ·{" "}
                {movement.userDisplayName}
              </span>
            </div>
            <b>{movement.number ?? "#" + movement.id}</b>
            {movement.customerName && <p>{movement.customerName}</p>}
            <ul>
              {movement.lines.map((line) => (
                <li key={`${movement.id}-${line.itemId}`}>
                  {line.itemCode} · {line.itemName} ·{" "}
                  {formatNumber(line.quantity)} {line.unitSymbol}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

function LabelsView({ items }: { items: Item[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const rows = search(
    items,
    query,
    (item) => `${item.code} ${item.name} ${item.categoryName}`,
  );
  async function generatePdf() {
    const chosen = items.filter((item) => selected.includes(item.id));
    if (!chosen.length) throw new Error("Selecciona al menos un item.");

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 8;
    const labelWidth = 70;
    const labelHeight = 38;
    const gap = 4;
    const columns = 2;
    const rows = 6;
    const labelsPerPage = columns * rows;
    const qrSize = 26;

    for (let index = 0; index < chosen.length; index += 1) {
      if (index > 0 && index % labelsPerPage === 0) doc.addPage();

      const item = chosen[index];
      const pageIndex = index % labelsPerPage;
      const column = pageIndex % columns;
      const row = Math.floor(pageIndex / columns);
      const x = margin + column * (labelWidth + gap);
      const y = margin + row * (labelHeight + gap);
      const qr = await QRCode.toDataURL(`GPF:ITEM:${item.code}`, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      });

      doc.setDrawColor(90, 98, 104);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, y, labelWidth, labelHeight, 2, 2);
      doc.addImage(qr, "PNG", x + 3, y + 6, qrSize, qrSize);

      const textX = x + 33;
      const textWidth = labelWidth - 37;
      doc.setTextColor(88, 96, 102);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("GPF STOCK", textX, y + 8);

      doc.setTextColor(15, 22, 28);
      doc.setFontSize(16);
      doc.text(item.code, textX, y + 16, { maxWidth: textWidth });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const itemNameLines = doc
        .splitTextToSize(item.name, textWidth)
        .slice(0, 2);
      doc.text(itemNameLines, textX, y + 22);

      doc.setTextColor(88, 96, 102);
      doc.setFontSize(7);
      doc.text(item.locationName ?? "Sin ubicacion", textX, y + 34, {
        maxWidth: textWidth,
      });
    }
    doc.save("gpf-etiquetas-qr.pdf");
  }
  return (
    <div>
      <SectionHeader
        title="Etiquetas QR"
        subtitle="Genera PDF de etiquetas desde el navegador"
      />
      <div className="filter-bar">
        <input
          className="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar item"
        />
        <button onClick={() => setSelected(rows.map((item) => item.id))}>
          Seleccionar filtrados
        </button>
        <button
          className="primary"
          onClick={() =>
            void generatePdf().catch((err) => alert(errorMessage(err)))
          }
        >
          Generar PDF
        </button>
      </div>
      <div className="label-grid">
        {rows.map((item) => (
          <label key={item.id} className="label-choice">
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            />
            <span>{item.code}</span>
            <small>{item.name}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

function ReplenishmentView({
  rows,
  setView,
}: {
  rows: ReplenishmentItem[];
  setView: (view: View) => void;
}) {
  return (
    <div>
      <SectionHeader
        title="Reposicion"
        subtitle="Items bajo minimo o en negativo"
      />
      <div className="replenishment-grid">
        {rows.map((row) => (
          <article className={`replenishment ${row.priority}`} key={row.itemId}>
            <p className="code">{row.code}</p>
            <h3>{row.name}</h3>
            <span>
              {row.categoryName} · {row.locationName ?? "Sin ubicacion"}
            </span>
            <strong>
              Pedir {formatNumber(row.suggestedQuantity)} {row.unitSymbol}
            </strong>
            <small>
              Stock {formatNumber(row.currentStock)} / Min{" "}
              {formatNumber(row.minimumStock)}
            </small>
          </article>
        ))}
      </div>
      {!rows.length && (
        <EmptyState
          title="Sin reposicion pendiente"
          action={<button onClick={() => setView("items")}>Ver items</button>}
        />
      )}
    </div>
  );
}

function AdminView({
  client,
  data,
  runAction,
}: {
  client: SupabaseClient;
  data: AppData;
  runAction: ActionRunner;
}) {
  return (
    <div className="two-column">
      <div>
        <SectionHeader
          title="Usuarios"
          subtitle="Alta de operadores y administradores"
        />
        <DataList
          rows={data.adminUsers}
          render={(user) => (
            <article
              className={`data-row ${!user.isActive ? "inactive" : ""}`}
              key={user.id}
            >
              <div>
                <strong>{user.username}</strong>
                <span>
                  {user.displayName} · {user.role} ·{" "}
                  {user.hasAuthUser ? "Auth OK" : "Sin Auth"}
                </span>
              </div>
            </article>
          )}
        />
      </div>
      <div className="stack">
        <FormPanel
          title="Nuevo usuario"
          subtitle="Usa usuario corto; el email interno sera @gpf.local"
        >
          <form
            onSubmit={(event) =>
              submitForm(event, (form) =>
                runAction("Usuario creado", () =>
                  createAdminUser(client, form),
                ),
              )
            }
          >
            <label>
              Nombre visible
              <input name="displayName" required />
            </label>
            <label>
              Usuario
              <input name="username" required />
            </label>
            <label>
              Clave inicial
              <input name="password" type="password" minLength={6} required />
            </label>
            <label>
              Rol
              <select name="role" defaultValue="operator">
                <option value="operator">Operador</option>
                <option value="technical_admin">Admin tecnico</option>
              </select>
            </label>
            <button className="primary">Crear usuario</button>
          </form>
        </FormPanel>
        <FormPanel
          title="Nueva categoria"
          subtitle="Prefijo unico para codigos automaticos"
        >
          <form
            onSubmit={(event) =>
              submitForm(event, (form) =>
                runAction("Categoria creada", () =>
                  createCategory(client, form),
                ),
              )
            }
          >
            <label>
              Nombre
              <input name="name" required />
            </label>
            <label>
              Prefijo
              <input name="codePrefix" minLength={2} maxLength={6} required />
            </label>
            <button className="primary">Crear categoria</button>
          </form>
        </FormPanel>
      </div>
    </div>
  );
}

function QrScanner({
  items,
  onItem,
}: {
  items: Item[];
  onItem: (item: Item) => void;
}) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);
  const regionId = useRef(`qr-${Math.random().toString(36).slice(2)}`);

  useEffect(
    () => () => {
      void stop();
    },
    [],
  );

  async function stop() {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.stop();
      await scannerRef.current.clear();
    } catch {}
    scannerRef.current = null;
    setActive(false);
  }

  async function start() {
    setMessage("Abriendo camara...");
    const module = await import("html5-qrcode");
    const scanner = new module.Html5Qrcode(regionId.current);
    scannerRef.current = scanner;
    setActive(true);
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 230, height: 230 } },
      (decoded) => {
        const code = decoded.includes("GPF:ITEM:")
          ? decoded.split("GPF:ITEM:")[1]
          : decoded;
        const item = items.find(
          (candidate) =>
            candidate.code.toLowerCase() === code.trim().toLowerCase(),
        );
        if (item) {
          onItem(item);
          setMessage(`Leido: ${item.code}`);
          void stop();
        } else {
          setMessage(`QR no encontrado: ${decoded}`);
        }
      },
      () => undefined,
    );
  }

  return (
    <div className="scanner-box">
      <div
        id={regionId.current}
        className={active ? "scanner-region active" : "scanner-region"}
      />
      <button
        type="button"
        onClick={() =>
          active
            ? void stop()
            : void start().catch((err) => setMessage(errorMessage(err)))
        }
      >
        {active ? "Cerrar camara" : "Escanear QR"}
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}

function ItemQrCode({
  item,
  variant = "compact",
}: {
  item: Item;
  variant?: "compact" | "large";
}) {
  const [qrSource, setQrSource] = useState("");

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(`GPF:ITEM:${item.code}`, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
    })
      .then((source) => {
        if (!cancelled) setQrSource(source);
      })
      .catch(() => {
        if (!cancelled) setQrSource("");
      });

    return () => {
      cancelled = true;
    };
  }, [item.code]);

  return (
    <div className={`item-qr ${variant}`} aria-label={`QR ${item.code}`}>
      {qrSource ? <img src={qrSource} alt="" /> : <span>QR</span>}
    </div>
  );
}

function ItemPhotoThumb({ item }: { item: Item }) {
  if (item.photoPath) {
    return <img src={item.photoPath} alt={`Foto ${item.code}`} />;
  }

  return (
    <div className="item-photo-placeholder" aria-label={`Sin foto ${item.code}`}>
      <span>Sin foto</span>
    </div>
  );
}

function ItemPhotoEditor({
  item,
  onUpload,
}: {
  item: Item;
  onUpload: (file: File) => Promise<void>;
}) {
  return (
    <div className="edit-photo-panel">
      <div>
        <span>Foto del item</span>
        <strong>{item.photoPath ? "Foto cargada" : "Sin foto cargada"}</strong>
      </div>
      {item.photoPath ? (
        <img src={item.photoPath} alt={`Foto ${item.code}`} />
      ) : (
        <div className="photo-placeholder">Sin foto</div>
      )}
      <label className="file-button">
        Cambiar foto
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            void onUpload(file).finally(() => {
              input.value = "";
            });
          }}
        />
      </label>
    </div>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  firstVisible,
  lastVisible,
  onPrevious,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  firstVisible: number;
  lastVisible: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pagination-controls">
      <span>
        {totalItems
          ? `${firstVisible}-${lastVisible} de ${totalItems}`
          : "0 items"}
      </span>
      <div>
        <button
          type="button"
          className="ghost"
          onClick={onPrevious}
          disabled={currentPage <= 1}
        >
          Anterior
        </button>
        <strong>
          Pagina {currentPage} / {totalPages}
        </strong>
        <button
          type="button"
          className="ghost"
          onClick={onNext}
          disabled={currentPage >= totalPages}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function ItemDetailModal({
  item,
  onClose,
  onEdit,
}: {
  item: Item;
  onClose: () => void;
  onEdit: (item: Item) => void;
}) {
  const stockTone =
    item.currentStock < 0
      ? "red"
      : item.minimumStock !== null && item.currentStock <= item.minimumStock
        ? "orange"
        : "cyan";

  return (
    <Modal title={`Detalle ${item.code}`} onClose={onClose}>
      <div className="item-detail">
        <div className="item-detail-media">
          <ItemQrCode item={item} variant="large" />
          {item.photoPath ? (
            <img
              className="item-detail-photo"
              src={item.photoPath}
              alt={`Foto ${item.code}`}
            />
          ) : (
            <div className="item-detail-photo empty">Sin foto</div>
          )}
        </div>
        <div className="item-detail-main">
          <p className="code">{item.code}</p>
          <h2>{item.name}</h2>
          <div className={`detail-stock ${stockTone}`}>
            <span>Stock actual</span>
            <strong>
              {formatNumber(item.currentStock)} {item.unitSymbol}
            </strong>
          </div>
          <div className="detail-grid">
            <DetailValue label="Categoria" value={item.categoryName} />
            <DetailValue label="Unidad" value={item.unitName} />
            <DetailValue
              label="Ubicacion"
              value={item.locationName ?? "Sin ubicacion"}
            />
            <DetailValue
              label="Minimo"
              value={
                item.minimumStock === null
                  ? "Sin minimo"
                  : `${formatNumber(item.minimumStock)} ${item.unitSymbol}`
              }
            />
            <DetailValue
              label="Ideal"
              value={
                item.idealStock === null
                  ? "Sin ideal"
                  : `${formatNumber(item.idealStock)} ${item.unitSymbol}`
              }
            />
            <DetailValue
              label="Costo"
              value={
                item.currentPurchaseCost === null
                  ? "Sin costo"
                  : currency(item.currentPurchaseCost)
              }
            />
            <DetailValue
              label="Estado"
              value={item.isActive ? "Activo" : "Archivado"}
            />
          </div>
          {item.notes && (
            <div className="detail-notes">
              <span>Notas</span>
              <p>{item.notes}</p>
            </div>
          )}
          <div className="detail-actions">
            <button type="button" className="primary" onClick={() => onEdit(item)}>
              Editar item
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ItemFields({
  categories,
  units,
  locations,
  item,
}: {
  categories: Category[];
  units: UnitOfMeasure[];
  locations: Location[];
  item?: Item;
}) {
  return (
    <>
      <label>
        Nombre
        <input name="name" defaultValue={item?.name ?? ""} required />
      </label>
      <label>
        Categoria
        <select
          name="categoryId"
          defaultValue={item?.categoryId ?? ""}
          required
        >
          <option value="" disabled>
            Seleccionar
          </option>
          {categories
            .filter((c) => c.isActive || c.id === item?.categoryId)
            .map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} ({category.codePrefix})
              </option>
            ))}
        </select>
      </label>
      <label>
        Unidad
        <select
          name="unitId"
          defaultValue={item?.unitOfMeasureId ?? ""}
          required
        >
          <option value="" disabled>
            Seleccionar
          </option>
          {units
            .filter((u) => u.isActive || u.id === item?.unitOfMeasureId)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
        </select>
      </label>
      <label>
        Ubicacion
        <select name="locationId" defaultValue={item?.locationId ?? ""}>
          <option value="">Sin ubicacion</option>
          {locations
            .filter((l) => l.isActive || l.id === item?.locationId)
            .map((location) => (
              <option key={location.id} value={location.id}>
                {location.displayCode}
              </option>
            ))}
        </select>
      </label>
      <div className="form-grid">
        <label>
          Stock
          <input
            name="currentStock"
            type="number"
            step="0.001"
            defaultValue={item?.currentStock ?? 0}
          />
        </label>
        <label>
          Minimo
          <input
            name="minimumStock"
            type="number"
            step="0.001"
            defaultValue={item?.minimumStock ?? ""}
          />
        </label>
        <label>
          Ideal
          <input
            name="idealStock"
            type="number"
            step="0.001"
            defaultValue={item?.idealStock ?? ""}
          />
        </label>
        <label>
          Costo
          <input
            name="purchaseCost"
            type="number"
            step="0.01"
            defaultValue={item?.currentPurchaseCost ?? ""}
          />
        </label>
      </div>
      <label>
        Notas
        <textarea name="notes" rows={3} defaultValue={item?.notes ?? ""} />
      </label>
    </>
  );
}

function CustomerFields({ customer }: { customer?: Customer }) {
  return (
    <>
      <label>
        Nombre
        <input name="name" defaultValue={customer?.name ?? ""} required />
      </label>
      <label>
        Telefono
        <input name="phone" defaultValue={customer?.phone ?? ""} />
      </label>
      <label>
        Direccion
        <input name="address" defaultValue={customer?.address ?? ""} />
      </label>
      <label>
        CUIT/DNI
        <input name="taxId" defaultValue={customer?.taxId ?? ""} />
      </label>
      <label>
        Notas
        <textarea name="notes" rows={3} defaultValue={customer?.notes ?? ""} />
      </label>
    </>
  );
}

function ItemSelect({
  items,
  value,
  onChange,
  name = "itemId",
  required = false,
}: {
  items: Item[];
  value: number | null;
  onChange: (value: number | null) => void;
  name?: string;
  required?: boolean;
}) {
  return (
    <label>
      Item
      <select
        name={name}
        value={value ?? ""}
        required={required}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">Seleccionar item</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.code} · {item.name} · {formatNumber(item.currentStock)}{" "}
            {item.unitSymbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function ItemStrip({ item, extra }: { item: Item; extra?: string }) {
  return (
    <div className="item-strip">
      <strong>{item.code}</strong>
      <span>{item.name}</span>
      <b>
        {formatNumber(item.currentStock)} {item.unitSymbol}
      </b>
      {extra && <em>{extra}</em>}
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="section-header">
      <p className="eyebrow">GPF Cloud</p>
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

function FormPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <aside className="form-panel">
      <h3>{title}</h3>
      <p>{subtitle}</p>
      {children}
    </aside>
  );
}

function OperationPanel({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent: "cyan" | "red" | "steel";
  children: ReactNode;
}) {
  return (
    <div className={`operation ${accent}`}>
      <SectionHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ItemKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "cyan" | "orange" | "red" | "green" | "steel";
}) {
  return (
    <div className={`item-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function DataList<T>({
  rows,
  render,
}: {
  rows: T[];
  render: (row: T) => ReactNode;
}) {
  if (!rows.length) return <EmptyState title="Sin resultados" />;
  return <div className="data-list">{rows.map(render)}</div>;
}

function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {action}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const modal = (
    <div className="modal-backdrop">
      <div className="modal">
        <header>
          <h3>{title}</h3>
          <button onClick={onClose}>Cerrar</button>
        </header>
        {children}
      </div>
    </div>
  );

  return mounted ? createPortal(modal, document.body) : null;
}

function submitForm(
  event: FormEvent<HTMLFormElement>,
  action: (form: FormData) => Promise<void | false>,
) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    void action(form)
      .then((result) => {
        if (result !== false) formElement.reset();
      })
      .catch((err) => alert(errorMessage(err)));
  } catch (err) {
    alert(errorMessage(err));
  }
}

function filterByRole(data: AppData, profile: Profile): AppData {
  if (profile.isAdmin) return data;
  return {
    ...data,
    categories: data.categories.filter((row) => row.isActive),
    locations: data.locations.filter((row) => row.isActive),
    customers: data.customers.filter((row) => row.isActive),
    items: data.items.filter((row) => row.isActive),
  };
}

function itemSearchText(item: Item) {
  return [
    item.code,
    item.name,
    item.categoryName,
    item.unitName,
    item.unitSymbol,
    item.locationName ?? "sin ubicacion",
    item.notes ?? "",
    formatNumber(item.currentStock),
  ].join(" ");
}

function itemStockTone(item: Item) {
  if (item.currentStock < 0) return "red";
  if (item.minimumStock !== null && item.currentStock <= item.minimumStock) {
    return "orange";
  }
  return "cyan";
}

function itemStockLabel(item: Item) {
  if (!item.isActive) return "Archivado";
  if (item.currentStock < 0) return "Negativo";
  if (item.minimumStock !== null && item.currentStock <= item.minimumStock) {
    return "Bajo minimo";
  }
  return "OK";
}

function matchesItemStockFilter(item: Item, filter: ItemStockFilter) {
  if (filter === "all") return true;
  if (filter === "negative") return item.currentStock < 0;
  if (filter === "low") return itemStockTone(item) === "orange";
  if (filter === "ok") return itemStockTone(item) === "cyan";
  if (filter === "no-location") return !item.locationId;
  return true;
}

function sortItems(items: Item[], sortMode: ItemSort) {
  return [...items].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (sortMode === "name") return a.name.localeCompare(b.name, "es");
    if (sortMode === "stock-asc") return a.currentStock - b.currentStock;
    if (sortMode === "stock-desc") return b.currentStock - a.currentStock;
    return a.code.localeCompare(b.code, "es", { numeric: true });
  });
}

async function prepareItemPhotoFile(file: File) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  try {
    const image = await loadImageFile(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));

    if (scale === 1 && file.type === "image/jpeg" && file.size < 1_500_000) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82),
    );
    if (!blob) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "item-photo";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
      throw new Error(
        "No se pudo procesar la foto HEIC/HEIF. En el movil usa JPG o 'Mas compatible' y volve a intentar.",
      );
    }
    return file;
  }
}

function loadImageFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(source);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("No se pudo leer la imagen seleccionada."));
    };
    image.src = source;
  });
}

function search<T>(rows: T[], query: string, text: (row: T) => string) {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const haystack = normalize(text(row));
    return words.every((word) => haystack.includes(word));
  });
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function useLayoutMode(): LayoutMode {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("desktop");

  useEffect(() => {
    const update = () => {
      const override = new URLSearchParams(window.location.search).get(
        "layout",
      );
      if (override === "mobile" || override === "desktop") {
        setLayoutMode(override);
        return;
      }

      const isMobile = window.matchMedia(
        "(max-width: 768px), ((hover: none) and (pointer: coarse) and (max-width: 1024px))",
      ).matches;
      setLayoutMode(isMobile ? "mobile" : "desktop");
    };

    const media = window.matchMedia(
      "(max-width: 768px), ((hover: none) and (pointer: coarse) and (max-width: 1024px))",
    );
    update();
    media.addEventListener("change", update);
    window.addEventListener("popstate", update);

    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("popstate", update);
    };
  }, []);

  return layoutMode;
}

function titleFor(view: View) {
  return navItems.find((item) => item.view === view)?.label ?? "GPF Cloud";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error)
    return String((error as { message: unknown }).message);
  return "Ocurrio un error inesperado.";
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(message)),
      milliseconds,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function textInput(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim() || null;
}

function numInput(form: FormData, name: string) {
  const value = Number(form.get(name));
  if (!Number.isFinite(value)) throw new Error(`Valor invalido: ${name}`);
  return value;
}

function nullableInput(form: FormData, name: string) {
  const value = form.get(name);
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(
    value,
  );
}

function currency(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}
