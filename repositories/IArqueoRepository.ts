import { ArqueoDTO } from "../dtos/ArqueoDTO";

export interface IArqueoRepository {
  obtenerResumenCajaDia(id_cajero: number): Promise<any[]>;
  registrarArqueo(
    id_sucursal: number,
    id_cajero: number,
    data: ArqueoDTO,
    efectivo_sistema: number,
  ): Promise<number>;
}
