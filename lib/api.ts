import type { SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_BUCKET } from './supabase';
import type {
  AdminUser,
  Category,
  Customer,
  Item,
  Location,
  Profile,
  ReplenishmentItem,
  StockMovement,
  StockMovementLine,
  UnitOfMeasure,
} from './types';

type Row = Record<string, unknown>;

function num(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function toProfile(row: Row): Profile {
  const role = str(row.role, 'operator') as Profile['role'];
  return {
    id: num(row.id),
    authUserId: str(row.auth_user_id, '') || null,
    displayName: str(row.display_name, str(row.username, 'Usuario')),
    username: str(row.username),
    role,
    isActive: bool(row.is_active, true),
    isAdmin: role === 'technical_admin' || role === 'admin',
  };
}

export function toAdminUser(row: Row): AdminUser {
  return {
    id: num(row.id),
    displayName: str(row.display_name, str(row.username, 'Usuario')),
    username: str(row.username),
    role: str(row.role, 'operator') as AdminUser['role'],
    isActive: bool(row.is_active, true),
    hasAuthUser: row.auth_user_id !== null && row.auth_user_id !== undefined,
  };
}

export function toCategory(row: Row): Category {
  return {
    id: num(row.id),
    name: str(row.name),
    codePrefix: str(row.code_prefix, '') || null,
    isActive: bool(row.is_active, true),
  };
}

export function toUnit(row: Row): UnitOfMeasure {
  return {
    id: num(row.id),
    name: str(row.name),
    symbol: str(row.symbol),
    allowsDecimals: bool(row.allows_decimals),
    isActive: bool(row.is_active, true),
  };
}

export function toLocation(row: Row): Location {
  const displayCode = str(row.display_code, str(row.name));
  return {
    id: num(row.id),
    name: str(row.name, displayCode),
    displayCode,
    rowNumber: nullableNum(row.row_number),
    columnLetter: str(row.column_letter, '') || null,
    description: str(row.description, '') || null,
    isActive: bool(row.is_active, true),
  };
}

export function toCustomer(row: Row): Customer {
  return {
    id: num(row.id),
    name: str(row.name),
    phone: str(row.phone, '') || null,
    address: str(row.address, '') || null,
    taxId: str(row.tax_id, '') || null,
    notes: str(row.notes, '') || null,
    isActive: bool(row.is_active, true),
  };
}

export function toItem(row: Row): Item {
  return {
    id: num(row.id),
    code: str(row.code),
    name: str(row.name),
    categoryId: num(row.category_id),
    categoryName: str(row.category_name),
    unitOfMeasureId: num(row.unit_of_measure_id),
    unitName: str(row.unit_name),
    unitSymbol: str(row.unit_symbol),
    unitAllowsDecimals: bool(row.unit_allows_decimals),
    locationId: nullableNum(row.location_id),
    locationName: str(row.location_name, '') || null,
    currentStock: num(row.current_stock),
    minimumStock: nullableNum(row.minimum_stock),
    idealStock: nullableNum(row.ideal_stock),
    currentPurchaseCost: nullableNum(row.current_purchase_cost),
    photoPath: str(row.photo_path, '') || null,
    notes: str(row.notes, '') || null,
    isActive: bool(row.is_active, true),
  };
}

function toMovementLine(row: Row): StockMovementLine {
  return {
    itemId: num(row.item_id),
    itemCode: str(row.item_code),
    itemName: str(row.item_name),
    quantity: num(row.quantity),
    unitCost: nullableNum(row.unit_cost),
    unitSymbol: str(row.unit_symbol),
  };
}

export function toMovement(row: Row): StockMovement {
  const rawLines = Array.isArray(row.lines) ? row.lines : [];
  return {
    id: num(row.id),
    type: str(row.type, 'entry') as StockMovement['type'],
    typeLabel: str(row.type_label, 'Movimiento'),
    number: str(row.number, '') || null,
    createdAt: str(row.created_at),
    userDisplayName: str(row.user_display_name, 'Usuario'),
    customerName: str(row.customer_name, '') || null,
    workDescription: str(row.work_description, '') || null,
    workOrderNumber: str(row.work_order_number, '') || null,
    notes: str(row.notes, '') || null,
    lines: rawLines.map((line) => toMovementLine(line as Row)),
  };
}

export function toReplenishment(row: Row): ReplenishmentItem {
  return {
    itemId: num(row.item_id),
    code: str(row.code),
    name: str(row.name),
    categoryName: str(row.category_name),
    unitSymbol: str(row.unit_symbol),
    locationName: str(row.location_name, '') || null,
    currentStock: num(row.current_stock),
    minimumStock: num(row.minimum_stock),
    idealStock: nullableNum(row.ideal_stock),
    suggestedQuantity: num(row.suggested_quantity),
    priority: str(row.priority, 'baja') as ReplenishmentItem['priority'],
  };
}

function normalizeLocationColumn(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim().toUpperCase();
  return text.length ? text : null;
}

function buildLocationDisplayCode(name: string, rowNumber: number | null, columnLetter: string | null) {
  if (rowNumber === null && columnLetter === null) return name;
  const parts = [rowNumber !== null ? `F${rowNumber}` : null, columnLetter ? `C${columnLetter}` : null].filter(Boolean);
  return `${name}-${parts.join('/')}`;
}

export async function loadProfile(client: SupabaseClient, authUserId: string) {
  const { data, error } = await client.from('app_users').select().eq('auth_user_id', authUserId).maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as Row) : null;
}

