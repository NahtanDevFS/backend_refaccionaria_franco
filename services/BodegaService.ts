// services/BodegaService.ts
import { IBodegaRepository } from "../repositories/IBodegaRepository";
import { EmitirDespachoDTO, AjusteInventarioDTO } from "../dtos/BodegaDTO";

export class BodegaService {
  constructor(private readonly bodegaRepository: IBodegaRepository) {}

  async obtenerInventarioLocal(id_sucursal: number) {
    return await this.bodegaRepository.obtenerInventarioConAlertas(id_sucursal);
  }

  async emitirDespacho(
    id_sucursal_origen: number,
    id_usuario: number,
    data: EmitirDespachoDTO,
  ) {
    if (id_sucursal_origen === data.id_sucursal_destino) {
      throw new Error(
        "La sucursal destino no puede ser la misma que el origen",
      );
    }
    return await this.bodegaRepository.emitirDespacho(
      id_sucursal_origen,
      id_usuario,
      data,
    );
  }

  async obtenerRecepciones(id_sucursal_destino: number) {
    return await this.bodegaRepository.obtenerRecepcionesPendientes(
      id_sucursal_destino,
    );
  }

  async confirmarRecepcion(
    id_despacho: number,
    id_sucursal_destino: number,
    id_usuario: number,
  ) {
    return await this.bodegaRepository.recibirDespacho(
      id_despacho,
      id_sucursal_destino,
      id_usuario,
    );
  }

  async ajustarInventario(
    id_sucursal: number,
    id_usuario: number,
    data: AjusteInventarioDTO,
  ) {
    return await this.bodegaRepository.registrarAjuste(
      id_sucursal,
      id_usuario,
      data,
    );
  }
}
