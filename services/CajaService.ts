// services/CajaService.ts

import { IVentaRepository } from "../repositories/IVentaRepository";
import { IPagoRepository } from "../repositories/IPagoRepository";
import { IFacturacionService } from "./interfaces/IFacturacionService";
import { RegistrarPagoDTO } from "../dtos/RegistrarPagoDTO";
import { EstadoVenta } from "../types/venta.types";
import { MetodoPago } from "../types/pago.types";

export class CajaService {
  constructor(
    private readonly ventaRepository: IVentaRepository,
    private readonly pagoRepository: IPagoRepository,
    private readonly facturacionService: IFacturacionService,
  ) {}

  async procesarPagoYFacturar(
    dto: RegistrarPagoDTO,
  ): Promise<{ success: boolean; uuid_factura: string }> {
    // 1. Obtener la venta actual
    const ventaData = await this.ventaRepository.obtenerVentaPorId(
      dto.id_venta,
    );

    if (!ventaData) {
      throw new Error(`La venta con ID ${dto.id_venta} no existe.`);
    }

    const { venta } = ventaData;

    // 2. Validar reglas de negocio de estado
    if (venta.estado !== EstadoVenta.PENDIENTE_PAGO) {
      throw new Error(
        `No se puede cobrar esta venta. Estado actual: ${venta.estado}`,
      );
    }

    // 3. Validar montos exactos (sin pagos parciales)
    if (Number(dto.monto_recibido) !== Number(venta.total)) {
      throw new Error(
        `El monto recibido (Q${dto.monto_recibido}) no coincide con el total de la venta (Q${venta.total}).`,
      );
    }

    // 4. Validar referencia si no es efectivo
    if (dto.metodo_pago !== MetodoPago.EFECTIVO && !dto.referencia) {
      throw new Error(
        `El método de pago ${dto.metodo_pago} requiere un número de referencia (voucher/boleta).`,
      );
    }

    // 5. EMITIR FACTURA (Simulación FEL - SAT)
    // El servicio FEL maneja su propia latencia y generación de DTE
    const dte = await this.facturacionService.emitirFactura(
      venta.id_venta,
      venta.total,
      "CF", // Consumidor Final por defecto, se puede expandir si hay id_cliente
    );

    // 6. Persistir el pago y cambiar el estado de la venta en una transacción
    await this.pagoRepository.registrarPagoYFactura(
      dto.id_venta,
      dto.id_cajero,
      dto.metodo_pago,
      dto.monto_recibido,
      dto.referencia || null,
      dte.uuid_dte,
    );

    return {
      success: true,
      uuid_factura: dte.uuid_dte,
    };
  }
}
