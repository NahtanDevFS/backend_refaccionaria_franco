import { EmitirDespachoDTO, AjusteInventarioDTO } from "../dtos/BodegaDTO";

export interface IBodegaRepository {
  obtenerInventarioConAlertas(id_sucursal: number): Promise<any[]>;
  emitirDespacho(
    id_sucursal_origen: number,
    id_usuario: number,
    data: EmitirDespachoDTO,
  ): Promise<number>;
  obtenerRecepcionesPendientes(id_sucursal_destino: number): Promise<any[]>;
  recibirDespacho(
    id_despacho: number,
    id_sucursal_destino: number,
    id_usuario: number,
  ): Promise<void>;
  registrarAjuste(
    id_sucursal: number,
    id_usuario: number,
    data: AjusteInventarioDTO,
  ): Promise<void>;
}
