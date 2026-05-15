'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
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
} from '@/lib/api';
import { createBrowserSupabaseClient, usernameToEmail } from '@/lib/supabase';
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
} from '@/lib/types';

type View =
  | 'dashboard'
  | 'items'
  | 'entry'
  | 'exit'
  | 'inventory'
  | 'customers'
  | 'locations'
  | 'history'
  | 'labels'
  | 'replenishment'
  | 'admin';

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

type ActionRunner = (label: string, action: () => Promise<void>) => Promise<void>;

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
  { view: 'dashboard', label: 'Panel' },
  { view: 'items', label: 'Items' },
  { view: 'entry', label: 'Entrada' },
  { view: 'exit', label: 'Salida' },
  { view: 'inventory', label: 'Inventario' },
  { view: 'customers', label: 'Clientes' },
  { view: 'locations', label: 'Ubicaciones' },
  { view: 'history', label: 'Historial' },
  { view: 'labels', label: 'Etiquetas' },
  { view: 'replenishment', label: 'Reposicion' },
  { view: 'admin', label: 'Admin', adminOnly: true },
];

export function GpfCloudApp() {
  const [client] = useState<SupabaseClient | null>(() => createBrowserSupabaseClient());
  const [booting, setBooting] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileRetry, setProfileRetry] = useState(0);
  const [data, setData] = useState<AppData>(emptyData);
  const [activeView, setActiveView] = useState<View>('dashboard');
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
          'No se pudo verificar la sesion local. Mostrando login.',
        );
        if (mounted) setAuthUser(sessionData.session?.user ?? null);
      } catch (bootError) {
        if (mounted) setError(errorMessage(bootError));
      } finally {
        if (mounted) setBooting(false);
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });

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
          'Supabase tardo demasiado en cargar el perfil GPF.',
        );
        if (cancelled) return;

        if (!appProfile || !appProfile.isActive) {
          setError('El usuario no tiene un perfil GPF activo.');
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
    setActiveView('dashboard');
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
  if (!profile) return <LoginScreen client={client} onError={setError} error={error} />;

  const visibleData = filterByRole(data, profile);

  return (
    <div className="cloud-shell">
      <aside className="rail">
        <div className="brand-lockup">
          <img src="/brand/app-icon.png" alt="GPF" />
          <div>
            <strong>GPF Cloud</strong>
            <span>{profile.isAdmin ? 'Admin tecnico' : 'Operacion'}</span>
          </div>
        </div>
        <nav>
          {navItems
            .filter((item) => !item.adminOnly || profile.isAdmin)
            .map((item) => (
              <button
                type="button"
                key={item.view}
                className={activeView === item.view ? 'active' : ''}
                onClick={() => setActiveView(item.view)}
              >
                {item.label}
              </button>
            ))}
        </nav>
        <div className="rail-footer">
          <span>{profile.displayName}</span>
          <button type="button" onClick={signOut}>Salir</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Supabase conectado</p>
            <h1>{titleFor(activeView)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost" type="button" onClick={refresh} disabled={loadingData}>Recargar</button>
            <button className="danger ghost" type="button" onClick={signOut}>Cerrar sesion</button>
          </div>
        </header>

        {(notice || error || working) && (
          <div className={`status-line ${error ? 'error' : ''}`}>
            {working ?? error ?? notice}
          </div>
        )}

        <section className="screen-card">
          {activeView === 'dashboard' && <Dashboard data={visibleData} profile={profile} setView={setActiveView} />}
          {activeView === 'items' && <ItemsView client={client} data={visibleData} profile={profile} runAction={runAction} />}
          {activeView === 'entry' && <EntryView client={client} items={visibleData.items} runAction={runAction} />}
          {activeView === 'exit' && <ExitView client={client} items={visibleData.items} customers={visibleData.customers} runAction={runAction} />}
          {activeView === 'inventory' && <InventoryView client={client} items={visibleData.items} runAction={runAction} />}
          {activeView === 'customers' && <CustomersView client={client} customers={visibleData.customers} profile={profile} runAction={runAction} />}
          {activeView === 'locations' && <LocationsView client={client} locations={visibleData.locations} profile={profile} runAction={runAction} />}
          {activeView === 'history' && <HistoryView movements={visibleData.movements} items={visibleData.items} />}
          {activeView === 'labels' && <LabelsView items={visibleData.items} />}
          {activeView === 'replenishment' && <ReplenishmentView rows={visibleData.replenishment} setView={setActiveView} />}
          {activeView === 'admin' && profile.isAdmin && <AdminView client={client} data={data} runAction={runAction} />}
        </section>
      </main>
    </div>
  );
}

function EnvMissing() {
  return (
    <div className="login-stage">
      <div className="env-card">
        <img src="/brand/app-icon.png" alt="GPF" />
        <h1>Faltan variables de entorno</h1>
        <p>Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel o en .env.local.</p>
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
        <span>{loading ? 'Cargando perfil GPF...' : 'No se pudo cargar el perfil.'}</span>
        {error && <div className="form-error">{error}</div>}
        <div className="topbar-actions">
          <button type="button" onClick={onRetry}>Reintentar</button>
          <button type="button" className="ghost danger" onClick={onSignOut}>Volver al login</button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen({ client, onError, error }: { client: SupabaseClient; onError: (value: string | null) => void; error: string | null }) {
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') ?? '').trim();
    const password = String(form.get('password') ?? '');
    setLoading(true);
    onError(null);
    try {
      const { error: loginError } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password });
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
          <input name="username" autoComplete="username" placeholder="admin" required />
        </label>
        <label>
          Clave
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" disabled={loading}>{loading ? 'Entrando...' : 'Entrar al sistema'}</button>
      </form>
    </div>
  );
}

function Dashboard({ data, profile, setView }: { data: AppData; profile: Profile; setView: (view: View) => void }) {
  const activeItems = data.items.filter((item) => item.isActive);
  const negative = activeItems.filter((item) => item.currentStock < 0);
  const low = activeItems.filter((item) => item.minimumStock !== null && item.currentStock >= 0 && item.currentStock <= item.minimumStock);
  const stockValue = activeItems.reduce((sum, item) => sum + item.currentStock * (item.currentPurchaseCost ?? 0), 0);

  return (
    <div className="dashboard-grid">
      <div className="hero-panel">
        <p className="eyebrow">Bienvenido, {profile.displayName}</p>
        <h2>Stock hidraulico en tiempo real, desde cualquier dispositivo.</h2>
        <div className="hero-actions">
          <button onClick={() => setView('exit')}>Registrar salida</button>
          <button onClick={() => setView('entry')}>Registrar entrada</button>
          <button onClick={() => setView('inventory')}>Inventario fisico</button>
        </div>
      </div>
      <Metric label="Items activos" value={activeItems.length.toString()} tone="cyan" />
      <Metric label="Alertas" value={(negative.length + low.length).toString()} tone={negative.length ? 'red' : 'orange'} />
      <Metric label="Valor estimado" value={currency(stockValue)} tone="steel" />
      <div className="quick-grid">
        {[
          ['Items', 'items', '/icons/stock-box.png'],
          ['Clientes', 'customers', '/icons/clients.png'],
          ['Historial', 'history', '/icons/history-chart.png'],
          ['Etiquetas', 'labels', '/icons/checklist.png'],
          ['Reposicion', 'replenishment', '/icons/cart.png'],
          ['Ubicaciones', 'locations', '/icons/locations.png'],
        ].map(([label, view, icon]) => (
          <button key={view} className="quick-tile" onClick={() => setView(view as View)}>
            <img src={icon} alt="" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="alert-panel">
        <h3>Prioridad operativa</h3>
        {negative.concat(low).slice(0, 8).map((item) => (
          <div className="alert-row" key={item.id}>
            <strong>{item.code}</strong>
            <span>{item.name}</span>
            <b>{formatNumber(item.currentStock)} {item.unitSymbol}</b>
          </div>
        ))}
        {!negative.length && !low.length && <p className="muted">No hay alertas de stock activas.</p>}
      </div>
    </div>
  );
}

function ItemsView({ client, data, profile, runAction }: { client: SupabaseClient; data: AppData; profile: Profile; runAction: ActionRunner }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Item | null>(null);
  const items = search(data.items, query, (item) => `${item.code} ${item.name} ${item.categoryName} ${item.locationName ?? ''}`);

  return (
    <div className="two-column">
      <div>
        <SectionHeader title="Items" subtitle="Catalogo maestro, QR, foto y stock actual" />
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por codigo, nombre, categoria o ubicacion" />
        <div className="item-list">
          {items.map((item) => (
            <article className={`item-card ${!item.isActive ? 'inactive' : ''}`} key={item.id}>
              {item.photoPath ? <img className="item-photo" src={item.photoPath} alt="" /> : <div className="item-photo ghost-photo">QR</div>}
              <div>
                <p className="code">{item.code}</p>
                <h3>{item.name}</h3>
                <p>{item.categoryName} · {item.locationName ?? 'Sin ubicacion'}</p>
                <strong>{formatNumber(item.currentStock)} {item.unitSymbol}</strong>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => setEditing(item)}>Editar</button>
                {profile.isAdmin && (
                  <button type="button" onClick={() => runAction(item.isActive ? 'Item archivado' : 'Item reactivado', () => setItemActive(client, item.id, !item.isActive))}>
                    {item.isActive ? 'Archivar' : 'Reactivar'}
                  </button>
                )}
                <label className="file-button">
                  Foto
                  <input type="file" accept="image/*" capture="environment" onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void runAction('Foto actualizada', () => uploadItemPhoto(client, item.id, file));
                  }} />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>
      <div>
        <FormPanel title="Nuevo item" subtitle="El codigo se genera con el prefijo de la categoria">
          <form onSubmit={(event) => submitForm(event, (form) => runAction('Item creado', () => createItem(client, form)))}>
            <ItemFields categories={data.categories} units={data.units} locations={data.locations} />
            <button className="primary">Crear item</button>
          </form>
        </FormPanel>
      </div>
      {editing && (
        <Modal title={`Editar ${editing.code}`} onClose={() => setEditing(null)}>
          <form onSubmit={(event) => submitForm(event, async (form) => {
            await runAction('Item actualizado', () => updateItem(client, editing, form));
            setEditing(null);
          })}>
            <ItemFields categories={data.categories} units={data.units} locations={data.locations} item={editing} />
            <button className="primary">Guardar cambios</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function EntryView({ client, items, runAction }: { client: SupabaseClient; items: Item[]; runAction: ActionRunner }) {
  const [itemId, setItemId] = useState<number | null>(null);
  const selected = items.find((item) => item.id === itemId) ?? null;
  return (
    <OperationPanel title="Entrada rapida" subtitle="Suma stock y actualiza costo de compra" accent="cyan">
      <QrScanner items={items} onItem={(item) => setItemId(item.id)} />
      <form onSubmit={(event) => submitForm(event, (form) => runAction('Entrada registrada', () => createStockEntry(client, numInput(form, 'itemId'), numInput(form, 'quantity'), nullableInput(form, 'unitCost'))))}>
        <ItemSelect items={items} value={itemId} onChange={setItemId} name="itemId" required />
        <label> Cantidad <input name="quantity" type="number" step="0.001" min="0" required /> </label>
        <label> Costo unitario <input name="unitCost" type="number" step="0.01" min="0" defaultValue={selected?.currentPurchaseCost ?? ''} /> </label>
        {selected && <ItemStrip item={selected} />}
        <button className="primary">Guardar entrada</button>
      </form>
    </OperationPanel>
  );
}

type ExitLine = { key: string; itemId: number | null; quantity: string };

function ExitView({ client, items, customers, runAction }: { client: SupabaseClient; items: Item[]; customers: Customer[]; runAction: ActionRunner }) {
  const [lines, setLines] = useState<ExitLine[]>([{ key: crypto.randomUUID(), itemId: null, quantity: '' }]);
  function updateLine(key: string, patch: Partial<ExitLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }
  return (
    <OperationPanel title="Salida rapida" subtitle="Descuenta una o varias piezas y genera numero SAL" accent="red">
      <QrScanner items={items} onItem={(item) => setLines((current) => [{ key: crypto.randomUUID(), itemId: item.id, quantity: '1' }, ...current])} />
      <form onSubmit={(event) => submitForm(event, (form) => {
        const payloadLines = lines
          .map((line) => ({ itemId: line.itemId ?? 0, quantity: Number(line.quantity) }))
          .filter((line) => line.itemId > 0 && line.quantity > 0);
        if (!payloadLines.length) throw new Error('Agrega al menos una linea valida.');
        return runAction('Salida registrada', () => createStockExit(client, {
          customerId: nullableInput(form, 'customerId'),
          customerName: textInput(form, 'customerName'),
          workDescription: textInput(form, 'workDescription'),
          workOrderNumber: textInput(form, 'workOrderNumber'),
          notes: textInput(form, 'notes'),
          lines: payloadLines,
        }));
      })}>
        <label> Cliente guardado <select name="customerId" defaultValue=""><option value="">Sin cliente</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> </label>
        <label> Cliente rapido <input name="customerName" placeholder="Nombre si no esta cargado" /> </label>
        <div className="line-editor">
          {lines.map((line) => (
            <div className="line-row" key={line.key}>
              <ItemSelect items={items} value={line.itemId} onChange={(value) => updateLine(line.key, { itemId: value })} />
              <input value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} type="number" step="0.001" min="0" placeholder="Cant." />
              <button type="button" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>Quitar</button>
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), itemId: null, quantity: '' }])}>Agregar linea</button>
        </div>
        <label> Trabajo <input name="workDescription" /> </label>
        <label> Orden <input name="workOrderNumber" /> </label>
        <label> Notas <textarea name="notes" rows={3} /> </label>
        <button className="primary danger">Guardar salida</button>
      </form>
    </OperationPanel>
  );
}

function InventoryView({ client, items, runAction }: { client: SupabaseClient; items: Item[]; runAction: ActionRunner }) {
  const [itemId, setItemId] = useState<number | null>(null);
  const [counted, setCounted] = useState('');
  const selected = items.find((item) => item.id === itemId) ?? null;
  const difference = selected && counted !== '' ? Number(counted) - selected.currentStock : null;
  return (
    <OperationPanel title="Inventario fisico" subtitle="Compara sistema vs conteo real y corrige diferencias" accent="steel">
      <QrScanner items={items} onItem={(item) => setItemId(item.id)} />
      <form onSubmit={(event) => submitForm(event, () => {
        if (!itemId) throw new Error('Selecciona un item.');
        return runAction('Inventario ajustado', () => createPhysicalAdjustment(client, itemId, Number(counted)));
      })}>
        <ItemSelect items={items} value={itemId} onChange={setItemId} required />
        <label> Conteo real <input value={counted} onChange={(event) => setCounted(event.target.value)} type="number" step="0.001" min="0" required /> </label>
        {selected && <ItemStrip item={selected} extra={difference === null ? undefined : `Diferencia: ${formatNumber(difference)} ${selected.unitSymbol}`} />}
        <button className="primary">Confirmar ajuste</button>
      </form>
    </OperationPanel>
  );
}

function CustomersView({ client, customers, profile, runAction }: { client: SupabaseClient; customers: Customer[]; profile: Profile; runAction: ActionRunner }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Customer | null>(null);
  const rows = search(customers, query, (customer) => `${customer.name} ${customer.phone ?? ''} ${customer.address ?? ''}`);
  return (
    <div className="two-column">
      <div>
        <SectionHeader title="Clientes" subtitle="Clientes para salidas y trazabilidad" />
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cliente" />
        <DataList rows={rows} render={(customer) => (
          <article className={`data-row ${!customer.isActive ? 'inactive' : ''}`} key={customer.id}>
            <div><strong>{customer.name}</strong><span>{customer.phone ?? 'Sin telefono'} · {customer.address ?? 'Sin direccion'}</span></div>
            <div className="row-actions"><button onClick={() => setEditing(customer)}>Editar</button>{profile.isAdmin && <button onClick={() => runAction(customer.isActive ? 'Cliente archivado' : 'Cliente reactivado', () => setCustomerActive(client, customer.id, !customer.isActive))}>{customer.isActive ? 'Archivar' : 'Reactivar'}</button>}</div>
          </article>
        )} />
      </div>
      <FormPanel title="Nuevo cliente" subtitle="Disponible inmediatamente para salidas">
        <form onSubmit={(event) => submitForm(event, (form) => runAction('Cliente guardado', () => saveCustomer(client, form)))}>
          <CustomerFields />
          <button className="primary">Guardar cliente</button>
        </form>
      </FormPanel>
      {editing && <Modal title="Editar cliente" onClose={() => setEditing(null)}><form onSubmit={(event) => submitForm(event, async (form) => { await runAction('Cliente actualizado', () => saveCustomer(client, form, editing.id)); setEditing(null); })}><CustomerFields customer={editing} /><button className="primary">Guardar cambios</button></form></Modal>}
    </div>
  );
}

function LocationsView({ client, locations, profile, runAction }: { client: SupabaseClient; locations: Location[]; profile: Profile; runAction: ActionRunner }) {
  const [query, setQuery] = useState('');
  const rows = search(locations, query, (location) => `${location.name} ${location.displayCode} ${location.description ?? ''}`);
  return (
    <div className="two-column">
      <div>
        <SectionHeader title="Ubicaciones" subtitle="Estanterias, filas y columnas" />
        <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ubicacion" />
        <DataList rows={rows} render={(location) => (
          <article className={`data-row ${!location.isActive ? 'inactive' : ''}`} key={location.id}>
            <div><strong>{location.displayCode}</strong><span>{location.description ?? 'Sin descripcion'}</span></div>
            {profile.isAdmin && <button onClick={() => runAction(location.isActive ? 'Ubicacion archivada' : 'Ubicacion reactivada', () => setLocationActive(client, location.id, !location.isActive))}>{location.isActive ? 'Archivar' : 'Reactivar'}</button>}
          </article>
        )} />
      </div>
      <FormPanel title="Nueva ubicacion" subtitle="Se genera codigo visible por fila/columna">
        <form onSubmit={(event) => submitForm(event, (form) => runAction('Ubicacion creada', () => createLocation(client, form)))}>
          <label>Nombre base<input name="name" required placeholder="Estanteria" /></label>
          <label>Fila<input name="rowNumber" type="number" min="1" /></label>
          <label>Columna<input name="columnLetter" maxLength={3} placeholder="A" /></label>
          <label>Descripcion<textarea name="description" rows={3} /></label>
          <button className="primary">Crear ubicacion</button>
        </form>
      </FormPanel>
    </div>
  );
}

function HistoryView({ movements, items }: { movements: StockMovement[]; items: Item[] }) {
  const [query, setQuery] = useState('');
  const [itemId, setItemId] = useState<number | null>(null);
  const rows = search(movements.filter((movement) => !itemId || movement.lines.some((line) => line.itemId === itemId)), query, (movement) => `${movement.typeLabel} ${movement.number ?? ''} ${movement.customerName ?? ''} ${movement.lines.map((line) => `${line.itemCode} ${line.itemName}`).join(' ')}`);
  return (
    <div>
      <SectionHeader title="Historial" subtitle="Movimientos de stock y trazabilidad" />
      <div className="filter-bar"><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar movimiento" /><ItemSelect items={items} value={itemId} onChange={setItemId} /></div>
      <div className="timeline">
        {rows.map((movement) => <article key={movement.id} className={`movement ${movement.type}`}><div><strong>{movement.typeLabel}</strong><span>{new Date(movement.createdAt).toLocaleString('es-AR')} · {movement.userDisplayName}</span></div><b>{movement.number ?? '#' + movement.id}</b>{movement.customerName && <p>{movement.customerName}</p>}<ul>{movement.lines.map((line) => <li key={`${movement.id}-${line.itemId}`}>{line.itemCode} · {line.itemName} · {formatNumber(line.quantity)} {line.unitSymbol}</li>)}</ul></article>)}
      </div>
    </div>
  );
}

function LabelsView({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const rows = search(items, query, (item) => `${item.code} ${item.name} ${item.categoryName}`);
  async function generatePdf() {
    const chosen = items.filter((item) => selected.includes(item.id));
    if (!chosen.length) throw new Error('Selecciona al menos un item.');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    for (let index = 0; index < chosen.length; index += 1) {
      if (index > 0 && index % 8 === 0) doc.addPage();
      const item = chosen[index];
      const x = index % 2 === 0 ? 14 : 110;
      const y = 14 + (index % 8 >= 2 ? Math.floor((index % 8) / 2) * 68 : 0);
      const qr = await QRCode.toDataURL(`GPF:ITEM:${item.code}`, { margin: 1, width: 180 });
      doc.roundedRect(x, y, 82, 56, 4, 4);
      doc.addImage(qr, 'PNG', x + 4, y + 8, 36, 36);
      doc.setFontSize(14);
      doc.text(item.code, x + 44, y + 18);
      doc.setFontSize(9);
      doc.text(item.name.slice(0, 30), x + 44, y + 28);
      doc.text(item.categoryName, x + 44, y + 37);
    }
    doc.save('gpf-etiquetas-qr.pdf');
  }
  return (
    <div>
      <SectionHeader title="Etiquetas QR" subtitle="Genera PDF de etiquetas desde el navegador" />
      <div className="filter-bar"><input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar item" /><button onClick={() => setSelected(rows.map((item) => item.id))}>Seleccionar filtrados</button><button className="primary" onClick={() => void generatePdf().catch((err) => alert(errorMessage(err)))}>Generar PDF</button></div>
      <div className="label-grid">{rows.map((item) => <label key={item.id} className="label-choice"><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span>{item.code}</span><small>{item.name}</small></label>)}</div>
    </div>
  );
}

function ReplenishmentView({ rows, setView }: { rows: ReplenishmentItem[]; setView: (view: View) => void }) {
  return (
    <div>
      <SectionHeader title="Reposicion" subtitle="Items bajo minimo o en negativo" />
      <div className="replenishment-grid">
        {rows.map((row) => <article className={`replenishment ${row.priority}`} key={row.itemId}><p className="code">{row.code}</p><h3>{row.name}</h3><span>{row.categoryName} · {row.locationName ?? 'Sin ubicacion'}</span><strong>Pedir {formatNumber(row.suggestedQuantity)} {row.unitSymbol}</strong><small>Stock {formatNumber(row.currentStock)} / Min {formatNumber(row.minimumStock)}</small></article>)}
      </div>
      {!rows.length && <EmptyState title="Sin reposicion pendiente" action={<button onClick={() => setView('items')}>Ver items</button>} />}
    </div>
  );
}

function AdminView({ client, data, runAction }: { client: SupabaseClient; data: AppData; runAction: ActionRunner }) {
  return (
    <div className="two-column">
      <div>
        <SectionHeader title="Usuarios" subtitle="Alta de operadores y administradores" />
        <DataList rows={data.adminUsers} render={(user) => <article className={`data-row ${!user.isActive ? 'inactive' : ''}`} key={user.id}><div><strong>{user.username}</strong><span>{user.displayName} · {user.role} · {user.hasAuthUser ? 'Auth OK' : 'Sin Auth'}</span></div></article>} />
      </div>
      <div className="stack">
        <FormPanel title="Nuevo usuario" subtitle="Usa usuario corto; el email interno sera @gpf.local">
          <form onSubmit={(event) => submitForm(event, (form) => runAction('Usuario creado', () => createAdminUser(client, form)))}>
            <label>Nombre visible<input name="displayName" required /></label>
            <label>Usuario<input name="username" required /></label>
            <label>Clave inicial<input name="password" type="password" minLength={6} required /></label>
            <label>Rol<select name="role" defaultValue="operator"><option value="operator">Operador</option><option value="technical_admin">Admin tecnico</option></select></label>
            <button className="primary">Crear usuario</button>
          </form>
        </FormPanel>
        <FormPanel title="Nueva categoria" subtitle="Prefijo unico para codigos automaticos">
          <form onSubmit={(event) => submitForm(event, (form) => runAction('Categoria creada', () => createCategory(client, form)))}>
            <label>Nombre<input name="name" required /></label>
            <label>Prefijo<input name="codePrefix" minLength={2} maxLength={6} required /></label>
            <button className="primary">Crear categoria</button>
          </form>
        </FormPanel>
      </div>
    </div>
  );
}

function QrScanner({ items, onItem }: { items: Item[]; onItem: (item: Item) => void }) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const regionId = useRef(`qr-${Math.random().toString(36).slice(2)}`);

  useEffect(() => () => { void stop(); }, []);

  async function stop() {
    if (!scannerRef.current) return;
    try { await scannerRef.current.stop(); await scannerRef.current.clear(); } catch {}
    scannerRef.current = null;
    setActive(false);
  }

  async function start() {
    setMessage('Abriendo camara...');
    const module = await import('html5-qrcode');
    const scanner = new module.Html5Qrcode(regionId.current);
    scannerRef.current = scanner;
    setActive(true);
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 230, height: 230 } },
      (decoded) => {
        const code = decoded.includes('GPF:ITEM:') ? decoded.split('GPF:ITEM:')[1] : decoded;
        const item = items.find((candidate) => candidate.code.toLowerCase() === code.trim().toLowerCase());
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
      <div id={regionId.current} className={active ? 'scanner-region active' : 'scanner-region'} />
      <button type="button" onClick={() => active ? void stop() : void start().catch((err) => setMessage(errorMessage(err)))}>{active ? 'Cerrar camara' : 'Escanear QR'}</button>
      {message && <small>{message}</small>}
    </div>
  );
}

function ItemFields({ categories, units, locations, item }: { categories: Category[]; units: UnitOfMeasure[]; locations: Location[]; item?: Item }) {
  return (
    <>
      <label>Nombre<input name="name" defaultValue={item?.name ?? ''} required /></label>
      <label>Categoria<select name="categoryId" defaultValue={item?.categoryId ?? ''} required><option value="" disabled>Seleccionar</option>{categories.filter((c) => c.isActive || c.id === item?.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name} ({category.codePrefix})</option>)}</select></label>
      <label>Unidad<select name="unitId" defaultValue={item?.unitOfMeasureId ?? ''} required><option value="" disabled>Seleccionar</option>{units.filter((u) => u.isActive || u.id === item?.unitOfMeasureId).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.symbol})</option>)}</select></label>
      <label>Ubicacion<select name="locationId" defaultValue={item?.locationId ?? ''}><option value="">Sin ubicacion</option>{locations.filter((l) => l.isActive || l.id === item?.locationId).map((location) => <option key={location.id} value={location.id}>{location.displayCode}</option>)}</select></label>
      <div className="form-grid"><label>Stock<input name="currentStock" type="number" step="0.001" defaultValue={item?.currentStock ?? 0} /></label><label>Minimo<input name="minimumStock" type="number" step="0.001" defaultValue={item?.minimumStock ?? ''} /></label><label>Ideal<input name="idealStock" type="number" step="0.001" defaultValue={item?.idealStock ?? ''} /></label><label>Costo<input name="purchaseCost" type="number" step="0.01" defaultValue={item?.currentPurchaseCost ?? ''} /></label></div>
      <label>Notas<textarea name="notes" rows={3} defaultValue={item?.notes ?? ''} /></label>
    </>
  );
}