export async function loadCatalogs(client: SupabaseClient) {
  const [categories, units, locations, customers, items, movements, replenishment, adminUsers] = await Promise.all([
    client.from('categories').select().order('name'),
    client.from('units_of_measure').select().order('id'),
    client.from('locations').select().order('name').order('row_number').order('column_letter'),
    client.from('customers').select().order('name'),
    client.from('gpf_items').select().order('code'),
    client.from('gpf_stock_movements').select().order('created_at', { ascending: false }).limit(120),
    client.from('gpf_replenishment').select().order('priority').order('code'),
    client.from('app_users').select().order('username'),
  ]);

  for (const result of [categories, units, locations, customers, items, movements, replenishment, adminUsers]) {
    if (result.error) throw result.error;
  }

  const movementMap = new Map<number, StockMovement>();
  for (const row of (movements.data ?? []) as Row[]) {
    const movement = toMovement(row);
    if (!movementMap.has(movement.id)) movementMap.set(movement.id, movement);
  }

  return {
    categories: ((categories.data ?? []) as Row[]).map(toCategory),
    units: ((units.data ?? []) as Row[]).map(toUnit),
    locations: ((locations.data ?? []) as Row[]).map(toLocation),
    customers: ((customers.data ?? []) as Row[]).map(toCustomer),
    items: ((items.data ?? []) as Row[]).map(toItem),
    movements: Array.from(movementMap.values()),
    replenishment: ((replenishment.data ?? []) as Row[]).map(toReplenishment),
    adminUsers: ((adminUsers.data ?? []) as Row[]).map(toAdminUser),
  };
}

export async function createCategory(client: SupabaseClient, form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const codePrefix = String(form.get('codePrefix') ?? '').trim().toUpperCase();
  const { error } = await client.from('categories').insert({ name, code_prefix: codePrefix, is_active: true });
  if (error) throw error;
}

export async function createLocation(client: SupabaseClient, form: FormData) {
  const name = String(form.get('name') ?? '').trim();
  const rowNumber = nullableNum(form.get('rowNumber'));
  const columnLetter = normalizeLocationColumn(form.get('columnLetter'));
  const description = String(form.get('description') ?? '').trim() || null;
  const displayCode = buildLocationDisplayCode(name, rowNumber, columnLetter);
  const { error } = await client.from('locations').insert({
    name,
    display_code: displayCode,
    row_number: rowNumber,
    column_letter: columnLetter,
    description,
    is_active: true,
  });
  if (error) throw error;
}

