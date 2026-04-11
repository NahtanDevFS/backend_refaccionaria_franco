import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { Venta } from "../entities/Venta";

export interface IVentaRepository {
  obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: Venta; detalles: any[] } | null>;
  obtenerHistorialVentas(
    filtros?: any,
  ): Promise<{ data: any[]; total: number }>;
  crearOrdenVenta(data: CrearVentaDTO): Promise<number>;
  obtenerVendedoresPorSucursal(id_sucursal: number): Promise<any[]>;
  obtenerRepartidoresPorSucursal(id_sucursal: number): Promise<any[]>;
  obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]>;
  resolverAutorizacion(
    id_venta: number,
    id_supervisor: number,
    id_usuario_log: number,
    aprobado: boolean,
  ): Promise<void>;
}
