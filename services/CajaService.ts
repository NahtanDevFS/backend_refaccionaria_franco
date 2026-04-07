// services/CajaService.ts

import { IPagoRepository } from "../repositories/IPagoRepository";
import { IArqueoRepository } from "../repositories/IArqueoRepository";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";
import { ArqueoDTO } from "../dtos/ArqueoDTO";

export class CajaService {
  constructor(
    private readonly pagoRepository: IPagoRepository,
    private readonly arqueoRepository: IArqueoRepository,
  ) {}

  async obtenerPendientes(id_sucursal: number) {
    return await this.pagoRepository.obtenerPendientesDePago(id_sucursal);
  }

  async registrarPago(id_cajero: number, data: RegistrarPagoDTO) {
    await this.pagoRepository.registrarPago(id_cajero, data);
  }

  async obtenerResumenDia(id_cajero: number) {
    return await this.arqueoRepository.obtenerResumenCajaDia(id_cajero);
  }

  async registrarArqueo(
    id_sucursal: number,
    id_cajero: number,
    data: ArqueoDTO,
  ) {
    // 1. Obtener lo que el sistema dice que debería haber en EFECTIVO
    const resumen =
      await this.arqueoRepository.obtenerResumenCajaDia(id_cajero);
    const itemEfectivo = resumen.find((r) => r.metodo_pago === "efectivo");
    const efectivoSistema = itemEfectivo ? itemEfectivo.total : 0;

    // 2. Registrar el arqueo contrastando físico vs sistema
    return await this.arqueoRepository.registrarArqueo(
      id_sucursal,
      id_cajero,
      data,
      efectivoSistema,
    );
  }
}