export async function setLocationActive(client: SupabaseClient, id: number, isActive: boolean) {
  const { error } = await client.from('locations').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function saveCustomer(client: SupabaseClient, form: FormData, id?: number) {
  const payload = {
    name: String(form.get('name') ?? '').trim(),
    phone: String(form.get('phone') ?? '').trim() || null,
    address: String(form.get('address') ?? '').trim() || null,
    tax_id: String(form.get('taxId') ?? '').trim() || null,
    notes: String(form.get('notes') ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  const query = id ? client.from('customers').update(payload).eq('id', id) : client.from('customers').insert({ ...payload, is_active: true });
  const { error } = await query;
  if (error) throw error;
}

export async function setCustomerActive(client: SupabaseClient, id: number, isActive: boolean) {
  const { error } = await client.from('customers').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function createItem(client: SupabaseClient, form: FormData) {
  const { error } = await client.rpc('gpf_create_item', {
    p_name: String(form.get('name') ?? '').trim(),
    p_category_id: num(form.get('categoryId')),
    p_unit_of_measure_id: num(form.get('unitId')),
    p_location_id: nullableNum(form.get('locationId')),
    p_current_stock: num(form.get('currentStock')),
    p_minimum_stock: nullableNum(form.get('minimumStock')),
    p_ideal_stock: nullableNum(form.get('idealStock')),
    p_current_purchase_cost: nullableNum(form.get('purchaseCost')),
    p_photo_path: null,
    p_notes: String(form.get('notes') ?? '').trim() || null,
  });
  if (error) throw error;
}

export async function updateItem(client: SupabaseClient, item: Item, form: FormData) {
  const { error } = await client.from('items').update({
    name: String(form.get('name') ?? '').trim(),
    category_id: num(form.get('categoryId')),
    unit_of_measure_id: num(form.get('unitId')),
    location_id: nullableNum(form.get('locationId')),
    current_stock: num(form.get('currentStock')),
    minimum_stock: nullableNum(form.get('minimumStock')),
    ideal_stock: nullableNum(form.get('idealStock')),
    current_purchase_cost: nullableNum(form.get('purchaseCost')),
    notes: String(form.get('notes') ?? '').trim() || null,
    is_active: item.isActive,
    updated_at: new Date().toISOString(),
  }).eq('id', item.id);
  if (error) throw error;
}

export async function setItemActive(client: SupabaseClient, id: number, isActive: boolean) {
  const { error } = await client.from('items').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function uploadItemPhoto(client: SupabaseClient, itemId: number, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const storagePath = `items/${itemId}-${Date.now()}.${extension}`;
  const { error: uploadError } = await client.storage.from(PHOTO_BUCKET).upload(storagePath, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });
  if (uploadError) throw uploadError;
  const { data } = client.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);
  const { error } = await client.from('items').update({ photo_path: data.publicUrl, updated_at: new Date().toISOString() }).eq('id', itemId);
  if (error) throw error;
}

export async function createStockEntry(client: SupabaseClient, itemId: number, quantity: number, unitCost: number | null) {
  const { error } = await client.rpc('gpf_create_stock_entry', {
    p_item_id: itemId,
    p_quantity: quantity,
    p_unit_cost: unitCost,
  });
  if (error) throw error;
}

export async function createStockExit(
  client: SupabaseClient,
  payload: {
    customerId: number | null;
    customerName: string | null;
    workDescription: string | null;
    workOrderNumber: string | null;
    notes: string | null;
    lines: Array<{ itemId: number; quantity: number }>;
  },
) {
  const { error } = await client.rpc('gpf_create_stock_exit', {
    p_customer_id: payload.customerId,
    p_customer_name: payload.customerName,
    p_work_description: payload.workDescription,
    p_work_order_number: payload.workOrderNumber,
    p_notes: payload.notes,
    p_lines: payload.lines,
  });
  if (error) throw error;
}

export async function createPhysicalAdjustment(client: SupabaseClient, itemId: number, countedStock: number) {
  const { error } = await client.rpc('gpf_create_physical_adjustment', {
    p_item_id: itemId,
    p_counted_stock: countedStock,
  });
  if (error) throw error;
}

export async function createAdminUser(client: SupabaseClient, form: FormData) {
  const { error } = await client.rpc('gpf_admin_create_user', {
    p_display_name: String(form.get('displayName') ?? '').trim(),
    p_username: String(form.get('username') ?? '').trim().toLowerCase(),
    p_password: String(form.get('password') ?? ''),
    p_role: String(form.get('role') ?? 'operator'),
  });
  if (error) throw error;
}
