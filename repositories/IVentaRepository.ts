import { CrearVentaDTO } from "../dtos/CrearVentaDTO";
import { Venta } from "../entities/Venta";

export interface IVentaRepository {
  obtenerVentaPorId(
    id_venta: number,
  ): Promise<{ venta: Venta; detalles: any[] } | null>;
  obtenerHistorialVentas(): Promise<any[]>;
  crearOrdenVenta(data: CrearVentaDTO): Promise<number>;
  // Añade esta línea dentro de tu interface IVentaRepository
  obtenerRepartidoresPorSucursal(id_sucursal: number): Promise<any[]>;
  obtenerPendientesAutorizacion(id_sucursal: number): Promise<any[]>;
  resolverAutorizacion(
    id_venta: number,
    id_supervisor: number,
    id_usuario_log: number,
    aprobado: boolean,
  ): Promise<void>;
}
