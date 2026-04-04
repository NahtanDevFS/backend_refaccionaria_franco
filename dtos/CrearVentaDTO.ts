// dtos/CrearVentaDTO.ts
import { CanalVenta } from "../types/venta.types";

export interface CrearDetalleVentaDTO {
  id_producto: number;
  cantidad: number;
  // El precio_unitario se busca en la BD en el backend, no se confía en el frontend.
}

export interface CrearVentaDTO {
  id_sucursal: number;
  id_vendedor: number;
  id_cliente?: number; // Null si es Consumidor Final
  canal: CanalVenta;
  detalles: CrearDetalleVentaDTO[];
  descuento_porcentaje_solicitado?: number; // El vendedor envía el % deseado (ej. 5)
  id_supervisor_autoriza?: number;
}
