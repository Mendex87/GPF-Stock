export type Role = 'technical_admin' | 'operator' | 'admin';

export type Profile = {
  id: number;
  authUserId: string | null;
  displayName: string;
  username: string;
  role: Role;
  isActive: boolean;
  isAdmin: boolean;
};

export type AdminUser = {
  id: number;
  displayName: string;
  username: string;
  role: Role;
  isActive: boolean;
  hasAuthUser: boolean;
};

export type Category = {
  id: number;
  name: string;
  codePrefix: string | null;
  isActive: boolean;
};

export type UnitOfMeasure = {
  id: number;
  name: string;
  symbol: string;
  allowsDecimals: boolean;
  isActive: boolean;
};

export type Location = {
  id: number;
  name: string;
  displayCode: string;
  rowNumber: number | null;
  columnLetter: string | null;
  description: string | null;
  isActive: boolean;
};

export type Customer = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
  isActive: boolean;
};

export type Item = {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  categoryName: string;
  unitOfMeasureId: number;
  unitName: string;
  unitSymbol: string;
  unitAllowsDecimals: boolean;
  locationId: number | null;
  locationName: string | null;
  currentStock: number;
  minimumStock: number | null;
  idealStock: number | null;
  currentPurchaseCost: number | null;
  photoPath: string | null;
  notes: string | null;
  isActive: boolean;
};

export type StockMovementLine = {
  itemId: number;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitCost: number | null;
  unitSymbol: string;
};

export type StockMovement = {
  id: number;
  type: 'entry' | 'exit' | 'physical_adjustment';
  typeLabel: string;
  number: string | null;
  createdAt: string;
  userDisplayName: string;
  customerName: string | null;
  workDescription: string | null;
  workOrderNumber: string | null;
  notes: string | null;
  lines: StockMovementLine[];
};

export type ReplenishmentItem = {
  itemId: number;
  code: string;
  name: string;
  categoryName: string;
  unitSymbol: string;
  locationName: string | null;
  currentStock: number;
  minimumStock: number;
  idealStock: number | null;
  suggestedQuantity: number;
  priority: 'critica' | 'baja';
};
