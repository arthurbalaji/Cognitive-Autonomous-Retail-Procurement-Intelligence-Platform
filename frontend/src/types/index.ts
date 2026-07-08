export type UserRole = 'ADMIN' | 'RETAILER' | 'WHOLESALER';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  tenantType: 'RETAILER' | 'WHOLESALER';
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}

export interface Tenant {
  id: string;
  type: 'RETAILER' | 'WHOLESALER';
  name: string;
  erpProvider: string;
  apiKeys: Record<string, string>;
}

export interface Product {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  category: string;
  basePrice: number;
  currentStock: number;
  reorderPoint: number;
  predictedStockoutDate?: string;
  demandForecast?: number;
}

export interface Order {
  id: string;
  retailerId: string;
  wholesalerId: string;
  retailerName?: string;
  wholesalerName?: string;
  status: 'PENDING' | 'NEGOTIATING' | 'ACCEPTED' | 'REJECTED';
  totalAmount: number;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  negotiatedPrice?: number;
}

export interface NegotiationLog {
  id: string;
  orderId: string;
  agentType: 'RETAILER_AGENT' | 'WHOLESALER_AGENT' | 'SYSTEM';
  messagePayload: NegotiationMessage;
  timestamp: string;
}

export interface NegotiationMessage {
  action: string;
  message: string;
  proposedPrice?: number;
  counterPrice?: number;
  discount?: number;
  reasoning?: string;
  accepted?: boolean;
}

export interface MarketPulseIndex {
  value: number;
  trend: 'RISING' | 'STABLE' | 'FALLING';
  factors: {
    demandPressure: number;
    supplyAvailability: number;
    priceVolatility: number;
    seasonalIndex: number;
  };
  lastUpdated: string;
}

export interface SystemHealth {
  kafkaLag: number;
  activeConnections: number;
  llmTokensUsed: number;
  totalThroughput: number;
  uptime: string;
  services: ServiceStatus[];
}

export interface ServiceStatus {
  name: string;
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  latency: number;
  lastCheck: string;
}

export interface ErpProvider {
  id: string;
  name: string;
  logo: string;
  description: string;
  fields: ErpField[];
}

export interface ErpField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder: string;
  helpText: string;
}
