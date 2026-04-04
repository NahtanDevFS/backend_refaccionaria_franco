// repositories/IPagoRepository.ts
export interface IPagoRepository {
  /**
   * Inserta el pago, guarda el UUID de la factura y actualiza la venta a 'pagada' en una sola transacción.
   */
  registrarPagoYFactura(
    id_venta: number,
    id_cajero: number,
    metodo_pago: string,
    monto: number,
    referencia: string | null,
    uuid_factura: string,
  ): Promise<void>;
}
