import { CrearGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export interface IGarantiaRepository {
  crearGarantia(data: CrearGarantiaDTO): Promise<number>;
  resolverGarantia(data: ResolverGarantiaDTO): Promise<void>;
  obtenerGarantiasEnRevision(id_sucursal: number): Promise<any[]>;
}
