// entities/Venta.ts
import { CanalVenta, EstadoVenta } from "../types/venta.types";

export interface Venta {
  id_venta: number;
  id_sucursal: number;
  id_vendedor: number;
  id_cliente?: number | null; // FK, opcional para Consumidor Final [cite: 1167]
  id_supervisor_autoriza?: number | null; // FK, para descuentos > 5% [cite: 1167]
  canal: CanalVenta;
  estado: EstadoVenta;
  subtotal: number; // NUMERIC(12,2) en BD [cite: 1168]
  descuento_monto: number; // NUMERIC(12,2) en BD [cite: 1168]
  total: number; // NUMERIC(12,2) en BD [cite: 1168]
  created_at: Date; // [cite: 1168]
  updated_at: Date; // [cite: 1168]
}

// entities/DetalleVenta.ts

export interface DetalleVenta {
  id_detalle: number; // PK [cite: 1170]
  id_venta: number; // FK [cite: 1170]
  id_producto: number; // FK [cite: 1170]
  cantidad: number; // NUMERIC(12,2) en BD [cite: 1170]
  precio_unitario: number; // NUMERIC(12,2) en BD [cite: 1170]
  subtotal_linea: number; // NUMERIC(12,2) en BD [cite: 1170]
}