function CustomerFields({ customer }: { customer?: Customer }) {
  return <><label>Nombre<input name="name" defaultValue={customer?.name ?? ''} required /></label><label>Telefono<input name="phone" defaultValue={customer?.phone ?? ''} /></label><label>Direccion<input name="address" defaultValue={customer?.address ?? ''} /></label><label>CUIT/DNI<input name="taxId" defaultValue={customer?.taxId ?? ''} /></label><label>Notas<textarea name="notes" rows={3} defaultValue={customer?.notes ?? ''} /></label></>;
}

function ItemSelect({ items, value, onChange, name = 'itemId', required = false }: { items: Item[]; value: number | null; onChange: (value: number | null) => void; name?: string; required?: boolean }) {
  return <label>Item<select name={name} value={value ?? ''} required={required} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}><option value="">Seleccionar item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} · {formatNumber(item.currentStock)} {item.unitSymbol}</option>)}</select></label>;
}

function ItemStrip({ item, extra }: { item: Item; extra?: string }) {
  return <div className="item-strip"><strong>{item.code}</strong><span>{item.name}</span><b>{formatNumber(item.currentStock)} {item.unitSymbol}</b>{extra && <em>{extra}</em>}</div>;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="section-header"><p className="eyebrow">GPF Cloud</p><h2>{title}</h2><span>{subtitle}</span></div>;
}

function FormPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <aside className="form-panel"><h3>{title}</h3><p>{subtitle}</p>{children}</aside>;
}

function OperationPanel({ title, subtitle, accent, children }: { title: string; subtitle: string; accent: 'cyan' | 'red' | 'steel'; children: ReactNode }) {
  return <div className={`operation ${accent}`}><SectionHeader title={title} subtitle={subtitle} />{children}</div>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function DataList<T>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
  if (!rows.length) return <EmptyState title="Sin resultados" />;
  return <div className="data-list">{rows.map(render)}</div>;
}

function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong>{action}</div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop"><div className="modal"><header><h3>{title}</h3><button onClick={onClose}>Cerrar</button></header>{children}</div></div>;
}

function submitForm(event: FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<void>) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  void action(form).then(() => event.currentTarget.reset()).catch((err) => alert(errorMessage(err)));
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

function search<T>(rows: T[], query: string, text: (row: T) => string) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const haystack = normalize(text(row));
    return words.every((word) => haystack.includes(word));
  });
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function titleFor(view: View) {
  return navItems.find((item) => item.view === view)?.label ?? 'GPF Cloud';
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message);
  return 'Ocurrio un error inesperado.';
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
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
  return String(form.get(name) ?? '').trim() || null;
}

function numInput(form: FormData, name: string) {
  const value = Number(form.get(name));
  if (!Number.isFinite(value)) throw new Error(`Valor invalido: ${name}`);
  return value;
}

function nullableInput(form: FormData, name: string) {
  const value = form.get(name);
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(value);
}

function currency(value: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
}
