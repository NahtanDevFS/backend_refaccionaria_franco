// repositories/IPagoRepository.ts
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";

export interface IPagoRepository {
  obtenerPendientesDePago(id_sucursal: number): Promise<any[]>;
  registrarPago(id_cajero: number, data: RegistrarPagoDTO): Promise<void>;
}
