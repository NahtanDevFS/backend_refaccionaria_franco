// services/interfaces/IFacturacionService.ts
export interface IFacturacionService {
  /**
   * Emite la factura electrónica y retorna el UUID (DTE) de la SAT
   */
  emitirFactura(
    id_venta: number,
    total: number,
    nit_cliente?: string,
  ): Promise<{ uuid_dte: string; fecha_certificacion: Date }>;
}
