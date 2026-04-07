// services/GarantiaService.ts
import { IGarantiaRepository } from "../repositories/IGarantiaRepository";
import { CrearGarantiaDTO, ResolverGarantiaDTO } from "../dtos/GarantiaDTO";

export class GarantiaService {
  constructor(private readonly garantiaRepository: IGarantiaRepository) {}

  async crearGarantia(data: CrearGarantiaDTO) {
    return await this.garantiaRepository.crearGarantia(data);
  }

  async resolverGarantia(data: ResolverGarantiaDTO) {
    return await this.garantiaRepository.resolverGarantia(data);
  }

  async obtenerPendientes(id_sucursal: number) {
    return await this.garantiaRepository.obtenerGarantiasEnRevision(
      id_sucursal,
    );
  }
}
